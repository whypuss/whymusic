/**
 * MusicFree Web API Server
 * Cloudflare Worker - 服務端執行插件（無 CORS 限制）
 */

// CDN 插件源
const PLUGIN_CDN_MAP = {
  'audiomack': 'https://cdn.jsdelivr.net/gh/maotoumao/MusicFreePlugins@master/dist/audiomack/index.js',
}

// packages polyfill
const packages = {
  axios: {
    get: async (url, config) => {
      const r = await fetch(url, { headers: { ...(config?.headers || {}) } })
      return { data: await r.json(), headers: r.headers, status: r.status }
    },
    post: async (url, data, config) => {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(config?.headers || {}) }, body: JSON.stringify(data) })
      return { data: await r.json(), headers: r.headers, status: r.status }
    },
    create: () => ({ get: packages.axios.get, post: packages.axios.post }),
    defaults: { timeout: 2000 },
    interceptors: { response: { use: () => {} } },
  },
  cheerio: {
    load: (html) => ({
      text: (sel) => html.match(new RegExp(`(${sel})\\s*</.*?>`, 'i'))?.[0].replace(/<.*?>/g, '') || '',
      html: (sel) => sel ? html : html,
      attr: (sel, attr) => html.match(new RegExp(`${sel}[^>]*${attr}="([^"]+)"`, 'i'))?.[1] || '',
      find: () => ({ load: () => ({ text: () => '', html: () => '' }) }),
      each: () => {},
      map: () => [],
    }),
  },
  'crypto-js': { AES: { encrypt: () => ({ toString: () => '' }), decrypt: () => ({ toString: () => '' }) }, SHA1: () => ({ toString: () => '' }), HmacSHA1: () => ({ toString: () => '' }) },
  dayjs: (d) => ({ format: () => new Date(d).toISOString() }),
  he: { decode: (s) => s, encode: (s) => s },
  'big-integer': (n) => ({ toString: () => String(n) }),
  qs: { parse: (s) => { const p = {}; s.split('&').forEach(kvp => { const [k, v] = kvp.split('='); p[k] = decodeURIComponent(v || ''); }); return p; }, stringify: (o) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&') },
  webdav: {},
}

const _require = (packageName) => {
  const pkg = packages[packageName]
  if (pkg) { pkg.default = pkg; return pkg }
  return {}
}

const _env = { getUserVariables: () => ({}), appVersion: '1.0.0', os: 'server', lang: 'zh-CN' }
const _process = { platform: 'server', version: '1.0.0', env: _env }

// 插件緩存（Worker 實例級別）
const plugins = new Map()

// 執行插件代碼（使用 dynamic import）
async function loadPluginCode(platform) {
  if (plugins.has(platform)) return plugins.get(platform)

  const cdnUrl = PLUGIN_CDN_MAP[platform]
  if (!cdnUrl) throw new Error(`Unknown plugin: ${platform}`)

  const response = await fetch(cdnUrl)
  if (!response.ok) throw new Error(`Failed to fetch plugin: ${response.status}`)
  const code = await response.text()

  // 轉換 CommonJS 為 ES module 格式
  const esCode = `
    const module = { exports: {} };
    const exports = module.exports;
    const require = _require;
    const console = globalThis.console;
    const env = _env;
    const URL = globalThis.URL;
    const process = _process;
    ${code}
    export default module.exports.default || module.exports;
  `

  // 使用 data URL + dynamic import 執行
  const dataUrl = `data:text/javascript,${encodeURIComponent(esCode)}`
  const mod = await import(dataUrl)
  const plugin = mod.default

  // 標準化插件接口
  const normalized = {
    name: plugin.name || platform,
    platform: plugin.platform || platform,
    version: plugin.version || '1.0.0',
    description: plugin.description || '',
    instance: plugin,
    async search(keyword, page, type) {
      const result = await plugin.search?.(keyword, page || 1, type || 'music')
      if (!result) return { data: [], isEnd: true }
      const items = result.data || result.musicList || result.albumList || result.sheetList || result.artistList || []
      return {
        data: Array.isArray(items) ? items.map(item => ({
          ...item,
          platform: plugin.platform || platform,
          id: item.id || item.songmid || '',
          artist: item.artist || item.artistName || '',
          artwork: item.artwork || item.cover || '',
        })) : [],
        isEnd: result.isEnd ?? true,
      }
    },
    async getMediaSource(item, quality) {
      const result = await plugin.getMediaSource?.(item, quality || 'standard')
      return { url: result?.url || '', headers: result?.headers, userAgent: result?.userAgent }
    },
  }

  plugins.set(platform, normalized)
  return normalized
}

async function autoInit() {
  await loadPluginCode('audiomack')
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const path = url.pathname

    if (path === '/api/search') {
      return handleSearch(url)
    } else if (path === '/api/media') {
      return handleMedia(url)
    }

    // 其他路由轉發到 Pages
    return env.ASSETS.fetch(request)
  },
}

async function handleSearch(url) {
  const keyword = url.searchParams.get('q')
  const type = url.searchParams.get('type') || 'music'

  try {
    await autoInit()

    const allResults = []
    for (const plugin of plugins.values()) {
      try {
        const result = await plugin.search(keyword || '', undefined, type)
        if (result && Array.isArray(result.data)) {
          allResults.push(...result.data)
        }
      } catch (e) {
        console.error(`Plugin ${plugin.platform} search failed:`, e)
      }
    }

    return new Response(JSON.stringify(allResults), {
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

async function handleMedia(url) {
  const itemId = url.searchParams.get('id')
  const platform = url.searchParams.get('platform') || 'Audiomack'
  const title = url.searchParams.get('title') || ''
  const artist = url.searchParams.get('artist') || ''
  const quality = url.searchParams.get('quality') || 'standard'

  try {
    await autoInit()

    const plugin = plugins.get(platform)
    if (!plugin) throw new Error(`Plugin not found: ${platform}`)

    const item = { id: itemId || '', platform: platform, title, artist }
    const result = await plugin.getMediaSource(item, quality)

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