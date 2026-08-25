/**
 * WhyMusic 自架後端 —— 單一 Node 程序，供應前端靜態檔與所有 /api/* 端點。
 * 零外部相依（只用 Node 內建模組），所以在 VPS／LXC／裸機 Linux 上不必編譯
 * 任何東西，有 Node ≥ 20.11 就能跑。
 *
 * 用法：node packages/web/scripts/server.mjs
 * 設定全部走環境變數，見 .env.example 與 DEPLOY.md。
 */

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { createHmac } from 'node:crypto'
import { execSync } from 'node:child_process'
import { gzip as gzipCb } from 'node:zlib'
import { promisify } from 'node:util'
import { lookup as dnsLookup } from 'node:dns/promises'
import {
  SYNC_CODE_LEN,
  SYNC_MAX_BYTES,
  SYNC_TTL,
  newSyncCode,
  normalizeSyncCode,
  validateSyncPayload,
} from '../shared/sync.js'
import { checkProxyTarget, isPrivateIp, parseAllowedHosts } from '../shared/proxy-guard.js'
import { RateLimiter } from '../shared/rate-limit.js'

// import.meta.dirname 需要 Node 20.11+。版本不符時給明確訊息就退出，不要讓它到
// 後面才以看不懂的方式壞掉（例如 STATIC_DIR 變成 undefined、靜態檔全 404）。
{
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (major < 20 || (major === 20 && minor < 11)) {
    console.error(
      `✘ 需要 Node.js ≥ 20.11，目前是 ${process.versions.node}。請升級 Node 後再啟動。`,
    )
    process.exit(1)
  }
}

/**
 * 建置戳記，供 /api/version 回報，前端顯示在「音源」頁。
 * 格式與 CF 版（scripts/build-stamp.mjs）一致。
 *
 * 優先讀 BUILD_STAMP：部署到伺服器時通常只丟 dist + 這支檔案過去，那邊沒有 git
 * 工作區，問 git 只會得到 dev，於是前端（建置時編進去的真戳記）與後端就對不上，
 * 版本區塊會誤報「只部署了一半」。部署腳本把建置當下的戳記用這個環境變數傳進來，
 * 兩邊才會一致。取不到才退回問 git，最後才是 dev。
 */
const SERVER_VERSION = process.env.BUILD_STAMP || (() => {
  const run = (cmd) => {
    try {
      return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    } catch { return '' }
  }
  const sha = run('git rev-parse --short HEAD') || 'dev'
  const dirty = run('git status --porcelain') ? '+' : ''
  const t = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${sha}${dirty} · ${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}`
})()

const PORT = Number(process.env.PORT) || 8788
// 監聽位址。預設 0.0.0.0（直接對外）。有反向代理時應設 HOST=127.0.0.1，
// 讓 node 只收本機來的連線，外界一律經 nginx —— 否則有人繞過反代直接命中
// node 的埠，反代上設的限流、標頭、TLS 全部被跳過。
const HOST = process.env.HOST || '0.0.0.0'
const STATIC_DIR = path.resolve(import.meta.dirname, '../dist')

// /api/proxy 的網域白名單。預設空＝不限制（允許任何公網 host）—— 因為這個 app
// 刻意支援貼任意第三方插件 URL 與從任意 CDN 播放。想鎖死的營運者可設
// PROXY_ALLOWED_HOSTS=gdstudio.xyz,music.126.net,... 逗號分隔。私有網段一律擋，
// 不受白名單影響（見 assertProxyTargetSafe）。
const PROXY_ALLOWED_HOSTS = parseAllowedHosts(process.env.PROXY_ALLOWED_HOSTS)

// /api/proxy 的每 IP 限流。proxy 會實際去外部抓資料，不節流容易被單一來源灌爆、
// 或因短時間打太多次被上游封 IP。預設容量 60、每秒回補 5 ≈ 平常每秒 5 次、可突發 60。
// 可用環境變數調整；設 PROXY_RATE_CAPACITY=0 完全關閉（不建議公開時關）。
const PROXY_RATE_CAPACITY = Number(process.env.PROXY_RATE_CAPACITY ?? 60)
const proxyLimiter = PROXY_RATE_CAPACITY > 0
  ? new RateLimiter({
      capacity: PROXY_RATE_CAPACITY,
      refillPerSec: Number(process.env.PROXY_RATE_REFILL ?? 5),
    })
  : null

/**
 * 取請求的來源 IP。有反向代理時真實 IP 在 X-Forwarded-For 的第一個。
 * TRUST_PROXY=1 才信任該標頭 —— 沒有反代卻信任它，任何人都能偽造 XFF 繞過限流。
 */
function clientIp(req) {
  if (process.env.TRUST_PROXY === '1') {
    const xff = req.headers['x-forwarded-for']
    if (xff) return String(xff).split(',')[0].trim()
  }
  return req.socket?.remoteAddress || 'unknown'
}

/**
 * 代抓目標的完整安全檢查。同步部分（scheme／字面 IP／白名單）交給共用模組，
 * Node 這裡額外做 DNS 解析後複查：把網域解析成實際 IP，逐一確認都不是私有網段。
 * 這一步擋掉「攻擊者把自己的網域解析到 127.0.0.1 / 169.254.169.254」這類繞過 ——
 * 字面 IP 檢查看不到網域背後解析到哪裡，只有真的解析一次才知道。
 *
 * 回傳 { ok, url } 或 { ok:false, reason }。
 */
async function assertProxyTargetSafe(rawUrl) {
  const basic = checkProxyTarget(rawUrl, PROXY_ALLOWED_HOSTS)
  if (!basic.ok) return basic
  const host = basic.url.hostname.replace(/^\[|\]$/g, '')
  // host 是 IP 字面的話 checkProxyTarget 已驗過，不必再解析
  if (/^[\d.]+$/.test(host) || host.includes(':')) return basic
  // EAI_AGAIN 是解析器暫時故障（上游 DNS 超時等），不是「這個域名不存在」——
  // 音訊 CDN（music.126.net 一類）域名長 CNAME 鏈，最容易踩到。重試兩次再放棄，
  // 否則一次抖動就讓整首歌播不出來。
  let lastErr
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const results = await dnsLookup(host, { all: true })
      for (const { address } of results) {
        if (isPrivateIp(address)) {
          return { ok: false, reason: `${host} 解析到私有位址 ${address}` }
        }
      }
      return basic
    } catch (e) {
      lastErr = e
      if (e.code !== 'EAI_AGAIN') break
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)))
    }
  }
  return { ok: false, reason: `無法解析 host：${lastErr.message}` }
}

/**
 * 裝置配對碼的暫存目錄。CF 版用 KV，自架版沒有 KV，但有檔案系統 —— 一組碼一個
 * 小 JSON 檔就夠了，不必為此拉一個資料庫進來（這支服務的原則是零外部相依）。
 * 碼的格式與驗證規則與 CF 版共用 ../shared/sync.js。
 */
const SYNC_DIR = process.env.SYNC_DIR || path.resolve(import.meta.dirname, '../../../.sync')

/** 刪掉過期的碼。檔案數很少（一台機器同時存在的碼是個位數），全掃無妨 */
function sweepExpiredSyncCodes() {
  try {
    for (const name of fs.readdirSync(SYNC_DIR)) {
      if (!name.endsWith('.json')) continue
      const file = path.join(SYNC_DIR, name)
      try {
        const { expires } = JSON.parse(fs.readFileSync(file, 'utf8'))
        if (!expires || Date.now() > expires) fs.unlinkSync(file)
      } catch {
        // 壞掉或讀不出來的就清掉，留著也沒用
        fs.unlinkSync(file)
      }
    }
  } catch { /* 目錄還不存在，沒東西要掃 */ }
}

// ── OAuth 1.0 Configuration ────────────────────────────────────────
// Load from environment variables. Defaults are Audiomack's public
// example credentials — replace in production via .env or env vars.
// 使用 Audiomack 官方公開的 consumer key/secret。
// 可用環境變量覆蓋。
const AUDIOMACK_SEARCH_CONSUMER_KEY =
  process.env.AUDIOMACK_SEARCH_CONSUMER_KEY || 'audiomack-js'
const AUDIOMACK_SEARCH_SECRET =
  process.env.AUDIOMACK_SEARCH_SECRET || 'f3ac5b086f3eab260520d8e3049561e6'
const AUDIOMACK_MEDIA_CONSUMER_KEY =
  process.env.AUDIOMACK_MEDIA_CONSUMER_KEY || 'audiomack-js'
const AUDIOMACK_MEDIA_SECRET =
  process.env.AUDIOMACK_MEDIA_SECRET || 'f3ac5b086f3eab260520d8e3049561e6'

// ── OAuth 1.0 helpers (Audiomack) ──────────────────────────────────

function oauthEncode(str) {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A')
}

function hmacSha1(key, data) {
  return createHmac('sha1', key).update(data).digest('base64')
}

async function generateSignature(method, baseUrl, params, secret) {
  const sortedKeys = Object.keys(params).sort()
  const paramPairs = sortedKeys
    .filter(k => k !== 'oauth_signature')
    .map(k => `${oauthEncode(k)}=${oauthEncode(String(params[k]))}`)
    .join('&')
  const baseString = `${method.toUpperCase()}&${oauthEncode(baseUrl)}&${oauthEncode(paramPairs)}`
  const signingKey = `${oauthEncode(secret)}&`
  return oauthEncode(hmacSha1(signingKey, baseString))
}

// ── Audiomack API ─────────────────────────────────────────────────

const AUDIOMACK_BASE = 'https://api.audiomack.com/v1'

async function searchAudiomack(keyword, type, page, sort = 'popular') {
  const consumerKey = AUDIOMACK_SEARCH_CONSUMER_KEY
  const secret = AUDIOMACK_SEARCH_SECRET
  const timestamp = String(Math.floor(Date.now() / 1000))
  const nonce = randomBytes(16).toString('hex')
  const pageNum = page || 1

  const params = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp,
    oauth_version: '1.0',
    q: keyword,
    page: String(pageNum),
    limit: '20',
    show: type === 'music' ? 'songs' :
          type === 'album' ? 'albums' :
          type === 'artist' ? 'artists' : 'playlists',
    sort: sort,
  }

  const signature = await generateSignature('GET', `${AUDIOMACK_BASE}/search`, params, secret)
  params.oauth_signature = signature

  const paramString = Object.entries(params)
    .map(([k, v]) => `${k}=${k === 'oauth_signature' ? v : oauthEncode(v)}`)
    .join('&')

  const response = await fetch(`${AUDIOMACK_BASE}/search?${paramString}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`Audiomack API error: ${errText}`)
  }

  const data = await response.json()
  return (data.results || []).map(item => {
    const artistObj = item.artist || ''
    // 專輯/歌單結果：Audiomack search API 直接返回 tracks
    const trackArray = (type === 'album' || type === 'sheet') && item.tracks
      ? (Array.isArray(item.tracks) ? item.tracks : Object.values(item.tracks))
      : []
    const musicList = trackArray.map((t, i) => ({
      id: t.song_id || t.id || `${item.id}-track-${i}`,
      title: t.title || '',
      artist: t.artist || item.artistName || item.uploader || '',
      artwork: t.cover_url || t.artwork_url || item.image_base || item.image || '',
      duration: parseInt(t.duration, 10) || 0,
      platform: 'Audiomack',
      type: 'music',
    })).filter(t => t.title)
    return {
      id: item.id || '',
      title: item.title || (item.name || ''),
      artist: typeof artistObj === 'string' ? artistObj : (artistObj.name || item.artistName || item.uploader || ''),
      artwork: item.image || item.image_base || item.artwork_url || item.cover_url || '',
      platform: 'Audiomack',
      duration: item.duration || 0,
      url_slug: item.url_slug || '',
      released: item.released ? Number(item.released) : 0,
      uploaded: item.uploaded ? Number(item.uploaded) : 0,
      type: type === 'album' ? 'album' : type === 'sheet' ? 'sheet' : (type === 'artist' ? 'artist' : 'music'),
      musicList,
    }
  })
}

// 香港流行曲推薦：用多個歌手/樂隊關鍵字搜尋，熱門/最新兩種排序，去重合併
const HK_SONG_KEYWORDS = [
  '陳奕迅', '容祖兒', '張學友', '張國榮', '梅艷芳', '鄭秀文', '許冠傑',
  '陳慧琳', '謝霆鋒', '楊千嬅', '李克勤', '古巨基', '草蜢', 'Beyond',
  '王菲', '劉德華', '郭富城', '黎明', 'Twins', '張敬軒',
  '林家謙', '姜濤', 'MIRROR', '陳卓賢', '柳應廷', 'Anson Lo', '呂爵安',
  '張天賦', 'Dear Jane', 'RubberBand',
  '泳兒', '鄭欣宜', '許廷鏗', '衛蘭', '江海迦', '陳柏宇', '林奕匡',
  'Serrini', '黃妍', '陳蕾', 'AGA',
]

// 「最新」模式使用的新世代/活躍香港歌手（以近年仍活躍的為主）
const HK_NEW_SONG_KEYWORDS = [
  '林家謙', '姜濤', 'MIRROR', '陳卓賢', '柳應廷', 'Anson Lo', '呂爵安', '陳蕾',
  '張天賦', 'Dear Jane', 'RubberBand', '許廷鏗', '衛蘭', '江海迦', '黃妍',
  'Serrini', '泳兒', '鄭欣宜', '林奕匡', '陳柏宇', 'AGA', '張敬軒', '容祖兒',
  '楊千嬅', '陳奕迅',
]

// 「最新」模式只保留近期發行的歌（秒）。Audiomack 的 released 是重新上架日，
// 用較短窗口 + 新歌手集合減少舊歌重發混入。新歌手素材稀疏，1 年內較穩
const RECENT_WINDOW = 240 * 24 * 60 * 60  // 約 8 個月

async function recommendAudiomack(mode = 'hot', limit = 40) {
  const sort = mode === 'new' ? 'recent' : 'popular'
  const keywords = mode === 'new' ? HK_NEW_SONG_KEYWORDS : HK_SONG_KEYWORDS
  // 併發搜尋所有香港歌手/樂隊關鍵字
  const results = await Promise.allSettled(
    keywords.map(kw => searchAudiomack(kw, 'music', 1, sort)),
  )
  const buckets = results.map(r => (r.status === 'fulfilled' && Array.isArray(r.value) ? r.value : []))

  if (mode === 'new') {
    // 最新：全部按 released（發行時間）降冪排序，只保留近期的歌
    const now = Math.floor(Date.now() / 1000)
    const seen = new Set()
    const songs = []
    for (let si = 0; si < buckets.length; si++) {
      const bucket = buckets[si]
      for (const item of bucket) {
        const title = (item.title || '').trim()
        const artist = (item.artist || '').trim()
        if (!title) continue
        // 藝人與搜尋關鍵字相符才保留，排除誤搜（黎明=日出、Dear Jane=賽狗、MIRROR=鏡子等）。
        // 合作曲藝人欄可能含多個歌手，只要包含任一搜尋關鍵字即可
        const artistOk = !artist || keywords.some(kw => kw && artist.includes(kw))
        if (!artistOk) continue
        const key = `${title}::${artist}`
        if (seen.has(key)) continue
        seen.add(key)
        songs.push(item)
      }
    }
    // 同一藝人同一天大量重發 = 舊專輯整批 re-release，非新歌。
    // 用「藝人+重發日」計數，超過閾值的批次只取第一首代表
    const batchCount = {}
    for (const s of songs) {
      const k = `${s.artist}::${s.released || 0}`
      batchCount[k] = (batchCount[k] || 0) + 1
    }
    const batchSeen = new Set()
    const deduped = songs.filter(s => {
      const k = `${s.artist}::${s.released || 0}`
      if (batchCount[k] > 2) {
        if (batchSeen.has(k)) return false
        batchSeen.add(k)
      }
      return true
    })
    const recent = deduped
      .filter(s => s.released > now - RECENT_WINDOW)
      .sort((a, b) => (b.released || 0) - (a.released || 0))
    return recent.slice(0, limit).map(s => ({
      id: String(s.id),
      title: (s.title || '').trim(),
      artist: (s.artist || '').trim(),
      artwork: s.artwork || '',
      platform: 'Audiomack',
      duration: s.duration || 0,
      type: 'music',
      released: s.released || 0,
    }))
  }

  // 熱門：輪流交替取每個關鍵字的歌（每源各取 1 首），避免單一歌手灌滿
  const seen = new Set()
  const merged = []
  const maxLen = Math.max(...buckets.map(b => b.length), 0)
  for (let idx = 0; idx < maxLen && merged.length < limit; idx++) {
    for (const bucket of buckets) {
      const item = bucket[idx]
      if (!item) continue
      const title = (item.title || '').trim()
      const artist = (item.artist || '').trim()
      if (!title) continue
      const key = `${title}::${artist}`
      if (seen.has(key)) continue
      seen.add(key)
      merged.push({
        id: String(item.id),
        title,
        artist,
        artwork: item.artwork || '',
        platform: 'Audiomack',
        duration: item.duration || 0,
        type: 'music',
      })
      if (merged.length >= limit) break
    }
  }
  return merged
}

// ── YouTube 搜尋（後端執行，無 CORS）──────────────────────────────
async function searchYouTube(keyword, page = 1) {
  const data = JSON.stringify({
    context: {
      client: {
        hl: 'zh-CN', gl: 'US', deviceMake: '', deviceModel: '',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        clientName: 'WEB', clientVersion: '2.20231121.08.00', osName: 'Windows', osVersion: '10.0',
        platform: 'DESKTOP', browserName: 'Edge Chromium', browserVersion: '119.0.0.0',
        screenWidthPoints: 1358, screenHeightPoints: 1012, screenPixelDensity: 1,
      },
    },
    user: { lockedSafetyMode: false },
    request: { useSsl: true, internalExperimentFlags: [] },
    query: keyword,
  })
  const response = await fetch('https://www.youtube.com/youtubei/v1/search?prettyPrint=false', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: data,
  })
  if (!response.ok) throw new Error(`YouTube API error: ${response.status}`)
  const j = await response.json()
  const secs = j?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents
  if (!secs) return []
  const out = []
  for (const it of secs) {
    if (!it.itemSectionRenderer) continue
    for (const c of it.itemSectionRenderer.contents) {
      if (!c.videoRenderer) continue
      const v = c.videoRenderer
      const title = v.title?.runs?.[0]?.text || ''
      const artist = v.ownerText?.runs?.[0]?.text || ''
      if (title.toLowerCase().includes('premiere')) continue
      const len = v.lengthText?.simpleText || v.lengthText?.runs?.map(r => r.text).join('') || ''
      // 過濾太長影片（演唱會/LIVE 片段），香港流行曲通常 < 8 分鐘
      const m = len.match(/(\d+):(\d+)/)
      if (m && (parseInt(m[1], 10) * 60 + parseInt(m[2], 10)) > 480) continue
      out.push({
        id: v.videoId,
        title,
        artist,
        artwork: v.thumbnail?.thumbnails?.[v.thumbnail.thumbnails.length - 1]?.url || '',
        platform: 'Youtube',
        duration: m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : 0,
        type: 'music',
      })
    }
  }
  return out
}

/**
 * 專輯/歌單詳情 - 使用 Audiomack 數據 API
 * 返回專輯/歌單內的歌曲列表
 */
async function getAudiomackAlbumOrSheet(id, slug, artist, sheetArtist) {
  if (!slug || !artist) {
    return { error: '缺少 slug 或 artist' }
  }
  const consumerKey = AUDIOMACK_MEDIA_CONSUMER_KEY
  const secret = AUDIOMACK_MEDIA_SECRET
  const timestamp = String(Math.floor(Date.now() / 1000))
  const nonce = randomBytes(16).toString('hex')

  const dataUrl = `https://data.audiomack.com/v1/${artist}/album/${slug}.json`
  const params = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp,
    oauth_version: '1.0',
    page_slug: artist,
    album_slug: slug,
  }

  const signature = await generateSignature('GET', dataUrl, params, secret)
  params.oauth_signature = signature
  const paramString = Object.entries(params)
    .map(([k, v]) => `${k}=${k === 'oauth_signature' ? v : oauthEncode(v)}`)
    .join('&')

  const response = await fetch(`${dataUrl}?${paramString}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  })
  if (!response.ok) {
    return { error: `Audiomack API error: ${response.status}` }
  }
  const data = await response.json()
  const tracks = data.tracks || data.tracksList || data.musicList || []
  if (!Array.isArray(tracks)) {
    return { error: '未知響應格式', raw: JSON.stringify(data).slice(0, 200) }
  }
  return tracks.map((item, index) => ({
    id: item.id || `${id}-track-${index}`,
    title: item.title || '',
    artist: item.uploader || item.artist || '',
    artwork: item.cover_url || item.artwork_url || item.image || '',
    platform: 'Audiomack',
    duration: parseInt(item.duration, 10) || 0,
    type: 'music',
  }))
}

async function getAudiomackMedia(songId) {
  const consumerKey = AUDIOMACK_MEDIA_CONSUMER_KEY
  const secret = AUDIOMACK_MEDIA_SECRET
  const timestamp = String(Math.floor(Date.now() / 1000))
  const nonce = randomBytes(16).toString('hex')

  const params = {
    environment: 'desktop-web',
    hq: 'true',
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp,
    oauth_version: '1.0',
    section: '/search',
  }

  const fullUrl = `${AUDIOMACK_BASE}/music/play/${songId}`
  const signature = await generateSignature('GET', fullUrl, params, secret)
  params.oauth_signature = signature

  const paramString = Object.entries(params)
    .map(([k, v]) => `${k}=${k === 'oauth_signature' ? v : oauthEncode(v)}`)
    .join('&')
  const url = `${fullUrl}?${paramString}`

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Origin': 'https://audiomack.com',
    },
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`Audiomack API error: ${errText}`)
  }

  const data = await response.json()
  return data.signedUrl || ''
}

// YouTube 音頻 URL（ANDROID_MUSIC client）
async function getYouTubeMedia(videoId) {
  const body = JSON.stringify({
    context: {
      client: {
        clientName: 'ANDROID_MUSIC',
        clientVersion: '6.14.50',
        hl: 'en',
        gl: 'GB',
        deviceMake: '',
        deviceModel: '',
        userAgent: 'com.google.android.apps.youtube.music/6.14.50 (Linux; U; Android 13; GB) gzip',
        osName: 'Android',
        osVersion: '13',
        platform: 'MOBILE',
        screenWidthPoints: 689,
        screenHeightPoints: 963,
        screenPixelDensity: 1,
        timeZone: 'Europe/Amsterdam',
      },
      user: { enableSafetyMode: false },
      request: { internalExperimentFlags: [], consistencyTokenJars: [] },
    },
    contentCheckOk: true,
    racyCheckOk: true,
    video_id: videoId,
  })
  const ytResp = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })
  if (!ytResp.ok) throw new Error(`YouTube API error: ${ytResp.status}`)
  const ytData = await ytResp.json()
  if (ytData.playabilityStatus?.status !== 'OK') {
    throw new Error(`YouTube playability: ${ytData.playabilityStatus?.reason || 'unavailable'}`)
  }
  const formats = ytData.streamingData?.formats || []
  const adaptiveFormats = ytData.streamingData?.adaptiveFormats || []
  const allFormats = [...adaptiveFormats, ...formats].filter(f => f.url)
  const audioFormats = allFormats.filter(f => (f.mimeType || '').includes('audio'))
  const candidates = audioFormats.length > 0 ? audioFormats : allFormats
  return candidates[0]?.url || null
}

// ── WhyMusic（本站聚合音源）────────────────────────────────────────
// 對外只呈現一個來源 WhyMusic，底下扇出到多個子音源：
//   netease / joox  → 經上游 GD Music API（music-api.gdstudio.xyz）代理
//   audiomack       → 走本站自己的 OAuth 實作（searchAudiomack / getAudiomackMedia）
// 三者各自補足對方的缺口：netease 簡體曲庫最全、joox 港台繁體與粵語 live 版本多、
// audiomack 則是歐美獨立音樂 / hip-hop / afrobeats。
//
// 未納入 kuwo 與 bilibili：2026-08-18 實測 kuwo 的 url 端點恆回空字串、
// bilibili 回 HTML，兩者搜尋雖可用但點下去播不出來，列進來只會變成啞彈。
// YouTube 亦未納入：全 client 需 PoToken/BotGuard，非本站能修。
const GD_API = process.env.GD_API_URL || 'https://music-api.gdstudio.xyz/api.php'

/** audiomack 不由 GD 代理，需與其餘子源分流處理 */
const AUDIOMACK_SOURCE = 'audiomack'

const WHY_SOURCES = (process.env.WHY_MUSIC_SOURCES || 'netease,joox')
  .split(',').map(s => s.trim()).filter(Boolean)
/** 由上游 GD API 代理的子源 */
const GD_SOURCES = WHY_SOURCES.filter(s => s !== AUDIOMACK_SOURCE)
const GD_BITRATE = parseInt(process.env.WHY_MUSIC_BITRATE || '320', 10)

// 推薦頁的五個分類，一個分類對一份網易雲榜單（與 plugins/whymusic.js 的
// CATEGORIES 是同一份對應，兩邊都要能獨立運作：插件先問這裡，這裡不通它才直連）。
//
// 這個端點存在的意義就是**把量壓下來**：榜單原始回應 200KB–2.4MB（叱咤903 是
// 1000 首／2.4MB），瀏覽器直連要 4 秒以上，而這裡抓過一次就進 TTL 快取、對外
// 只回裁切後的幾十首 ≈ 15KB，全站共用。
//
// 榜單本身已排好序（排行榜的順序就是它的意義），所以不再有「最新／熱門」兩種排法。
// orders 是這份榜單要用幾種順序取樣（同一份抓回來的資料排兩次，不會多打上游）：
//   chart — 榜單本身的順序（叱咤榜是按發行時間降序，也就是「最新」）
//   pop   — 按網易雲的 pop 熱度降序，也就是「熱門」
// 粵語兩種都要：叱咤榜有 1000 首，光看原順序只會看到最近幾週發行的，那些真正
// 紅的粵語歌反而看不到。
const GD_CATEGORIES = {
  hot: { list: '3778678', orders: ['chart'] },          // 熱歌榜（每小時更新，跨語種總熱門）
  cantonese: { list: '5097494848', orders: ['chart', 'pop'] }, // 叱咤903 —— 唯一還在更新的粵語榜
  cpop: { list: '3779629', orders: ['chart'] },         // 新歌榜（華語為主，每天更新）
  kpop: { list: '745956260', orders: ['chart'] },       // 韓語榜（每天更新）
  western: { list: '2809513713', orders: ['chart'] },   // 歐美熱歌榜（每天更新）
}

/**
 * 一份榜單按指定順序排列。
 *   chart — 原順序（榜單自己排好的）
 *   pop   — 熱度降序；同熱度以發行時間新者優先，否則前段會擠滿一堆 pop=100
 *           的曲目而順序毫無意義
 */
function sortTracks(tracks, order) {
  if (order !== 'pop') return tracks
  return [...tracks].sort((a, b) =>
    ((b.pop ?? 0) - (a.pop ?? 0)) || ((b.publishTime ?? 0) - (a.publishTime ?? 0)))
}
const DEFAULT_CATEGORY = 'cantonese'
/** 給路由層驗證用（收到沒見過的 cat 就退回預設） */
const RECOMMEND_CATEGORIES = Object.keys(GD_CATEGORIES)

// 上游按 IP 限流，而本服務所有使用者共用同一出口 IP，故一律走 TTL 快取。
// playlist 是榜單：前端每次開都會來拿，所以這層快取決定使用者實際看到的新鮮度。
// 10 分鐘 —— 短到榜單一動就跟上，長到不會讓每個訪客都去打一次 2.4MB 的上游。
const GD_TTL = { search: 600e3, url: 1200e3, pic: 864e5, lyric: 864e5, playlist: 600e3 }
const GD_CACHE_MAX = 500
const gdCache = new Map()

function gdCacheGet(key) {
  const hit = gdCache.get(key)
  if (!hit) return undefined
  if (Date.now() > hit.expires) {
    gdCache.delete(key)
    return undefined
  }
  return hit.value
}

function gdCacheSet(key, value, ttl) {
  // 到上限就從最舊的開始清（Map 保留插入順序），清到八成滿為止
  if (gdCache.size >= GD_CACHE_MAX) {
    for (const k of gdCache.keys()) {
      gdCache.delete(k)
      if (gdCache.size <= GD_CACHE_MAX * 0.8) break
    }
  }
  gdCache.set(key, { value, expires: Date.now() + ttl })
}

async function gdRequest(types, params) {
  const query = new URLSearchParams({ types, ...params }).toString()
  const cached = gdCacheGet(query)
  if (cached !== undefined) return cached

  const response = await fetch(`${GD_API}?${query}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept': 'application/json',
    },
  })
  const text = await response.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    // 上游對不支援的參數組合會回 HTML 錯誤頁
    throw new Error(`GD Music 回應非 JSON (HTTP ${response.status}): ${text.slice(0, 120)}`)
  }
  if (!response.ok || data?.detail) {
    throw new Error(`GD Music API error: ${data?.detail || `HTTP ${response.status}`}`)
  }
  gdCacheSet(query, data, GD_TTL[types] || 600e3)
  return data
}

// 繁 → 簡 常用字對照：上游（網易雲）資料多為簡體，本站 UI 與 Audiomack
// 曲目多為繁體，跨源比對同一首歌時需要歸一化（「浮誇」↔「浮夸」）。
const GD_T2S = {
  傑: '杰', 倫: '伦', 週: '周', 風: '风', 東: '东', 華: '华', 國: '国', 學: '学',
  對: '对', 說: '说', 記: '记', 開: '开', 關: '关', 點: '点', 機: '机', 電: '电',
  車: '车', 門: '门', 問: '问', 間: '间', 見: '见', 話: '话', 實: '实', 書: '书',
  長: '长', 認: '认', 識: '识', 飛: '飞', 魚: '鱼', 鳥: '鸟', 馬: '马', 龍: '龙',
  雲: '云', 霧: '雾', 頭: '头', 頁: '页', 項: '项', 順: '顺', 須: '须', 體: '体',
  誇: '夸', 愛: '爱', 樂: '乐', 夢: '梦', 淚: '泪', 戀: '恋', 願: '愿', 歲: '岁',
  舊: '旧', 過: '过', 還: '还', 這: '这', 個: '个', 們: '们', 來: '来', 時: '时',
  後: '后', 從: '从', 當: '当', 應: '应', 該: '该', 離: '离', 別: '别', 遠: '远',
  邊: '边', 裡: '里', 內: '内', 萬: '万', 億: '亿', 聽: '听', 觀: '观', 讀: '读',
  寫: '写', 語: '语', 詞: '词', 詩: '诗', 聲: '声', 響: '响', 靜: '静', 續: '续',
  終: '终', 結: '结', 緣: '缘', 總: '总', 經: '经', 歷: '历', 變: '变', 換: '换',
  轉: '转', 動: '动', 靈: '灵', 獨: '独', 單: '单', 雙: '双', 誰: '谁', 為: '为',
  無: '无', 沒: '没', 給: '给', 將: '将', 帶: '带', 讓: '让', 覺: '觉', 錯: '错',
  難: '难', 歡: '欢', 樣: '样', 麼: '么', 嗎: '吗', 傷: '伤', 錢: '钱', 醫: '医',
}

/** 歸一化歌名/歌手：去括號註記、去標點空白、繁轉簡、轉小寫 */
function gdNormalizeName(text) {
  const stripped = String(text || '')
    .toLowerCase()
    // 去掉 (Live)、（電視劇主題曲）、[Explicit] 這類註記
    .replace(/[（([【].*?[)）\]】]/g, '')
    .replace(/[\s\-_·・,，.。!！?？'"'"、/\\|&+]/g, '')
  let out = ''
  for (const ch of stripped) out += GD_T2S[ch] || ch
  return out
}

/** 判斷搜尋結果是否為目標歌曲（歌名相符 + 歌手互相包含，支援繁簡） */
function gdIsSameSong(candidate, target) {
  const ct = gdNormalizeName(candidate.title)
  const tt = gdNormalizeName(target.title)
  if (!ct || !tt) return false
  if (ct !== tt && !ct.startsWith(tt) && !tt.startsWith(ct)) return false
  const ta = gdNormalizeName(target.artist)
  if (!ta) return true  // 目標無歌手資訊，歌名相符即可
  const ca = gdNormalizeName(candidate.artist)
  if (!ca) return false
  // 歌手可能是「陳奕迅 / MissG」這種拼接，歸一化後互相包含即算命中
  return ca.includes(ta) || ta.includes(ca)
}

/** GD 歌曲 → 本站 MusicItem */
function gdNormalizeSong(raw, fallbackSource) {
  const artist = Array.isArray(raw.artist)
    ? raw.artist.filter(Boolean).join(' / ')
    : String(raw.artist || '')
  return {
    id: String(raw.url_id || raw.id || ''),
    title: String(raw.name || ''),
    artist,
    album: String(raw.album || ''),
    platform: 'WhyMusic',
    // GD 的子音源（netease / joox…），播放時要原樣帶回上游
    subSource: String(raw.source || fallbackSource || ''),
    picId: raw.pic_id ? String(raw.pic_id) : '',
    lyricId: raw.lyric_id ? String(raw.lyric_id) : '',
    type: 'music',
  }
}

/** Audiomack 搜尋結果 → WhyMusic MusicItem */
function audiomackToWhyItem(raw) {
  return {
    id: String(raw.id || ''),
    title: String(raw.title || ''),
    artist: String(raw.artist || ''),
    album: '',
    platform: 'WhyMusic',
    subSource: AUDIOMACK_SOURCE,
    artwork: raw.artwork || '',
    duration: raw.duration || 0,
    // Audiomack 的專輯/歌單端點需要 slug 才能還原，music 類型留著不影響
    urlSlug: String(raw.url_slug || ''),
    picId: '',
    lyricId: '',
    type: 'music',
  }
}

/**
 * Audiomack 的專輯/歌單/歌手結果 → WhyMusic。
 * 外層與內層 musicList 都要改掛，否則點進專輯後每首歌的 platform 仍是
 * Audiomack，會走錯播放分支。
 */
function audiomackContainerToWhyItem(raw) {
  return {
    ...raw,
    platform: 'WhyMusic',
    subSource: AUDIOMACK_SOURCE,
    musicList: (raw.musicList || []).map(track => ({
      ...track,
      platform: 'WhyMusic',
      subSource: AUDIOMACK_SOURCE,
    })),
  }
}

/** 取單一子源的搜尋結果：audiomack 走自家 OAuth，其餘經 GD 上游 */
async function searchWhySubSource(source, keyword, page, count) {
  if (source === AUDIOMACK_SOURCE) {
    const list = await searchAudiomack(keyword, 'music', page)
    return list.map(audiomackToWhyItem)
  }
  const data = await gdRequest('search', {
    source, name: keyword, count: String(count), pages: String(page),
  })
  return Array.isArray(data) ? data.map(raw => gdNormalizeSong(raw, source)) : []
}

/** 多源並發搜尋：各源輪流取一首後合併，同名同歌手去重 */
async function searchWhyMusic(keyword, page = 1, count = 20) {
  const settled = await Promise.allSettled(
    WHY_SOURCES.map(source => searchWhySubSource(source, keyword, page, count)),
  )
  const buckets = settled.map((r, i) => {
    if (r.status === 'fulfilled') return r.value
    console.error(`[why] search failed on ${WHY_SOURCES[i]}: ${r.reason?.message}`)
    return []
  })

  const seen = new Set()
  const merged = []
  const maxLen = Math.max(0, ...buckets.map(b => b.length))
  for (let idx = 0; idx < maxLen; idx++) {
    for (const bucket of buckets) {
      const item = bucket[idx]
      if (!item || !item.id || !item.title) continue
      const key = `${gdNormalizeName(item.title)}::${gdNormalizeName(item.artist)}`
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(item)
    }
  }
  return merged
}

async function getGdUrl(songId, source, bitrate = GD_BITRATE) {
  const data = await gdRequest('url', { source, id: songId, br: String(bitrate) })
  return data?.url || ''
}

/** 取單一子源的播放 URL：audiomack 走自家 OAuth，其餘經 GD 上游 */
async function getWhySubSourceUrl(songId, source, bitrate = GD_BITRATE) {
  if (source === AUDIOMACK_SOURCE) return await getAudiomackMedia(songId)
  return await getGdUrl(songId, source, bitrate)
}

/**
 * 取可播放的音源 URL。
 * 指定子源拿不到時（GD 上游對部分曲目回空字串、Audiomack 對授權曲目回
 * 1005 Not authorized），用歌名+歌手到其餘子源找同一首歌再試。
 * 這是跨子源救援路徑，繁簡歸一化讓「浮誇」也能在簡體源命中。
 */
async function resolveWhyMusicUrl({ id, source, bitrate, title, artist, exclude }) {
  // exclude：呼叫端已知播不出來的子源。伺服器端只看得到「解析失敗」，但有些
  // URL 解析成功卻在客戶端播不出來（CDN 對該地區回 403、容器格式不支援…），
  // 那種情況只有前端知道，所以要讓它把壞掉的子源排除後重新解析。
  const skip = new Set(Array.isArray(exclude) ? exclude : [])
  const primary = source || WHY_SOURCES[0]
  if (id && !skip.has(primary)) {
    try {
      const direct = await getWhySubSourceUrl(id, primary, bitrate)
      if (direct) return { url: direct, source: primary, id }
    } catch (err) {
      console.error(`[why] url failed ${primary}/${id}: ${err.message}`)
    }
  }

  const keyword = [title, artist].filter(Boolean).join(' ').trim()
  if (!keyword) return null
  for (const candidateSource of WHY_SOURCES) {
    if (skip.has(candidateSource)) continue
    // 主源已用 id 直取過，不重複試
    if (candidateSource === primary && id) continue
    try {
      const list = await searchWhySubSource(candidateSource, keyword, 1, 5)
      for (const candidate of list.slice(0, 3)) {
        if (!candidate.id || !gdIsSameSong(candidate, { title, artist })) continue
        const url = await getWhySubSourceUrl(candidate.id, candidateSource, bitrate)
        if (url) return { url, source: candidateSource, id: candidate.id, matched: candidate }
      }
    } catch (err) {
      console.error(`[why] fallback search failed on ${candidateSource}: ${err.message}`)
    }
  }
  return null
}

// 歌詞與封面只有 GD 代理的子源提供。Audiomack 沒有對應端點（封面在搜尋
// 結果就隨 artwork 回來了），直接回空值，不要拿 source=audiomack 去打 GD。
async function getWhyMusicLyric(lyricId, source) {
  if (source === AUDIOMACK_SOURCE) return { lyric: '', tlyric: '' }
  const data = await gdRequest('lyric', { source, id: lyricId })
  return { lyric: data?.lyric || '', tlyric: data?.tlyric || '' }
}

async function getWhyMusicPic(picId, source, size = 500) {
  if (source === AUDIOMACK_SOURCE) return ''
  const data = await gdRequest('pic', { source, id: picId, size: String(size) })
  return data?.url || ''
}

/** 推薦頁：香港叱咤903榜單（回應自帶封面，無需逐首取圖） */
/**
 * 網易雲圖床支援 ?param=寬y高 取縮圖。榜單封面原圖一張 2~3MB，一頁列表
 * 幾十張就是幾十 MB —— 光封面就能拖垮載入與流量。列表縮圖 300 已夠
 * Retina 螢幕用；播放中的大圖另走 pic 端點拿高清。順手升 https（圖床
 * 雙協定都通，http 在網頁版是 mixed content）。
 */
function thumbArtwork(picUrl) {
  const url = String(picUrl || '')
  if (!url) return ''
  if (!/\bmusic\.126\.net\//.test(url)) return url
  return url.replace(/^http:/, 'https:')
    + (url.includes('?') ? '&' : '?') + 'param=300y300'
}

/** 網易雲榜單曲目 → 本站 MusicItem（缺 id 或歌名的丟掉） */
function gdTrackToItem(track) {
  const title = String(track.name || '')
  if (!track.id || !title) return null
  const album = track.al || track.album || {}
  return {
    id: String(track.id),
    title,
    artist: (track.ar || track.artists || []).map(a => a.name).filter(Boolean).join(' / '),
    album: String(album.name || ''),
    artwork: thumbArtwork(album.picUrl),
    platform: 'WhyMusic',
    subSource: 'netease',
    picId: album.pic_str || (album.pic != null ? String(album.pic) : ''),
    lyricId: String(track.id),
    duration: track.dt ? Math.round(track.dt / 1000) : 0,
    type: 'music',
  }
}

// ── 專輯（網易雲） ──────────────────────────────────────────────────
/**
 * 網易雲的公開端點。專輯資料只有它有 —— GD 的聚合 API 沒有專輯類型
 * （types=album/albuminfo/albumlist 全部回 "not supported"）。
 *
 * **它會隨機拒絕請求**：同一個網址連打，回應在 `code: 200` 與
 * `code: -462`（要求手機驗證、資料為空、HTTP 仍是 200）之間跳。實測從
 * Cloudflare 出去的成功率只有四成左右，而從家用網路直連是百分之百 ——
 * 差別在出口 IP：CF 的出口是共用池，其中一部分被網易雲標記了，而每次請求
 * 走哪個 IP 是隨機的。
 *
 * 所以重試是有效的（換一次請求就有機會換到乾淨的 IP），而且要重試在**後端**：
 *   - 六次嘗試把成功率從 42% 拉到 96%
 *   - 成功結果進全站共用快取，第二個人點同一張專輯不必再賭一次
 *   - 前端只發一個請求，不必自己處理這個上游的怪脾氣
 */
/**
 * 同一份 API 的多個主機。實測三個都回一樣的資料，但**不會同時被擋** ——
 * 限流是按（出口 IP × 主機）算的，所以重試時換主機比原地重試有效得多：
 * 原地連試六次只有 75% 成功，輪替三個主機後實測沒有再失敗過。
 */
const NETEASE_HOSTS = [
  'https://music.163.com',
  'https://interface.music.163.com',
  'https://interface3.music.163.com',
]
/** 每個主機試幾輪。3 主機 × 2 輪 = 6 次嘗試 */
const NETEASE_ROUNDS = 2

async function neteaseFetch(path) {
  const cacheKey = `netease:${path}`
  const cached = gdCacheGet(cacheKey)
  if (cached !== undefined) return cached

  let blocked = false
  for (let round = 0; round < NETEASE_ROUNDS; round++) {
    for (const host of NETEASE_HOSTS) {
      let data
      try {
        const resp = await fetch(host + path, {
          headers: {
            Referer: 'https://music.163.com',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          },
        })
        data = await resp.json()
      } catch {
        continue  // 網路層失敗，換下一個主機
      }
      // -462 = 被要求驗證（資料是空的）→ 換主機再試
      if (data && data.code === -462) { blocked = true; continue }
      gdCacheSet(cacheKey, data, GD_TTL.playlist)
      return data
    }
  }
  throw new Error(
    blocked ? '網易雲要求驗證（上游限流），請稍後再試' : '網易雲無回應',
  )
}

/** 網易雲專輯 → 本站 MusicItem（type=album，前端據此開專輯頁而不是直接播） */
function neteaseAlbumToItem(raw) {
  if (!raw || !raw.id || !raw.name) return null
  const artists = (raw.artists || (raw.artist ? [raw.artist] : []))
    .map(a => a && a.name).filter(Boolean).join(' / ')
  return {
    id: String(raw.id),
    title: String(raw.name),
    artist: artists,
    album: String(raw.name),
    artwork: thumbArtwork(raw.picUrl || raw.blurPicUrl),
    platform: 'WhyMusic',
    subSource: 'netease',
    worksNum: Number(raw.size) || 0,
    type: 'album',
  }
}

/** 專輯搜尋（網易雲 type=10） */
async function searchWhyMusicAlbums(keyword, page = 1, limit = 20) {
  const offset = (Math.max(1, Number(page) || 1) - 1) * limit
  const data = await neteaseFetch(
    `/api/search/get?s=${encodeURIComponent(keyword)}&type=10&limit=${limit}&offset=${offset}`,
  )
  const albums = (data && data.result && data.result.albums) || []
  return albums.map(neteaseAlbumToItem).filter(Boolean)
}

/**
 * 專輯曲目。用 /api/v1/album/{id} —— 舊的 /api/album/{id} 現在一律回
 * code -462 要求綁定手機，v1 那條不用。
 *
 * 回傳的是 netease 曲目，所以照現有的播放鏈路（resolveWhyMusicUrl）就能播。
 */
async function getWhyMusicAlbum(id) {
  const data = await neteaseFetch(`/api/v1/album/${encodeURIComponent(id)}`)
  const songs = (data && data.songs) || []
  return songs.map(gdTrackToItem).filter(Boolean)
}


/**
 * 推薦：取一份榜單、去重、裁到 limit。
 *
 * 裁切後的結果自己進快取（鍵含 limit），而不是只靠 gdRequest 快取原始回應 ——
 * 叱咤那份解析後在記憶體裡是好幾十 MB，這台機器只有 256MB，留著整份不划算。
 */
/**
 * 輪替視窗：從整份榜單裡取哪一段。
 *
 * 榜單本身很少動（叱咤一週一次、網易雲的日榜一天一次），所以就算每次開 app
 * 都重抓，同一天看到的還是那幾首 —— 使用者說的「更新頻率太慢」其實是這個。
 * 但榜單有的歌遠比我們顯示的多（粵語 1000 首、熱門與歐美 200、其餘 100，
 * 而畫面只放 80），所以換一段取就有新歌可看，不必等上游更新。
 *
 * 用時間分桶而不是每次隨機：同一段時間內重複開、切分類再切回來，看到的
 * 是同一批歌 —— 清單在使用者眼皮底下跳動比「一直是舊的」更糟。
 *
 * 一天一桶：跟榜單自己的更新節奏對齊（網易雲日榜一天一次），使用者一天內
 * 反覆開 app 看到的是同一批歌，隔天才換 —— 那是「今天的推薦」該有的樣子。
 * 更短的桶（試過 15 分鐘）會讓早上和下午看到完全不同的清單，找不回上午
 * 想聽但沒點的那首。
 *
 * 取法是「以日期桶＋榜單做種子的確定性洗牌」而不是換窗口：窗口對不足兩頁的
 * 池子（Kpop／中文去重後 ~100 首、畫面 80 首）相鄰兩天重疊七成多，看起來就
 * 像沒更新。洗牌讓池子再小每天也是全新的順序與選曲；種子一天一換，當天內
 * 反覆開 app 算出來的都是同一批。
 */
const ROTATE_BUCKET_MS = 24 * 60 * 60 * 1000

function dailyShuffle(list, limit, seedKey = '') {
  if (list.length === 0) return []
  let seed = Math.floor(Date.now() / ROTATE_BUCKET_MS)
  const s = String(seedKey)
  for (let i = 0; i < s.length; i++) seed = (seed * 31 + s.charCodeAt(i)) | 0
  // mulberry32：夠均勻的小型 PRNG，Worker／Node／瀏覽器沙箱都能跑
  let a = seed >>> 0
  const rand = () => {
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const arr = list.slice()
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp
  }
  return arr.slice(0, limit)
}

async function recommendWhyMusic(category = DEFAULT_CATEGORY, limit = 40, seed = '0') {
  const cat = GD_CATEGORIES[category] || GD_CATEGORIES[DEFAULT_CATEGORY]
  const orders = cat.orders || ['chart']
  // 快取鍵帶上輪替桶：換了桶就是不同的一段歌，不能沿用上一桶的結果
  const bucket = Math.floor(Date.now() / ROTATE_BUCKET_MS)
  const cacheKey = `rec:${cat.list}:${orders.join('+')}:${limit}:${bucket}:${seed}`
  const cached = gdCacheGet(cacheKey)
  if (cached !== undefined) return cached

  const data = await gdRequest('playlist', { source: 'netease', id: cat.list })
  const tracks = data?.playlist?.tracks || []

  // 每種順序各排一份，再輪流取一首交錯合併、同名同歌手去重。
  // 交錯而非串接：串接的話 limit 會被第一種順序吃光，第二種等於沒接上。
  const buckets = orders.map(
    order => sortTracks(tracks, order).map(gdTrackToItem).filter(Boolean),
  )
  // 先交錯合併**整份**榜單（不再邊合併邊裁到 limit）—— 要輪替就得先有完整的池子
  const seen = new Set()
  const merged = []
  const maxLen = Math.max(0, ...buckets.map(b => b.length))
  for (let idx = 0; idx < maxLen; idx++) {
    for (const b of buckets) {
      const item = b[idx]
      if (!item) continue
      const key = `${gdNormalizeName(item.title)}::${gdNormalizeName(item.artist)}`
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(item)
    }
  }
  const out = dailyShuffle(merged, limit, `${cat.list}:${seed}`)
  gdCacheSet(cacheKey, out, GD_TTL.playlist)
  return out
}

// ── HTTP Server ──────────────────────────────────────────────────

const gzip = promisify(gzipCb)

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': '*',
  }
}

function jsonResponse(res, data, status = 200) {
  res.writeHead(status, {
    ...corsHeaders(),
    'Content-Type': 'application/json',
    // 與 CF 版一致：不讓中間層（nginx / CDN）快取 API 回應。上游回應的快取
    // 由本服務自己的 TTL cache 負責，外層再快取只會造成換版後拿到舊內容。
    'Cache-Control': 'no-store',
  })
  res.end(JSON.stringify(data))
}

/** 值得壓的型別。圖片與字型本身已經是壓縮格式，再壓只是浪費 CPU */
const COMPRESSIBLE = new Set([
  '.html', '.css', '.js', '.json', '.svg', '.webmanifest', '.map', '.txt',
])
/** 小於這個大小不壓 —— gzip 的標頭與 CPU 換不回什麼 */
const GZIP_MIN = 1024

/**
 * 壓好的靜態檔快取（路徑 + mtime → gzip buffer）。
 *
 * 靜態檔在部署之間不會變，所以壓一次就好；帶上 mtime 當鍵，換版後自動失效。
 * 這台機器只有 256MB，但整個 dist 壓完也就幾百 KB，划算得很。
 */
const gzipCache = new Map()

async function gzipStatic(filePath, content, mtimeMs) {
  const key = `${filePath}:${mtimeMs}`
  const hit = gzipCache.get(key)
  if (hit) return hit
  const zipped = await gzip(content)
  // 壓不小就別用（極少數情況），存 null 表示「這個檔不要壓」
  const value = zipped.length < content.length ? zipped : null
  gzipCache.set(key, value)
  return value
}

/**
 * 靜態檔。做兩件在慢線路上很有感的事：
 *
 *   1. gzip —— 前端 bundle 是 789KB，壓完約 247KB。原本兩邊都沒壓（nginx 的
 *      gzip 是註解掉的預設值），所以每次開站都在傳三倍的量。壓縮做在這裡而不是
 *      nginx，是因為服務也會被直接訪問（不經 nginx 的那個埠），而且換部署環境
 *      時不必再設一次。
 *   2. Cache-Control —— 原本一個快取標頭都沒有，瀏覽器每次開站都重抓整包 bundle。
 *      /assets/ 底下的檔名帶內容雜湊（換版必換名），可以放心 immutable；
 *      index.html 與 sw.js 則必須 no-cache，否則換版後拿到舊的入口。
 */
async function serveStatic(res, filePath, extraHeaders) {
  const ext = path.extname(filePath)
  const contentType = MIME_TYPES[ext] || 'application/octet-stream'

  try {
    const [content, stat] = await Promise.all([
      fs.promises.readFile(filePath),
      fs.promises.stat(filePath),
    ])
    const headers = {
      'Content-Type': contentType,
      ...corsHeaders(),
      // 檔名帶雜湊的資產可以永久快取；入口檔不行
      'Cache-Control': filePath.includes(`${path.sep}assets${path.sep}`)
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
      ...extraHeaders,
    }

    const wantsGzip = /\bgzip\b/.test(res.req?.headers['accept-encoding'] || '')
    if (wantsGzip && COMPRESSIBLE.has(ext) && content.length >= GZIP_MIN) {
      const zipped = await gzipStatic(filePath, content, stat.mtimeMs)
      if (zipped) {
        res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' })
        res.end(zipped)
        return true
      }
    }
    res.writeHead(200, headers)
    res.end(content)
  } catch {
    return false
  }
  return true
}

// 關閉中旗標。收到終止訊號後 /healthz 改回 503，讓負載平衡器/監控在排空期間
// 就把這台標記為不健康、停止導流進來。宣告在此以便 request handler 讀得到。
let shuttingDown = false

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const pathname = url.pathname

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders())
    res.end()
    return
  }

  // 健康檢查：給 systemd/OpenRC/監控判活。刻意放在所有邏輯之前、不碰外部相依，
  // 純粹回「這個程序還在收請求」。回 503 若正在關閉中（見下方 shutdown）。
  if (pathname === '/healthz') {
    if (shuttingDown) {
      res.writeHead(503, { 'Content-Type': 'text/plain' })
      res.end('shutting down')
    } else {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('ok')
    }
    return
  }

  try {
    // ── API: /api/search ─────────────────────────────────
    if (pathname === '/api/search') {
      const keyword = url.searchParams.get('q')
      const type = url.searchParams.get('type') || 'music'
      const page = parseInt(url.searchParams.get('page') || '1', 10)
      if (!keyword) {
        jsonResponse(res, { error: 'Missing q parameter' }, 400)
        return
      }
      const results = await searchAudiomack(keyword, type, page)
      jsonResponse(res, results)
      return
    }

    // ── API: /api/yt-search ──────────────────────────────
    // YouTube 搜尋（供 Audiomack 無源歌曲的播放 fallback 使用）
    if (pathname === '/api/yt-search') {
      const keyword = url.searchParams.get('q')
      if (!keyword) {
        jsonResponse(res, { error: 'Missing q parameter' }, 400)
        return
      }
      try {
        const results = await searchYouTube(keyword)
        jsonResponse(res, results)
      } catch (err) {
        console.error('[yt-search] Error:', err.message)
        jsonResponse(res, { error: err.message }, 500)
      }
      return
    }

    // ── API: /api/why-search ──────────────────────────────
    // GD Music 多源聚合搜尋（netease / joox 並發）
    if (pathname === '/api/why-search') {
      const keyword = url.searchParams.get('q')
      const type = url.searchParams.get('type') || 'music'
      const page = parseInt(url.searchParams.get('page') || '1', 10)
      const count = parseInt(url.searchParams.get('count') || '20', 10)
      if (!keyword) {
        jsonResponse(res, { error: 'Missing q parameter' }, 400)
        return
      }
      try {
        // 歌曲走多子源聚合；專輯/歌單/歌手只有 Audiomack 子源提供
        // （GD 上游沒有這些搜尋類型），故單獨走 Audiomack 再改掛 WhyMusic
        // 只支援歌曲。專輯／歌單／歌手原本只有 audiomack 提供，該子源已移除，
        // 留著這條路只會回播不出來的內容。
        if (type !== 'music') {
          jsonResponse(res, { error: `不支援的搜尋類型：${type}`, data: [] }, 400)
          return
        }
        jsonResponse(res, { data: await searchWhyMusic(keyword, page, count) })
      } catch (err) {
        console.error('[why-search] Error:', err.message)
        jsonResponse(res, { error: err.message }, 500)
      }
      return
    }

    // ── API: /api/why-url ─────────────────────────────────
    // 取 GD Music 音源 URL。帶 title/artist 時，指定源拿不到會跨源找同一首歌
    if (pathname === '/api/why-url') {
      const songId = url.searchParams.get('id') || ''
      const source = url.searchParams.get('source') || ''
      const bitrate = parseInt(url.searchParams.get('br') || String(GD_BITRATE), 10)
      const title = url.searchParams.get('title') || ''
      const artist = url.searchParams.get('artist') || ''
      // 前端已知播不出來的子源（客戶端才知道的失敗，見 resolveWhyMusicUrl 註解）
      const exclude = (url.searchParams.get('exclude') || '')
        .split(',').map(s => s.trim()).filter(Boolean)
      if (!songId && !title) {
        jsonResponse(res, { error: 'Missing id or title parameter' }, 400)
        return
      }
      try {
        const resolved = await resolveWhyMusicUrl({ id: songId, source, bitrate, title, artist, exclude })
        if (!resolved) {
          jsonResponse(res, { error: 'No playable GD Music source found' }, 404)
          return
        }
        jsonResponse(res, resolved)
      } catch (err) {
        console.error('[gd-url] Error:', err.message)
        jsonResponse(res, { error: err.message }, 500)
      }
      return
    }

    // ── API: /api/why-lyric ───────────────────────────────
    if (pathname === '/api/why-lyric') {
      const lyricId = url.searchParams.get('id')
      const source = url.searchParams.get('source') || GD_SOURCES[0]
      if (!lyricId) {
        jsonResponse(res, { error: 'Missing id parameter' }, 400)
        return
      }
      try {
        jsonResponse(res, await getWhyMusicLyric(lyricId, source))
      } catch (err) {
        console.error('[gd-lyric] Error:', err.message)
        jsonResponse(res, { error: err.message }, 500)
      }
      return
    }

    // ── API: /api/why-pic ─────────────────────────────────
    // ── API: /api/why-album-search、/api/why-album ────────
    // 專輯走網易雲（GD 沒有專輯類型）。重試與快取都在後端 —— 那個上游會隨機
    // 拒絕請求，見 neteaseFetch。
    if (pathname === '/api/why-album-search') {
      const kw = url.searchParams.get('kw')
      if (!kw) { jsonResponse(res, { error: 'Missing kw parameter' }, 400); return }
      const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1)
      const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') || '20', 10) || 20))
      try {
        jsonResponse(res, { data: await searchWhyMusicAlbums(kw, page, limit) })
      } catch (err) {
        console.error('[why-album-search]', err.message)
        jsonResponse(res, { error: err.message }, 502)
      }
      return
    }

    if (pathname === '/api/why-album') {
      const id = url.searchParams.get('id')
      if (!id) { jsonResponse(res, { error: 'Missing id parameter' }, 400); return }
      try {
        jsonResponse(res, { data: await getWhyMusicAlbum(id) })
      } catch (err) {
        console.error('[why-album]', err.message)
        jsonResponse(res, { error: err.message }, 502)
      }
      return
    }

    if (pathname === '/api/why-pic') {
      const picId = url.searchParams.get('id')
      const source = url.searchParams.get('source') || GD_SOURCES[0]
      const size = parseInt(url.searchParams.get('size') || '500', 10)
      if (!picId) {
        jsonResponse(res, { error: 'Missing id parameter' }, 400)
        return
      }
      try {
        jsonResponse(res, { url: await getWhyMusicPic(picId, source, size) })
      } catch (err) {
        console.error('[gd-pic] Error:', err.message)
        jsonResponse(res, { error: err.message }, 500)
      }
      return
    }

    // ── API: /api/recommend ───────────────────────────────
    // cat = 分類（hot / cantonese / cpop / kpop / western），各對一份網易雲榜單。
    // 音源插件會先打這裡拿裁切過的結果（榜單原始回應最大 2.4MB，這裡只回幾十首），
    // 打不通才自己直連 GD。認不出的 cat 退回預設而不是回 400 —— 舊版插件不帶它。
    if (pathname === '/api/recommend') {
      const requested = url.searchParams.get('cat') || ''
      const category = RECOMMEND_CATEGORIES.includes(requested) ? requested : DEFAULT_CATEGORY
      const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '40', 10) || 40))
      // seed：使用者按「刷新」時前端遞增它，換一批歌而不必等隔天。舊版插件不帶就是 0。
      const seed = url.searchParams.get('seed') || '0'
      try {
        jsonResponse(res, { category, data: await recommendWhyMusic(category, limit, seed) })
      } catch (err) {
        console.error('[recommend] Error:', err.message)
        jsonResponse(res, { error: err.message }, 500)
      }
      return
    }

    // ── API: /api/media ──────────────────────────────────
    if (pathname === '/api/media') {
      const songId = url.searchParams.get('id')
      const platform = url.searchParams.get('platform') || 'Audiomack'
      if (!songId) {
        jsonResponse(res, { error: 'Missing id parameter' }, 400)
        return
      }
      if (platform !== 'Audiomack') {
        jsonResponse(res, { error: `Platform not supported: ${platform}` }, 400)
        return
      }
      const result = await getAudiomackMedia(songId)
      jsonResponse(res, { url: result })
      return
    }

    // ── API: /api/download ───────────────────────────────
    // 下載歌曲：取得簽名音源 URL，伺服器串流回傳並設為附件下載
    if (pathname === '/api/download') {
      const songId = url.searchParams.get('id')
      const platform = url.searchParams.get('platform') || 'Audiomack'
      const fileTitle = url.searchParams.get('title') || 'song'
      const fileArtist = url.searchParams.get('artist') || ''
      if (!songId) {
        jsonResponse(res, { error: 'Missing id parameter' }, 400)
        return
      }
      let mediaUrl
      try {
        if (platform === 'Audiomack') {
          mediaUrl = await getAudiomackMedia(songId)
        } else if (platform === 'Youtube' || platform === 'YouTube') {
          mediaUrl = await getYouTubeMedia(songId)
        } else if (platform === 'WhyMusic') {
          const resolved = await resolveWhyMusicUrl({
            id: songId,
            source: url.searchParams.get('source') || '',
            bitrate: parseInt(url.searchParams.get('br') || String(GD_BITRATE), 10),
            title: fileTitle,
            artist: fileArtist,
          })
          mediaUrl = resolved?.url || null
        } else {
          jsonResponse(res, { error: `Platform not supported: ${platform}` }, 400)
          return
        }
      } catch (err) {
        console.error(`[download] Failed for ${songId}:`, err.message)
        jsonResponse(res, { error: `Failed to get media: ${err.message}` }, 500)
        return
      }
      if (!mediaUrl) {
        jsonResponse(res, { error: 'No media URL returned' }, 404)
        return
      }

      // 串流下載音頻
      try {
        const audioReq = await fetch(mediaUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            'Accept': '*/*',
          },
        })
        if (!audioReq.ok) {
          jsonResponse(res, { error: `Audio fetch failed: ${audioReq.status}` }, audioReq.status)
          return
        }
        const contentType = audioReq.headers.get('content-type') || 'audio/mpeg'
        const ext = contentType.includes('mp4') ? 'm4a' : contentType.includes('ogg') ? 'ogg' : contentType.includes('wav') ? 'wav' : 'mp3'
        const safeTitle = (fileTitle || 'song').replace(/[\\/:*?"<>|]/g, '_').trim()
        const filename = safeTitle ? `${safeTitle}.${ext}` : `song.${ext}`
        // 中文/非 ASCII 檔名需 RFC 5987 編碼，否則 Node 拒絕設定 header
        const asciiFilename = filename.replace(/[^\x20-\x7E]/g, '_')

        const headers = { ...corsHeaders() }
        headers['Content-Type'] = contentType
        headers['Content-Disposition'] = `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeURIComponent(filename)}`
        const cl = audioReq.headers.get('content-length')
        if (cl) headers['Content-Length'] = cl

        res.writeHead(200, headers)
        const reader = audioReq.body?.getReader()
        if (reader) {
          const pump = async () => {
            try {
              while (true) {
                const { done, value } = await reader.read()
                if (done) { res.end(); return }
                if (!res.write(Buffer.from(value))) {
                  res.once('drain', pump)
                  return
                }
              }
            } catch {
              res.end()
            }
          }
          pump()
        } else {
          const buf = await audioReq.arrayBuffer()
          res.end(Buffer.from(buf))
        }
        return
      } catch (err) {
        console.error(`[download] Stream error for ${songId}:`, err.message)
        jsonResponse(res, { error: `Stream error: ${err.message}` }, 500)
        return
      }
    }

    // ── API: /api/album ──────────────────────────────────
    // 專輯/歌單詳情：返回歌曲列表
    if (pathname === '/api/album') {
      const id = url.searchParams.get('id')
      const slug = url.searchParams.get('slug')
      const artist = url.searchParams.get('artist')
      if (!id || !slug || !artist) {
        jsonResponse(res, { error: 'Missing id, slug, or artist parameter' }, 400)
        return
      }
      const tracks = await getAudiomackAlbumOrSheet(id, slug, artist)
      // 專輯曲目改掛 WhyMusic：播放時才會走聚合分支，Audiomack 對該曲
      // 無授權（1005）時還能跨子源救援
      jsonResponse(res, Array.isArray(tracks)
        ? tracks.map(t => ({ ...t, platform: 'WhyMusic', subSource: AUDIOMACK_SOURCE }))
        : tracks)
      return
    }

    // ── API: /api/play ───────────────────────────────────
    // 統一音源流端點：所有平台的音頻都透過這個端點流回前端
    // 參數：id, platform
    if (pathname === '/api/play') {
      const playId = url.searchParams.get('id')
      const playPlatform = url.searchParams.get('platform') || ''
      if (!playId || !playPlatform) {
        jsonResponse(res, { error: 'Missing id or platform' }, 400)
        return
      }

      let mediaUrl = null
      try {
        if (playPlatform === 'Audiomack') {
          // Audiomack: 後端直接用 OAuth 簽名拿 signed URL
          mediaUrl = await getAudiomackMedia(playId)
        } else if (playPlatform === 'Youtube' || playPlatform === 'YouTube') {
          // YouTube: 後端調用 player API 拿音頻 URL
          mediaUrl = await getYouTubeMedia(playId)
        } else if (playPlatform === 'WhyMusic') {
          // GD Music: 指定子音源直取，拿不到則用歌名+歌手跨源救援
          const resolved = await resolveWhyMusicUrl({
            id: playId,
            source: url.searchParams.get('source') || '',
            bitrate: parseInt(url.searchParams.get('br') || String(GD_BITRATE), 10),
            title: url.searchParams.get('title') || '',
            artist: url.searchParams.get('artist') || '',
          })
          mediaUrl = resolved?.url || null
        }
      } catch (err) {
        console.error(`[play] Failed for ${playPlatform}/${playId}:`, err.message)
        jsonResponse(res, { error: `Failed to get media: ${err.message}` }, 500)
        return
      }

      if (!mediaUrl) {
        jsonResponse(res, { error: 'No media URL returned' }, 404)
        return
      }

      // 流式代理音頻
      const playHeaders = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
      }
      // 傳遞 Range
      if (req.headers['range']) playHeaders['Range'] = req.headers['range']

      try {
        const audioReq = await fetch(mediaUrl, {
          method: req.method,
          headers: playHeaders,
        })

        const respHeaders = { ...corsHeaders() }
        const ct = audioReq.headers.get('content-type') || 'audio/mpeg'
        respHeaders['Content-Type'] = ct
        if (audioReq.status === 206) {
          const cr = audioReq.headers.get('content-range')
          const cl = audioReq.headers.get('content-length')
          if (cr) respHeaders['Content-Range'] = cr
          if (cl) respHeaders['Content-Length'] = cl
          respHeaders['Accept-Ranges'] = 'bytes'
        }
        const ar = audioReq.headers.get('accept-ranges')
        if (ar) respHeaders['Accept-Ranges'] = ar
        // 加 Cache-Control 讓前端 cache
        respHeaders['Cache-Control'] = 'public, max-age=3600'

        res.writeHead(audioReq.status, respHeaders)
        const reader = audioReq.body?.getReader()
        if (reader) {
          const pump = async () => {
            try {
              while (true) {
                const { done, value } = await reader.read()
                if (done) { res.end(); return }
                if (!res.write(Buffer.from(value))) {
                  res.once('drain', pump)
                  return
                }
              }
            } catch {
              res.end()
            }
          }
          pump()
        } else {
          const buf = await audioReq.arrayBuffer()
          res.end(Buffer.from(buf))
        }
        return
      } catch (err) {
        console.error(`[play] Stream error for ${mediaUrl}:`, err.message)
        jsonResponse(res, { error: `Stream error: ${err.message}` }, 500)
        return
      }
    }

    // ── API: /api/proxy ──────────────────────────────────
    // 建置戳記。自托管版不經 esbuild，故在啟動時從 git 取（取不到就回 dev）
    if (pathname === '/api/version') {
      // 自架版的配對碼存在檔案系統（見 /api/sync），所以這裡回 true
      jsonResponse(res, { worker: SERVER_VERSION, sync: true })
      return
    }

    // ── API: /api/sync ───────────────────────────────────
    // 裝置配對碼。CF 版存 KV，這裡存檔案 —— 一組碼一個小 JSON，24 小時後過期。
    // 驗證規則與 CF 版共用 shared/sync.js，兩邊產生的碼格式必然一致。
    if (pathname === '/api/sync') {
      if (req.method === 'POST') {
        const raw = await new Promise((resolve) => {
          const chunks = []
          let size = 0
          req.on('data', (chunk) => {
            size += chunk.length
            // 邊收邊擋，別讓超大的請求先整包進記憶體 —— 這台機器只有 256MB
            if (size <= SYNC_MAX_BYTES) chunks.push(chunk)
          })
          req.on('end', () => resolve({ body: Buffer.concat(chunks).toString('utf8'), size }))
        })
        if (raw.size > SYNC_MAX_BYTES) {
          jsonResponse(res, { error: '資料過大，無法同步' }, 413)
          return
        }
        let parsed
        try {
          parsed = JSON.parse(raw.body)
        } catch {
          jsonResponse(res, { error: '請求格式錯誤' }, 400)
          return
        }
        const { error, clean } = validateSyncPayload(parsed)
        if (error) {
          jsonResponse(res, { error }, 400)
          return
        }
        sweepExpiredSyncCodes()
        fs.mkdirSync(SYNC_DIR, { recursive: true })
        const code = newSyncCode()
        fs.writeFileSync(
          path.join(SYNC_DIR, `${code}.json`),
          JSON.stringify({ plugins: clean, expires: Date.now() + SYNC_TTL * 1000 }),
        )
        jsonResponse(res, { code, expiresIn: SYNC_TTL })
        return
      }

      if (req.method === 'GET') {
        const code = normalizeSyncCode(url.searchParams.get('code'))
        // 長度檢查同時也是路徑防護：正規化只留 A-Z0-9，拼不出 ../
        if (code.length !== SYNC_CODE_LEN) {
          jsonResponse(res, { error: '同步碼格式不正確' }, 400)
          return
        }
        const file = path.join(SYNC_DIR, `${code}.json`)
        let stored
        try {
          stored = JSON.parse(fs.readFileSync(file, 'utf8'))
        } catch {
          jsonResponse(res, { error: '找不到這組同步碼，可能已過期（有效 24 小時）' }, 404)
          return
        }
        if (!stored.expires || Date.now() > stored.expires) {
          try { fs.unlinkSync(file) } catch { /* 已經不在了 */ }
          jsonResponse(res, { error: '找不到這組同步碼，可能已過期（有效 24 小時）' }, 404)
          return
        }
        jsonResponse(res, { plugins: stored.plugins })
        return
      }

      jsonResponse(res, { error: '不支援的方法' }, 405)
      return
    }

    if (pathname === '/api/proxy') {
      const targetUrl = url.searchParams.get('url')
      const method = url.searchParams.get('method') || req.method
      if (!targetUrl) {
        jsonResponse(res, { error: 'Missing url parameter' }, 400)
        return
      }
      // 限流：proxy 會實際去外部抓資料，不節流容易被灌爆或害上游封本機 IP
      if (proxyLimiter && !proxyLimiter.take(clientIp(req))) {
        jsonResponse(res, { error: '請求過於頻繁，請稍後再試' }, 429)
        return
      }
      // SSRF 防護：擋 file:// 之類的協定、私有／保留網段、以及網域解析後指向內網的
      // 繞過。不做這關的話，這個端點等於一個開放代理，任何人都能拿去打雲 metadata。
      const safe = await assertProxyTargetSafe(decodeURIComponent(targetUrl))
      if (!safe.ok) {
        console.warn(`[proxy] 拒絕 ${targetUrl}：${safe.reason}`)
        jsonResponse(res, { error: `拒絕代抓：${safe.reason}` }, 403)
        return
      }
      // Collect request body
      let body = null
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        body = await new Promise((resolve) => {
          const chunks = []
          req.on('data', chunk => chunks.push(chunk))
          req.on('end', () => resolve(Buffer.concat(chunks)))
        })
      }
      const proxyHeaders = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      }
      if (req.headers['content-type']) proxyHeaders['Content-Type'] = req.headers['content-type']
      if (req.headers['accept']) proxyHeaders['Accept'] = req.headers['accept']
      if (req.headers['range']) proxyHeaders['Range'] = req.headers['range']
      const ref = req.headers['referer'] || req.headers['referrer']
      if (ref) proxyHeaders['Referer'] = ref

      // 用剛剛驗證過的那個 URL 物件，不要再 decode 一次 —— 避免「檢查的是 A、
      // 實際抓的是 B」這種 TOCTOU 落差
      const proxyReq = await fetch(safe.url, {
        method,
        headers: proxyHeaders,
        body: body || undefined,
      })

      const targetContentType = proxyReq.headers.get('content-type') || 'application/octet-stream'
      const respHeaders = { ...corsHeaders(), 'Content-Type': targetContentType }
      if (proxyReq.status === 206) {
        const contentRange = proxyReq.headers.get('content-range')
        const contentLength = proxyReq.headers.get('content-length')
        if (contentRange) respHeaders['Content-Range'] = contentRange
        if (contentLength) respHeaders['Content-Length'] = contentLength
        respHeaders['Accept-Ranges'] = 'bytes'
      }
      if (proxyReq.status === 200 && !respHeaders['Accept-Ranges']) {
        respHeaders['Accept-Ranges'] = 'bytes'
      }
      const targetAcceptRanges = proxyReq.headers.get('accept-ranges')
      if (targetAcceptRanges) respHeaders['Accept-Ranges'] = targetAcceptRanges

      res.writeHead(proxyReq.status, respHeaders)
      const reader = proxyReq.body?.getReader()
      if (reader) {
        const pump = async () => {
          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) { res.end(); return }
              if (!res.write(Buffer.from(value))) {
                res.once('drain', pump)
                return
              }
            }
          } catch {
            res.end()
          }
        }
        pump()
      } else {
        const responseBody = await proxyReq.arrayBuffer()
        res.end(Buffer.from(responseBody))
      }
      return
    }

    // 這裡曾經有一條 /plugins/*.js 路由，直接從 repo 的 plugins/ 供應音源檔。
    // 已移除：那等於本服務隨附了音源，使用者在「設置」頁填 /plugins/whymusic.js
    // 就能用 —— 而這個專案的立場是音源由使用者自己提供，播放器不預設任何來源。
    // 要自架音源的人可以把自己的 .js 放進 dist/（或任何支援 CORS 的網址）。

    // ── Static files ────────────────────────────────────
    // SPA: serve index.html for non-file routes
    let filePath = path.join(STATIC_DIR, pathname === '/' ? 'index.html' : pathname)
    const served = await serveStatic(res, filePath)
    if (served) return

    // SPA fallback
    filePath = path.join(STATIC_DIR, 'index.html')
    const servedFallback = await serveStatic(res, filePath)
    if (servedFallback) return

    jsonResponse(res, { error: 'Not found' }, 404)
  } catch (err) {
    console.error('[server] Error:', err)
    jsonResponse(res, { error: err.message || 'Internal error' }, 500)
  }
})

server.listen(PORT, HOST, () => {
  console.log(`🎧 MusicWeb server listening on http://${HOST}:${PORT}`)
  if (HOST === '0.0.0.0') {
    console.log('   （對外監聽全部介面。有反向代理時建議設 HOST=127.0.0.1）')
  }
})

// ── 進程健壯性 ────────────────────────────────────────────────────
// 這是單一長駐程序，沒有 worker 池、崩了就整站掛掉等 systemd/OpenRC 重啟。
// 所以兩件事很重要：關閉時要排空、不要因為一個沒 catch 的錯就猝死。

/**
 * 優雅關閉：停止收新連線、給進行中的請求一點時間跑完，再退出。
 * 服務重啟／部署時，硬砍會把播到一半的串流連線直接斷掉；先 close 再退出，
 * 已建立的下載/串流能收尾。逾時仍未空就強制退出，不無限等。
 */
function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`\n[server] 收到 ${signal}，開始優雅關閉…`)
  const force = setTimeout(() => {
    console.error('[server] 排空逾時，強制退出')
    process.exit(1)
  }, 10000)
  force.unref()
  server.close((err) => {
    clearTimeout(force)
    if (err) {
      console.error('[server] 關閉時出錯:', err)
      process.exit(1)
    }
    console.log('[server] 已排空，退出')
    process.exit(0)
  })
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

// 沒被 catch 的錯記錄下來但不讓程序猝死。一個音源解析或某條 API 路徑的邊角
// 例外不該把整站拖垮 —— 個別請求已經有 try/catch 回 500，這裡是最後一道網，
// 接住漏掉的那些（例如非同步回呼裡拋的）。
process.on('unhandledRejection', (reason) => {
  console.error('[server] unhandledRejection:', reason)
})
process.on('uncaughtException', (err) => {
  console.error('[server] uncaughtException:', err)
  // 刻意不退出：這台機器所有使用者共用這一個程序，為了一個邊角例外整站重啟
  // 不划算。真正致命的錯（記憶體、埠佔用）Node 自己還是會退。
})