import { Plugin, MusicItem, SearchType } from '../types'

// ====== MusicFree 原生沙箱（搬移自 musicfree/src/core/pluginManager/plugin.ts）======
// 插件沙箱使用 Function() 創建嚴格模式執行環境
// 注入 8 個參數：require, __musicfree_require, module, exports, console, env, URL, process

// packages 對應關係（Web 環境 polyfill）
const packages: Record<string, any> = {
  // axios: 原生 fetch 封裝
  axios: {
    get: async (url: string, config?: any) => {
      const r = await fetch(url, config)
      return { data: await r.json(), headers: r.headers as any, status: r.status }
    },
    post: async (url: string, data?: any, config?: any) => {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), ...config })
      return { data: await r.json(), headers: r.headers as any, status: r.status }
    },
    create: () => ({ get: packages.axios.get, post: packages.axios.post }),
    defaults: { timeout: 2000 },
    interceptors: { response: { use: () => {} } },
  },
  // cheerio: HTML 解析（Web 端用 DOMParser 模擬）
  cheerio: {
    load: (html: string) => {
      const parser = new DOMParser()
      const doc = parser.parseFromString(html, 'text/html')
      return {
        text: (sel: string) => ((doc as any).querySelector(sel) as any)?.innerText || '',
        html: (sel?: string) => sel ? ((doc as any).querySelector(sel) as any)?.innerHTML || '' : doc.documentElement.outerHTML,
        attr: (sel: string, attr: string) => doc.querySelector(sel)?.getAttribute(attr) || '',
        find: (sel: string) => ({ load: () => packages.cheerio.load(((doc as any).querySelector(sel) as any)?.outerHTML || '') }),
        each: () => {},
        map: () => [],
      }
    },
  },
  // crypto-js（Web 環境依賴 HTML 預載入 window.CryptoJS）
  'crypto-js': (() => {
    const ensureLoaded = () => {
      if ((self as any).CryptoJS) {
        return (self as any).CryptoJS
      }
      return null
    }
    return new Proxy({}, {
      get(_target: any, prop: string | symbol) {
        const CryptoJs = ensureLoaded()
        if (!CryptoJs) {
          console.warn(`crypto-js not pre-loaded, accessing ${prop as string}`)
          return () => ({ toString: () => '' })
        }
        return CryptoJs[prop as string]
      }
    })
  })(),
  // dayjs
  dayjs: (d?: any) => ({
    format: () => new Date(d).toISOString(),
    unix: () => Math.floor(Date.now() / 1000),
    valueOf: () => Date.now(),
  }),
  // he (HTML entities)
  he: { decode: (s: string) => s, encode: (s: string) => s },
  // big-integer
  'big-integer': (n: number) => ({
    toString: () => String(n),
    mod: (m: number) => n % m,
    shiftLeft: (s: number) => n << s,
    and: (m: number) => n & m,
    or: (m: number) => n | m,
  }),
  // qs (query string)
  qs: {
    parse: (s: string) => {
      const p: any = {}
      s.split('&').forEach(kvp => { const [k, v] = kvp.split('='); p[k] = decodeURIComponent(v || ''); })
      return p
    },
    stringify: (obj: any) => Object.entries(obj).map(([k, v]) => `${k}=${encodeURIComponent(String(v as any))}`).join('&'),
  },
  // webdav: Web 端不可用
  webdav: {},
  // @react-native-cookies/cookies
  '@react-native-cookies/cookies': { get: () => Promise.resolve({}), set: () => {}, flush: () => {} },
}

// _require 函數：MusicFree 原生邏輯
const _require = (packageName: string) => {
  const pkg = packages[packageName]
  if (pkg) { pkg.default = pkg; return pkg }
  console.warn(`MusicFree plugin require: ${packageName} not found`)
  return {}
}

// env 環境變數（MusicFree 原生邏輯）
const _env = {
  getUserVariables: () => ({}),
  get userVariables() { return this.getUserVariables() ?? {} },
  appVersion: '1.0.0',
  os: 'web',
  lang: 'zh-CN',
}

// process（MusicFree 原生邏輯）
const _process = {
  platform: 'web' as string,
  version: '1.0.0',
  env: _env,
}

export class PluginRunner {
  /**
   * 加載插件代碼（MusicFree 原生沙箱）
   * @param code 插件源代碼（TypeScript 或 JavaScript）
   * @returns Plugin 實例
   */
  static load(code: string): Plugin {
    const module: any = { exports: {} }
    const exports = module.exports

    try {
      // MusicFree 原生：使用 Function() 創建嚴格模式沙箱
      // 注入 8 個參數：require, __musicfree_require, module, exports, console, env, URL, process
      const instance: any = Function(`
        'use strict';
        return function(require, __musicfree_require, module, exports, console, env, URL, process) {
          ${code}
        }
      `)()(_require, _require, module, exports, console, _env, URL, _process)

      let plugin: any
      if (module.exports.default) {
        plugin = module.exports.default
      } else {
        plugin = module.exports
      }

      // MusicFree 原生：處理 userVariables
      if (Array.isArray(plugin.userVariables)) {
        plugin.userVariables = plugin.userVariables.filter((it: any) => it?.key)
      }

      const platform = plugin.platform || 'unknown'
      const name = plugin.name || platform

      return {
        name,
        platform,
        version: plugin.version || '1.0.0',
        description: plugin.description || '',
        author: plugin.author || '',
        instance: plugin,
        async search(keyword: string, page?: number, type?: SearchType) {
          const result: any = await plugin.search?.(keyword, page || 1, type || 'music')
          if (!result) return { data: [], isEnd: true }
          // MusicFree 插件返回 { data: IMusicItem[], isEnd: boolean }
          const items: any[] = result.data || result.musicList || result.albumList || result.sheetList || result.artistList || []
          return {
            data: Array.isArray(items) ? items.map((item: any) => ({
              ...item,
              platform,
              id: item.id || item.songmid || '',
              artist: item.artist || item.artistName || '',
              artwork: item.artwork || item.cover || '',
            })) : [],
            isEnd: result.isEnd ?? true,
          }
        },
        async getMediaSource(item: MusicItem, quality?: string) {
          const result: any = await plugin.getMediaSource?.(item, quality || 'standard')
          return {
            url: result?.url || '',
            headers: result?.headers,
            userAgent: result?.userAgent,
          }
        },
        async getMusicInfo(item: MusicItem) {
          return plugin.getMusicInfo?.(item) || null
        },
        async getLyric(item: MusicItem) {
          return plugin.getLyric?.(item) || null
        },
        async getAlbumInfo(item: any, page?: number) {
          return plugin.getAlbumInfo?.(item, page || 1) || null
        },
        async getArtistInfo(item: any, page?: number, type?: string) {
          return plugin.getArtistInfo?.(item, page || 1, type) || null
        },
        async getMusicSheetInfo(item: any, page?: number) {
          return plugin.getMusicSheetInfo?.(item, page || 1) || null
        },
      }
    } catch (e: any) {
      const err = e?.message || String(e)
      throw new Error(`插件加載失敗: ${err}`)
    }
  }

  /**
   * 從 URL 加載插件
   * 備用 CDN 策略：raw.githubusercontent.com → gitee.com
   */
  static async loadFromURL(url: string): Promise<Plugin> {
    const cdns = [
      url, // 原始 URL
      url.replace('raw.githubusercontent.com', 'gitee.com'), // gitee
    ]

    for (const attemptUrl of cdns) {
      try {
        const response = await fetch(attemptUrl)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const code = await response.text()
        return this.load(code)
      } catch (e: any) {
        console.warn(`CDN 嘗試失敗: ${attemptUrl}`, e.message)
      }
    }
    throw new Error('所有 CDN 都無法獲取插件')
  }
}