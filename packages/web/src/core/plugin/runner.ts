import { Plugin, MusicItem, SearchType } from '../types'

// ====== MusicFree 原生 packages polyfill ======
const packages: Record<string, any> = {
  // axios: MusicFree 插件用 require('axios').default.get()，所以必須是函數且有 .get/.post
  axios: (function() {
    function axiosFn(url: string, config?: any) {
      return axiosFn.get(url, config)
    }
    axiosFn.get = async (url: string, config?: any) => {
      let finalUrl = url
      if (config?.params) {
        const qs = Object.entries(config.params)
          .filter(([, v]) => v !== undefined && v !== null)
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v as any))}`)
          .join('&')
        finalUrl = url + (url.includes('?') ? '&' : '?') + qs
      }
      const r = await fetch(finalUrl, { headers: config?.headers, ...config })
      let data: any = await r.text()
      try { data = JSON.parse(data) } catch { /* not json */ }
      return { data, headers: r.headers as any, status: r.status, config }
    }
    axiosFn.post = async (url: string, data?: any, config?: any) => {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(config?.headers || {}) }, body: JSON.stringify(data), ...config })
      let json: any = await r.text()
      try { json = JSON.parse(json) } catch { /* not json */ }
      return { data: json, headers: r.headers as any, status: r.status, config }
    }
    axiosFn.create = () => axiosFn
    axiosFn.defaults = { timeout: 2000 }
    axiosFn.interceptors = { response: { use: () => {} } }
    return axiosFn
  })(),
  cheerio: {
    load: (html: string) => {
      const parser = new DOMParser()
      const doc = parser.parseFromString(html, 'text/html')
      const find = (sel: string) => ({
        text: () => ((doc as any).querySelector(sel) as any)?.innerText || '',
        html: () => ((doc as any).querySelector(sel) as any)?.innerHTML || '',
        attr: (a: string) => doc.querySelector(sel)?.getAttribute(a) || '',
        load: (h: string) => packages.cheerio.load(h),
        each: () => {},
        map: () => [],
      })
      return { text: find, html: find, attr: find, find, each: () => {}, map: () => [] }
    },
  },
  'crypto-js': (() => {
    if ((self as any).CryptoJS) return (self as any).CryptoJS
    let loading = false, loaded = false
    const ensureLoaded = () => {
      if (loaded || (self as any).CryptoJS) { loaded = true; return }
      if (loading) return
      loading = true
      const s = document.createElement('script')
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.2.0/crypto-js.min.js'
      s.onload = () => { loaded = true }
      document.head.appendChild(s)
    }
    ensureLoaded()
    return new Proxy({}, { get: (_t, p) => { ensureLoaded(); if ((self as any).CryptoJS) return (self as any).CryptoJS[p as string]; return () => ({toString:()=>''}) } })
  })(),
  dayjs: (d?: any) => ({ format: () => new Date(d).toISOString(), unix: () => Math.floor(Date.now() / 1000) }),
  he: { decode: (s: string) => s },
  'big-integer': (n: any) => ({ toString: () => String(n) }),
  qs: { parse: () => ({}), stringify: (obj: any) => Object.entries(obj).map(([k,v]) => `${k}=${encodeURIComponent(String(v as any))}`).join('&') },
  webdav: {},
  '@react-native-cookies/cookies': { get: () => Promise.resolve({}), set: () => {}, flush: () => {} },
}

// ====== _require 函數 ======
const _require = (packageName: string) => {
  const pkg = packages[packageName]
  if (pkg) {
    if (!pkg.default) pkg.default = pkg
    return pkg
  }
  console.warn(`MusicFree plugin require: ${packageName} not found`)
  return {}
}

// ====== env / process ======
const _env = {
  getUserVariables: () => ({}),
  get userVariables() { return this.getUserVariables() },
  appVersion: '1.0.0', os: 'web', lang: 'zh-CN',
}
const _process = { platform: 'web' as string, version: '1.0.0', env: _env }

// ====== resetMediaItem ======
function resetMediaItem(item: any, platform?: string) {
  if (!item || !platform) return item
  item.platform = platform
  return item
}

// ====== PluginRunner ======
export class PluginRunner {
  static load(code: string): Plugin {
    const _module: any = { exports: {} }
    const _exports = _module.exports
    try {
      Function(`'use strict'; return function(require, __musicfree_require, module, exports, console, env, URL, process) { ${code} }`)()
        (_require, _require, _module, _exports, console, _env, URL, _process)
      let plugin: any = _module.exports.default || _module.exports
      if (Array.isArray(plugin.userVariables)) plugin.userVariables = plugin.userVariables.filter((it: any) => it?.key)
      this.checkValid(plugin)
      return {
        platform: plugin.platform, name: plugin.name || plugin.platform, version: plugin.version || '1.0.0',
        description: plugin.description || '', author: plugin.author || '',
        userVariables: plugin.userVariables || [], cacheControl: plugin.cacheControl || 'no-cache',
        instance: plugin, supportedMethods: new Set(Object.keys(plugin).filter((k: string) => typeof plugin[k] === 'function')),
        async search(query: string, page?: number, type?: SearchType) {
          if (!plugin.search) return { isEnd: true, data: [] as MusicItem[] }
          const result: any = await plugin.search(query, page || 1, type || 'music') ?? {}
          if (Array.isArray(result.data)) {
            result.data.forEach((item: any) => resetMediaItem(item, plugin.platform))
            return { isEnd: result.isEnd ?? true, data: result.data }
          }
          return { isEnd: true, data: [] as MusicItem[] }
        },
        async getMediaSource(item: any, quality?: string) {
          return plugin.getMediaSource?.(item, quality || 'standard') || null
        },
      }
    } catch (e: any) {
      console.error('插件加載失敗', e?.message || String(e))
      throw new Error(`插件加載失敗: ${e?.message || String(e)}`)
    }
  }
  private static checkValid(instance: any) {
    if (!instance.platform || instance.platform === '') throw new Error('插件缺少 platform 字段')
  }
  static async loadFromURL(url: string): Promise<Plugin> {
    const r = await fetch(url)
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return this.load(await r.text())
  }
}