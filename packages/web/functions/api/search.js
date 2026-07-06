/**
 * API Endpoint: /api/search
 * Cloudflare Pages Function - server-side music search
 * OAuth 1.0 HMAC-SHA1 signature
 */

const API_BASE = 'https://api.audiomack.com/v1'
const OAUTH_CONSUMER_KEY = 'audiomack-js'
const OAUTH_SECRET = 'f3ac5b086f3eab260520d8e3049561e6'
const OAUTH_VERSION = '1.0'
const OAUTH_METHOD = 'HMAC-SHA1'

// OAuth 1.0 RFC 5849 compliant encoding
function oauthEncode(str) {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A')
    .replace(/%20/g, '+')
}

// HMAC-SHA1 using Web Crypto API (debug version)
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
  const bytes = new Uint8Array(signature)
  // Debug: log hex representation
  console.log('[hmacSha1] data:', data.substring(0, 80))
  console.log('[hmacSha1] bytes hex:', Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(''))
  return btoa(String.fromCharCode(...bytes))
}

// Generate OAuth 1.0 signature (debug)
async function generateSignature(method, baseUrl, params) {
  const sortedKeys = Object.keys(params).sort()
  const paramPairs = sortedKeys
    .filter(k => k !== 'oauth_signature')
    .map(k => `${oauthEncode(k)}=${oauthEncode(String(params[k]))}`)
    .join('&')

  const baseString = `${method.toUpperCase()}&${oauthEncode(baseUrl)}&${oauthEncode(paramPairs)}`
  const signingKey = `${oauthEncode(OAUTH_SECRET)}&`

  console.log('[signature] baseString:', baseString)
  console.log('[signature] signingKey:', signingKey)
  
  const signature = await hmacSha1(signingKey, baseString)
  console.log('[signature] raw base64:', signature)
  return oauthEncode(signature)
}

// Search Audiomack API
async function searchAudiomack(keyword, page, type) {
  const timestamp = Math.floor(Date.now() / 1000)
  const nonce = Math.random().toString(36).substring(2, 15)

  const params = {
    oauth_consumer_key: OAUTH_CONSUMER_KEY,
    oauth_nonce: nonce,
    oauth_signature_method: OAUTH_METHOD,
    oauth_timestamp: String(timestamp),
    oauth_version: OAUTH_VERSION,
    q: keyword,
    page: String(page),
    limit: '20',
    show: type === 'music' ? 'songs' : (type === 'album' ? 'albums' : (type === 'artist' ? 'artists' : 'playlists')),
    sort: 'popular',
  }

  const signature = await generateSignature('GET', `${API_BASE}/search`, params)
  params.oauth_signature = signature

  // OAuth 1.0: query string must use oauthEncode (not encodeURIComponent),
  // because signature is already oauth-encoded and encodeURIComponent would double-encode it
  const paramString = Object.entries(params)
    .map(([k, v]) => `${k}=${k === 'oauth_signature' ? v : oauthEncode(v)}`)
    .join('&')
  const url = `${API_BASE}/search?${paramString}`

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    },
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`Audiomack API error: ${errText}`)
  }

  const data = await response.json()
  return (data.results || []).map(item => ({
    id: item.id || '',
    title: item.title || '',
    artist: item.artist || '',
    artwork: item.artwork_url || item.cover_url || '',
    platform: 'Audiomack',
    duration: item.duration || 0,
  }))
}

export async function onRequest({ request }) {
  const url = new URL(request.url)
  const keyword = url.searchParams.get('q')
  const type = url.searchParams.get('type') || 'music'

  try {
    const results = await searchAudiomack(keyword || '', 1, type)
    return new Response(JSON.stringify(results), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  } catch (err) {
    console.error('[API search] Error:', err)
    return new Response(JSON.stringify({ error: err.message || 'Search failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }
}