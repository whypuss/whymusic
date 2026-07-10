/**
 * API Endpoint: /api/proxy
 * Cloudflare Pages Function - proxies external API requests
 * Used for YouTube search (POST) and other CORS-blocked requests
 * Supports Range requests for audio/video streaming
 */
export async function onRequest({ request }) {
  const url = new URL(request.url)
  const targetUrl = url.searchParams.get('url')
  const method = url.searchParams.get('method') || request.method

  if (!targetUrl) {
    return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }

  try {
    // Build proxy request
    const proxyHeaders = new Headers()
    // Copy relevant headers
    const forwardHeaders = ['content-type', 'user-agent', 'accept', 'authorization', 'cookie', 'range', 'referer']
    for (const h of forwardHeaders) {
      const val = request.headers.get(h)
      if (val) proxyHeaders.set(h, val)
    }
    proxyHeaders.set('User-Agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')

    const proxyRequest = new Request(decodeURIComponent(targetUrl), {
      method: method,
      headers: proxyHeaders,
      body: ['GET', 'HEAD'].includes(method) ? null : request.body,
    })

    const response = await fetch(proxyRequest)

    // Forward important response headers for streaming
    const respHeaders = new Headers({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Content-Type': response.headers.get('content-type') || 'application/octet-stream',
    })
    if (response.status === 206) {
      const contentRange = response.headers.get('content-range')
      const contentLength = response.headers.get('content-length')
      if (contentRange) respHeaders.set('Content-Range', contentRange)
      if (contentLength) respHeaders.set('Content-Length', contentLength)
      respHeaders.set('Accept-Ranges', 'bytes')
    }
    const targetAcceptRanges = response.headers.get('accept-ranges')
    if (targetAcceptRanges) respHeaders.set('Accept-Ranges', targetAcceptRanges)

    // Stream response in chunks
    const reader = response.body?.getReader()
    if (reader) {
      return new Response(new ReadableStream({
        async start(controller) {
          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) { controller.close(); return }
              controller.enqueue(value)
            }
          } catch {
            controller.close()
          }
        },
      }), { status: response.status, statusText: response.statusText, headers: respHeaders })
    }

    const responseBody = await response.arrayBuffer()
    return new Response(responseBody, {
      status: response.status,
      statusText: response.statusText,
      headers: respHeaders,
    })
  } catch (err) {
    console.error('[API proxy] Error:', err)
    return new Response(JSON.stringify({ error: err.message || 'Proxy failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }
}