/**
 * MusicWeb production server for 192.168.31.55
 * Handles static files + all API endpoints (search/media/proxy)
 * Usage: node scripts/server.mjs
 */

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { createHmac } from 'node:crypto'

const PORT = Number(process.env.PORT) || 8788
const STATIC_DIR = path.resolve(import.meta.dirname, '../dist')
// 音源插件目錄（repo 根層 plugins/）。由本服務直接供應，執行時不碰 GitHub。
const PLUGINS_DIR = process.env.PLUGINS_DIR
  || path.resolve(import.meta.dirname, '../../../plugins')

// ── OAuth 1.0 Configuration ────────────────────────────────────────
// Load from environment variables. Defaults are Audiomack's public
// example credentials — replace in production via .env or env vars.
// 使用 Audiomack 官方公開的 consumer key/secret（MusicFree 原版插件同款）。
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

const WHY_SOURCES = (process.env.WHY_MUSIC_SOURCES || 'netease,joox,audiomack')
  .split(',').map(s => s.trim()).filter(Boolean)
/** 由上游 GD API 代理的子源 */
const GD_SOURCES = WHY_SOURCES.filter(s => s !== AUDIOMACK_SOURCE)
const GD_BITRATE = parseInt(process.env.WHY_MUSIC_BITRATE || '320', 10)

// 推薦頁資料來源：網易雲榜單。playlist 回應自帶封面與時長，
// 不必逐首打 types=pic，省上游請求。前者不足 limit 時用後者補齊。
const GD_TOPLISTS = {
  new: ['10169002', '3779629'],  // 香港電台中文歌曲龍虎榜 → 雲音樂新歌榜
  hot: ['3778678', '19723756'],  // 雲音樂熱歌榜 → 雲音樂飆升榜
}

// 上游按 IP 限流，而本服務所有使用者共用同一出口 IP，故一律走 TTL 快取。
const GD_TTL = { search: 600e3, url: 1200e3, pic: 864e5, lyric: 864e5, playlist: 1800e3 }
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
async function resolveWhyMusicUrl({ id, source, bitrate, title, artist }) {
  const primary = source || WHY_SOURCES[0]
  if (id) {
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

/** 推薦頁：網易雲榜單（回應自帶封面，無需逐首取圖） */
async function recommendWhyMusic(mode = 'hot', limit = 40) {
  const listIds = GD_TOPLISTS[mode] || GD_TOPLISTS.hot
  const seen = new Set()
  const out = []
  for (const listId of listIds) {
    if (out.length >= limit) break
    let tracks = []
    try {
      const data = await gdRequest('playlist', { source: 'netease', id: listId })
      tracks = data?.playlist?.tracks || []
    } catch (err) {
      console.error(`[gd] playlist ${listId} failed: ${err.message}`)
      continue
    }
    for (const track of tracks) {
      if (out.length >= limit) break
      const title = String(track.name || '')
      if (!track.id || !title) continue
      const album = track.al || track.album || {}
      const artist = (track.ar || track.artists || [])
        .map(a => a.name).filter(Boolean).join(' / ')
      const key = `${gdNormalizeName(title)}::${gdNormalizeName(artist)}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        id: String(track.id),
        title,
        artist,
        album: String(album.name || ''),
        artwork: album.picUrl || '',
        platform: 'WhyMusic',
        subSource: 'netease',
        picId: album.pic_str || (album.pic != null ? String(album.pic) : ''),
        lyricId: String(track.id),
        duration: track.dt ? Math.round(track.dt / 1000) : 0,
        type: 'music',
      })
    }
  }
  return out
}

// ── HTTP Server ──────────────────────────────────────────────────

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
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': '*',
  }
}

function jsonResponse(res, data, status = 200) {
  res.writeHead(status, { ...corsHeaders(), 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

async function serveStatic(res, filePath, extraHeaders) {
  const ext = path.extname(filePath)
  const contentType = MIME_TYPES[ext] || 'application/octet-stream'

  try {
    const content = await fs.promises.readFile(filePath)
    res.writeHead(200, {
      'Content-Type': contentType,
      ...corsHeaders(),
      ...extraHeaders,
    })
    res.end(content)
  } catch {
    return false
  }
  return true
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const pathname = url.pathname

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders())
    res.end()
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
        const results = type === 'music'
          ? await searchWhyMusic(keyword, page, count)
          : (await searchAudiomack(keyword, type, page)).map(audiomackContainerToWhyItem)
        jsonResponse(res, { data: results })
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
      if (!songId && !title) {
        jsonResponse(res, { error: 'Missing id or title parameter' }, 400)
        return
      }
      try {
        const resolved = await resolveWhyMusicUrl({ id: songId, source, bitrate, title, artist })
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
    // 推薦：new=香港電台中文歌曲龍虎榜、hot=雲音樂熱歌榜（皆為 GD Music，可播放）
    // 帶 source=audiomack 則回舊的 Audiomack 推薦（多數曲目無播放權限）
    if (pathname === '/api/recommend') {
      const mode = url.searchParams.get('mode') || 'hot'
      const limit = parseInt(url.searchParams.get('limit') || '40', 10)
      const source = url.searchParams.get('source') || 'gd'
      try {
        const results = source === 'audiomack'
          ? await recommendAudiomack(mode, limit)
          : await recommendWhyMusic(mode, limit)
        jsonResponse(res, { mode, data: results })
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
    // 參數：id, platform, quality (可選)
    if (pathname === '/api/play') {
      const playId = url.searchParams.get('id')
      const playPlatform = url.searchParams.get('platform') || ''
      const quality = url.searchParams.get('quality') || ''
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
        } else if (playPlatform === '猫耳FM') {
          // 猫耳FM: 後端調用 getsound API 拿音源 URL
          const mRes = await fetch(`https://www.missevan.com/sound/getsound?soundid=${playId}`, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Accept': 'application/json',
              'Referer': `https://www.missevan.com/sound/player?id=${playId}`,
            },
          })
          if (mRes.ok) {
            const mData = await mRes.json()
            const sound = mData.info?.sound || {}
            mediaUrl = quality === 'low' ? sound.soundurl_128 : sound.soundurl
          }
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
      // 貓耳FM 需要 Referer
      if (playPlatform === '猫耳FM') {
        playHeaders['Referer'] = `https://www.missevan.com/sound/player?id=${playId}`
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
    if (pathname === '/api/proxy') {
      const targetUrl = url.searchParams.get('url')
      const method = url.searchParams.get('method') || req.method
      if (!targetUrl) {
        jsonResponse(res, { error: 'Missing url parameter' }, 400)
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

      const proxyReq = await fetch(decodeURIComponent(targetUrl), {
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

    // ── 插件檔 ───────────────────────────────────────────
    // 音源插件由本服務直接供應，執行時不依賴 GitHub。插件原始碼放在 repo
    // 的 plugins/，隨部署一起上機；GitHub 只是它在版控裡的位置。
    // 檔名白名單化，避免 ../ 之類的路徑穿越。
    if (pathname.startsWith('/plugins/')) {
      const name = pathname.slice('/plugins/'.length)
      if (!/^[a-zA-Z0-9_-]+\.js$/.test(name)) {
        jsonResponse(res, { error: 'Invalid plugin name' }, 400)
        return
      }
      const pluginPath = path.join(PLUGINS_DIR, name)
      // 插件會被使用者手動「重新載入」，不讓瀏覽器長期快取
      const servedPlugin = await serveStatic(res, pluginPath, {
        'Cache-Control': 'no-cache',
        'Content-Type': 'application/javascript; charset=utf-8',
      })
      if (servedPlugin) return
      jsonResponse(res, { error: `Plugin not found: ${name}` }, 404)
      return
    }

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

server.listen(PORT, () => {
  console.log(`🎧 MusicWeb server listening on http://0.0.0.0:${PORT}`)
})