/**
 * Pages Advanced Mode worker 入口（會被打包成 dist/_worker.js）
 *
 * 為什麼需要這支：Cloudflare 儀表板的拖拉／zip 上傳**不會編譯 functions/ 目錄**
 * （官方文件明載，那條路必須用 wrangler）。但單一 _worker.js 兩種方式都支援，
 * 所以要做出「別人上載 zip 就能部署」的包，API 得先打包成一個檔。
 *
 * 路由邏輯與 functions/api/*.js 一致，並共用同一份 _lib/why.js —— 音源邏輯
 * 只有一份，不會兩邊走鐘。
 *
 * 有 _worker.js 時 Pages 會把**所有**請求交給它，靜態檔要自己經
 * env.ASSETS.fetch() 取回。
 */
import {
  searchWhyMusic,
  resolveWhyMusicUrl,
  getWhyMusicLyric,
  getWhyMusicPic,
  recommendWhyMusic,
  audiomackContainerToWhyItem,
  searchAudiomack,
  getAudiomackAlbumOrSheet,
  jsonResponse,
  GD_BITRATE,
} from './why.js'

/** 跨域代抓。音源 URL 與第三方插件都靠它，必須保留 Range 以便 seek */
async function handleProxy(request, url) {
  const targetUrl = url.searchParams.get('url')
  if (!targetUrl) return jsonResponse({ error: 'Missing url parameter' }, 400)

  const proxyHeaders = new Headers()
  for (const h of ['content-type', 'accept', 'authorization', 'range', 'referer']) {
    const val = request.headers.get(h)
    if (val) proxyHeaders.set(h, val)
  }
  proxyHeaders.set(
    'User-Agent',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  )

  const method = url.searchParams.get('method') || request.method
  const response = await fetch(decodeURIComponent(targetUrl), {
    method: method === 'GET' || method === 'HEAD' ? method : method,
    headers: proxyHeaders,
    body: method === 'GET' || method === 'HEAD' ? undefined : request.body,
  })

  const respHeaders = new Headers()
  respHeaders.set('Access-Control-Allow-Origin', '*')
  for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
    const val = response.headers.get(h)
    if (val) respHeaders.set(h, val)
  }
  // 上游沒宣告 Range 支援時也補上，否則瀏覽器不讓 seek
  if (!respHeaders.has('accept-ranges')) respHeaders.set('Accept-Ranges', 'bytes')

  return new Response(response.body, { status: response.status, headers: respHeaders })
}

async function handleApi(pathname, request, url) {
  switch (pathname) {
    case '/api/why-search': {
      const keyword = url.searchParams.get('q')
      const type = url.searchParams.get('type') || 'music'
      const page = parseInt(url.searchParams.get('page') || '1', 10)
      const count = parseInt(url.searchParams.get('count') || '20', 10)
      if (!keyword) return jsonResponse({ error: 'Missing q parameter' }, 400)
      const results = type === 'music'
        ? await searchWhyMusic(keyword, page, count)
        : (await searchAudiomack(keyword, type, page)).map(audiomackContainerToWhyItem)
      return jsonResponse({ data: results })
    }

    case '/api/why-url': {
      const songId = url.searchParams.get('id') || ''
      const title = url.searchParams.get('title') || ''
      if (!songId && !title) {
        return jsonResponse({ error: 'Missing id or title parameter' }, 400)
      }
      const resolved = await resolveWhyMusicUrl({
        id: songId,
        source: url.searchParams.get('source') || '',
        bitrate: parseInt(url.searchParams.get('br') || String(GD_BITRATE), 10),
        title,
        artist: url.searchParams.get('artist') || '',
      })
      if (!resolved) return jsonResponse({ error: 'No media URL returned' }, 404)
      return jsonResponse(resolved)
    }

    case '/api/why-lyric': {
      const id = url.searchParams.get('id')
      if (!id) return jsonResponse({ error: 'Missing id parameter' }, 400)
      return jsonResponse(await getWhyMusicLyric(id, url.searchParams.get('source') || ''))
    }

    case '/api/why-pic': {
      const id = url.searchParams.get('id')
      if (!id) return jsonResponse({ error: 'Missing id parameter' }, 400)
      const picUrl = await getWhyMusicPic(
        id,
        url.searchParams.get('source') || '',
        parseInt(url.searchParams.get('size') || '500', 10),
      )
      return jsonResponse({ url: picUrl })
    }

    case '/api/recommend': {
      const mode = url.searchParams.get('mode') || 'hot'
      const limit = parseInt(url.searchParams.get('limit') || '40', 10)
      return jsonResponse({ mode, data: await recommendWhyMusic(mode, limit) })
    }

    case '/api/album': {
      const id = url.searchParams.get('id')
      const slug = url.searchParams.get('slug')
      const artist = url.searchParams.get('artist')
      if (!id || !slug || !artist) {
        return jsonResponse({ error: 'Missing id, slug, or artist parameter' }, 400)
      }
      const tracks = await getAudiomackAlbumOrSheet(id, slug, artist)
      return jsonResponse(Array.isArray(tracks)
        ? tracks.map(t => ({ ...t, platform: 'WhyMusic', subSource: 'audiomack' }))
        : tracks)
    }

    case '/api/proxy':
      return await handleProxy(request, url)

    default:
      return jsonResponse({ error: `Unknown endpoint: ${pathname}` }, 404)
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const pathname = url.pathname

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': '*',
        },
      })
    }

    if (pathname.startsWith('/api/')) {
      try {
        return await handleApi(pathname, request, url)
      } catch (err) {
        console.error(`[${pathname}]`, err && err.message)
        return jsonResponse({ error: (err && err.message) || 'Internal error' }, 500)
      }
    }

    // 靜態檔（含 /plugins/*.js）。找不到且路徑看起來不是檔案時回 index.html，
    // 讓 SPA 的前端路由自己處理
    const assetResponse = await env.ASSETS.fetch(request)
    if (assetResponse.status === 404 && !pathname.split('/').pop().includes('.')) {
      return await env.ASSETS.fetch(new Request(new URL('/', url).toString(), request))
    }
    return assetResponse
  },
}
