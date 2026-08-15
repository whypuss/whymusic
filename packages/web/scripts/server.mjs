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

const PORT = 8788
const STATIC_DIR = path.resolve(import.meta.dirname, '../dist')

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

async function serveStatic(res, filePath) {
  const ext = path.extname(filePath)
  const contentType = MIME_TYPES[ext] || 'application/octet-stream'

  try {
    const content = await fs.promises.readFile(filePath)
    res.writeHead(200, { 'Content-Type': contentType, ...corsHeaders() })
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

    // ── API: /api/recommend ───────────────────────────────
    // 推薦香港流行曲：hot=熱門、new=最新
    if (pathname === '/api/recommend') {
      const mode = url.searchParams.get('mode') || 'hot'
      const limit = parseInt(url.searchParams.get('limit') || '40', 10)
      try {
        const results = await recommendAudiomack(mode, limit)
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
      if (!songId) {
        jsonResponse(res, { error: 'Missing id parameter' }, 400)
        return
      }
      if (platform !== 'Audiomack') {
        jsonResponse(res, { error: `Platform not supported: ${platform}` }, 400)
        return
      }
      let mediaUrl
      try {
        mediaUrl = await getAudiomackMedia(songId)
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
      jsonResponse(res, tracks)
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
            video_id: playId,
          })
          const ytResp = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
          })
          if (ytResp.ok) {
            const ytData = await ytResp.json()
            const formats = ytData.streamingData?.formats || []
            const adaptiveFormats = ytData.streamingData?.adaptiveFormats || []
            // 找音頻格式
            const allFormats = [...adaptiveFormats, ...formats].filter(f => f.url)
            // 優先選音頻格式
            const audioFormats = allFormats.filter(f => (f.mimeType || '').includes('audio'))
            const candidates = audioFormats.length > 0 ? audioFormats : allFormats
            mediaUrl = candidates[0]?.url || null
          }
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