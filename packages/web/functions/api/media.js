/**
 * API Endpoint: /api/media
 * Cloudflare Pages Function - server-side music media URL
 * Uses Audiomack /music/play/{id} endpoint with OAuth 1.0
 * encodeSignature: false — signature is NOT double-encoded in final URL
 */

const API_BASE = 'https://api.audiomack.com/v1'
const OAUTH_CONSUMER_KEY = 'audiomack-web'
const OAUTH_SECRET = 'bd8a07e9f23fbe9d808646b730f89b8e'
const OAUTH_VERSION = '1.0'
const OAUTH_METHOD = 'HMAC-SHA1'

function oauthEncode(str) {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A')
}

async function hmacSha1(key, data) {
  const encoder = new TextEncoder()
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data))
  return btoa(String.fromCharCode(...new Uint8Array(signature)))
}

async function getSignature(method, urlPath, params) {
  urlPath = urlPath.split('?')[0]
  const sortedKeys = Object.keys(params).sort()
  const paramPairs = sortedKeys
    .map(k => `${oauthEncode(k)}=${oauthEncode(String(params[k]))}`)
    .join('&')
  const baseString = `${method.toUpperCase()}&${oauthEncode(urlPath)}&${oauthEncode(paramPairs)}`
  const signingKey = `${oauthEncode(OAUTH_SECRET)}&`
  return hmacSha1(signingKey, baseString)
}

async function getAudiomackMedia(songId) {
  const timestamp = String(Math.floor(Date.now() / 1000))
  const nonce = Math.random().toString(36).substring(2, 22)

  const params = {
    environment: 'desktop-web',
    hq: 'true',
    oauth_consumer_key: OAUTH_CONSUMER_KEY,
    oauth_nonce: nonce,
    oauth_signature_method: OAUTH_METHOD,
    oauth_timestamp: timestamp,
    oauth_version: OAUTH_VERSION,
    section: '/search',
  }

  // Website uses full URL in base string: https://api.audiomack.com/v1/music/play/{id}
  const signature = await getSignature('GET', `https://api.audiomack.com/v1/music/play/${songId}`, params)
  params.oauth_signature = signature

  // encodeSignature: false — signature is NOT double-encoded in final URL
  const paramString = Object.entries(params)
    .map(([k, v]) => `${k}=${k === 'oauth_signature' ? v : oauthEncode(v)}`)
    .join('&')
  const url = `${API_BASE}/music/play/${songId}?${paramString}`

  // Debug: log the actual request
  console.error('[media] URL:', url)
  console.error('[media] signature:', signature)

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
  return {
    url: data.signedUrl || '',
    headers: {},
    userAgent: '',
  }
}

export async function onRequest({ request }) {
  const url = new URL(request.url)
  const songId = url.searchParams.get('id')
  const platform = url.searchParams.get('platform') || 'Audiomack'

  try {
    if (!songId) {
      return new Response(JSON.stringify({ error: 'Missing id parameter' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }

    if (platform !== 'Audiomack') {
      return new Response(JSON.stringify({ error: `Platform not supported: ${platform}` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }

    const result = await getAudiomackMedia(songId)
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  } catch (err) {
    console.error('[API media] Error:', err)
    return new Response(JSON.stringify({ error: err.message || 'Failed to get media source' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }
}