/**
 * Test worker: compute and return OAuth signature directly
 * Compare CF Workers btoa with Node.js crypto
 */

function oauthEncode(str) {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A')
    .replace(/%20/g, '+')
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
  const bytes = new Uint8Array(signature)
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
  return { base64: btoa(String.fromCharCode(...bytes)), hex }
}

export async function onRequest({ request }) {
  const OAUTH_SECRET = 'f3ac5b086f3eab260520d8e3049561e6'
  const baseString = 'GET&https%3A%2F%2Fapi.audiomack.com%2Fv1%2Fsearch&limit%3D20%26oauth_consumer_key%3Daudiomack-js%26oauth_nonce%3Dtest123%26oauth_signature_method%3DHMAC-SHA1%26oauth_timestamp%3D1783220286%26oauth_version%3D1.0%26page%3D1%26q%3Ddrake%26show%3Dsongs%26sort%3Dpopular'
  const signingKey = oauthEncode(OAUTH_SECRET) + '&'

  const result = await hmacSha1(signingKey, baseString)

  return new Response(JSON.stringify({
    baseString,
    signingKey,
    base64: result.base64,
    hex: result.hex,
    nodeExpectedBase64: 'c/BBOHs2MZrZj5hP5lqmgw6qQws=',
    nodeExpectedHex: '73f041387b36319ad98f984fe65aa6830eaa430b',
    match: result.hex === '73f041387b36319ad98f984fe65aa6830eaa430b',
  }, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  })
}