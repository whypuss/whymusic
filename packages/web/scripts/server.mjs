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
const AUDIOMACK_SEARCH_CONSUMER_KEY =
  process.env.AUDIOMACK_SEARCH_CONSUMER_KEY || 'audiomack-js'
const AUDIOMACK_SEARCH_SECRET =
  process.env.AUDIOMACK_SEARCH_SECRET || 'REPLACE_WITH_YOUR_SECRET'
const AUDIOMACK_MEDIA_CONSUMER_KEY =
  process.env.AUDIOMACK_MEDIA_CONSUMER_KEY || 'audiomack-web'
const AUDIOMACK_MEDIA_SECRET =
  process.env.AUDIOMACK_MEDIA_SECRET || 'REPLACE_WITH_YOUR_SECRET'

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

async function searchAudiomack(keyword, type, page) {
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
    sort: 'popular',
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
    // 專輯/歌單結果：Audiomack search API 直接返回 tracks（數字索引 object）
    let musicList = []
    if ((type === 'album' || type === 'sheet') && item.tracks && typeof item.tracks === 'object') {
      const trackArray = Object.values(item.tracks)
      musicList = trackArray.map((t, i) => ({
        id: t.song_id || t.id || `${item.id}-track-${i}`,
        title: t.title || '',
        artist: t.artist || item.artistName || item.uploader || '',
        artwork: t.cover_url || t.artwork_url || item.image_base || item.image || '',
        duration: parseInt(t.duration, 10) || 0,
        platform: 'Audiomack',
        type: 'music',
      }))
    }
    return {
      id: item.id || '',
      title: item.title || '',
      artist: typeof artistObj === 'string' ? artistObj : (artistObj.name || ''),
      artwork: item.image || item.image_base || item.artwork_url || item.cover_url || '',
      platform: 'Audiomack',
      duration: item.duration || 0,
      url_slug: item.url_slug || '',
      type: type === 'album' ? 'album' : type === 'sheet' ? 'sheet' : 'music',
      musicList,
    }
  })
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