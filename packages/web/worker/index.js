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
  RECOMMEND_CATEGORIES,
  DEFAULT_CATEGORY,
  jsonResponse,
  GD_BITRATE,
  searchWhyMusicAlbums,
  getWhyMusicAlbum,
} from './why.js'
import {
  SYNC_CODE_LEN,
  SYNC_MAX_BYTES,
  SYNC_TTL,
  newSyncCode,
  normalizeSyncCode,
  validateSyncPayload,
} from '../shared/sync.js'
import { checkProxyTarget } from '../shared/proxy-guard.js'

// /api/proxy 網域白名單。Workers 沒有 process.env，設定寫成模組常數（與 why.js
// 那些設定同一種做法）。空＝不限制。要鎖死就在這裡列出允許的網域。
const PROXY_ALLOWED_HOSTS = []

/** 跨域代抓。音源 URL 與第三方插件都靠它，必須保留 Range 以便 seek */
async function handleProxy(request, url) {
  const targetUrl = url.searchParams.get('url')
  if (!targetUrl) return jsonResponse({ error: 'Missing url parameter' }, 400)

  // SSRF 防護：擋非 http(s) 協定與字面私有 IP。Workers 沒有 dns 模組做解析後複查，
  // 但 CF 邊緣本來就到不了私有網段（沒有內網可打），字面檢查對它已足夠。
  // 白名單預設空＝不限制；要鎖死可設 PROXY_ALLOWED_HOSTS。
  const safe = checkProxyTarget(decodeURIComponent(targetUrl), PROXY_ALLOWED_HOSTS)
  if (!safe.ok) return jsonResponse({ error: `拒絕代抓：${safe.reason}` }, 403)

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
  const response = await fetch(safe.url, {
    method,
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

// ── 裝置配對碼 ──────────────────────────────────────────────────────
// 存的是「你選了哪些音源」，不是音源本身 —— 音源檔一直都在站上（/plugins/*.js），
// 每台裝置各自缺的只有「你做過的那個選擇」。
//
// 刻意不做帳號：這個站沒有登入、沒有 cookie、不持有任何個人資料，加一套帳號系統
// 就得處理憑證、session、密碼重設、資料刪除，成本遠大於它要解決的問題。配對碼
// 只是一份 24 小時後自動消失的暫存，沒有任何東西能連回「人」。
//
// 碼的格式與驗證規則放在 ../shared/sync.js，與自架版的 server.mjs 共用 ——
// 兩邊各寫一份的話，只要有一邊改了規則，就會出現「A 裝置產生的碼 B 裝置說格式
// 不正確」這種極難查的問題。這裡只實作 KV 這一種儲存。
async function handleSync(request, url, env) {
  if (!env?.SYNC) {
    // 拿 zip 自行部署的人不會有這個綁定。講清楚原因，不要假裝成伺服器錯誤
    return jsonResponse({ error: '此部署未啟用同步功能（缺少 SYNC KV 綁定）' }, 501)
  }

  if (request.method === 'POST') {
    const body = await request.text()
    if (body.length > SYNC_MAX_BYTES) {
      return jsonResponse({ error: '資料過大，無法同步' }, 413)
    }
    let parsed
    try {
      parsed = JSON.parse(body)
    } catch {
      return jsonResponse({ error: '請求格式錯誤' }, 400)
    }
    const { error, clean } = validateSyncPayload(parsed)
    if (error) return jsonResponse({ error }, 400)

    const code = newSyncCode()
    await env.SYNC.put(`sync:${code}`, JSON.stringify({ plugins: clean }), {
      expirationTtl: SYNC_TTL,
    })
    return jsonResponse({ code, expiresIn: SYNC_TTL })
  }

  if (request.method === 'GET') {
    const code = normalizeSyncCode(url.searchParams.get('code'))
    if (code.length !== SYNC_CODE_LEN) {
      return jsonResponse({ error: '同步碼格式不正確' }, 400)
    }
    const raw = await env.SYNC.get(`sync:${code}`)
    if (!raw) {
      return jsonResponse({ error: '找不到這組同步碼，可能已過期（有效 24 小時）' }, 404)
    }
    return jsonResponse(JSON.parse(raw))
  }

  return jsonResponse({ error: '不支援的方法' }, 405)
}

async function handleApi(pathname, request, url, env) {
  switch (pathname) {
    case '/api/sync':
      return await handleSync(request, url, env)

    case '/api/why-search': {
      const keyword = url.searchParams.get('q')
      const type = url.searchParams.get('type') || 'music'
      const page = parseInt(url.searchParams.get('page') || '1', 10)
      const count = parseInt(url.searchParams.get('count') || '20', 10)
      if (!keyword) return jsonResponse({ error: 'Missing q parameter' }, 400)
      // 只支援歌曲。專輯／歌單／歌手原本只有 audiomack 提供，該子源已移除，
      // 留著這條路只會回播不出來的內容。
      if (type !== 'music') {
        return jsonResponse({ error: `不支援的搜尋類型：${type}`, data: [] }, 400)
      }
      return jsonResponse({ data: await searchWhyMusic(keyword, page, count) })
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
        // 前端已知播不出來的子源（客戶端才知道的失敗，見 resolveWhyMusicUrl 註解）
        exclude: (url.searchParams.get('exclude') || '')
          .split(',').map(s => s.trim()).filter(Boolean),
      })
      if (!resolved) return jsonResponse({ error: 'No media URL returned' }, 404)
      return jsonResponse(resolved)
    }

    case '/api/why-lyric': {
      const id = url.searchParams.get('id')
      if (!id) return jsonResponse({ error: 'Missing id parameter' }, 400)
      return jsonResponse(await getWhyMusicLyric(id, url.searchParams.get('source') || ''))
    }

    // 專輯：搜尋與曲目。走網易雲（GD 沒有專輯類型），後端負責重試與快取 ——
    // 那個上游會隨機拒絕本服務的出口 IP，見 why.js 的 neteaseFetch。
    case '/api/why-album-search': {
      const kw = url.searchParams.get('kw')
      if (!kw) return jsonResponse({ error: 'Missing kw parameter' }, 400)
      const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1)
      const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') || '20', 10) || 20))
      return jsonResponse({ data: await searchWhyMusicAlbums(kw, page, limit) })
    }

    case '/api/why-album': {
      const id = url.searchParams.get('id')
      if (!id) return jsonResponse({ error: 'Missing id parameter' }, 400)
      return jsonResponse({ data: await getWhyMusicAlbum(id) })
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
      // cat = 分類（hot / cantonese / cpop / kpop / western），各對一份網易雲榜單。
      // 插件先打這裡拿裁切過的結果，打不通才自己直連 GD。認不出的 cat 退回預設
      // 而不是回 400 —— 舊版插件不帶它。
      const requested = url.searchParams.get('cat') || ''
      const category = RECOMMEND_CATEGORIES.includes(requested) ? requested : DEFAULT_CATEGORY
      const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '40', 10) || 40))
      // seed：使用者按「刷新」時前端會遞增它，用來換一批歌而不必等隔天。
      // 不帶就是 0（舊版插件），那就只有「一天一換」那條。
      const seed = url.searchParams.get('seed') || '0'
      return jsonResponse({
        category, data: await recommendWhyMusic(category, limit, seed),
      })
    }


    case '/api/version':
      // 建置時由 esbuild 注入。前端顯示這個值與它自己的戳記做比對，
      // 不一致就代表只部署了一半（例如前端更新了但 worker 沒有）
      return jsonResponse({
        worker: typeof __WORKER_VERSION__ !== 'undefined' ? __WORKER_VERSION__ : 'unknown',
        // 這份部署有沒有綁 SYNC KV。前端據此決定要不要顯示同步區塊 ——
        // 拿 zip 自行部署的人沒綁，就不該看到一個按了必定失敗的按鈕
        sync: !!env?.SYNC,
      })

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
        return await handleApi(pathname, request, url, env)
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
