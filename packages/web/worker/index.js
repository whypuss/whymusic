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

// ── 裝置配對碼 ──────────────────────────────────────────────────────
// 存的是「你選了哪些音源」，不是音源本身 —— 音源檔一直都在站上（/plugins/*.js），
// 每台裝置各自缺的只有「你做過的那個選擇」。
//
// 刻意不做帳號：這個站沒有登入、沒有 cookie、不持有任何個人資料，加一套帳號系統
// 就得處理憑證、session、密碼重設、資料刪除，成本遠大於它要解決的問題。配對碼
// 只是一份 24 小時後自動消失的暫存，沒有任何東西能連回「人」。
//
// 去掉 0/O/1/I 這些看起來像的字元，使用者要用手打。8 碼 × 32 種 = 40 bits。
const SYNC_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
const SYNC_CODE_LEN = 8
const SYNC_TTL = 86400            // 24 小時
const SYNC_MAX_BYTES = 256 * 1024 // 一份音源約 15 KB，這個上限很寬鬆
const SYNC_MAX_PLUGINS = 12

function newSyncCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(SYNC_CODE_LEN))
  let out = ''
  // 32 是 2 的冪，取模不會有偏差
  for (const b of bytes) out += SYNC_ALPHABET[b % SYNC_ALPHABET.length]
  return out
}

/** 使用者可能連著連字號或小寫一起貼進來 */
function normalizeSyncCode(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

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
    const plugins = Array.isArray(parsed?.plugins) ? parsed.plugins : null
    if (!plugins || plugins.length === 0) {
      return jsonResponse({ error: '沒有可同步的音源' }, 400)
    }
    if (plugins.length > SYNC_MAX_PLUGINS) {
      return jsonResponse({ error: `音源數量超過上限（${SYNC_MAX_PLUGINS}）` }, 400)
    }
    // 只留我們認得的欄位，別把使用者端塞進來的任何東西原樣存下
    const clean = plugins.map(p => ({
      name: String(p?.name || ''),
      code: String(p?.code || ''),
      enabled: p?.enabled !== false,
    }))
    if (clean.some(p => !p.name || !p.code)) {
      return jsonResponse({ error: '音源資料不完整' }, 400)
    }

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
