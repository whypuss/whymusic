import { Plugin } from '../types'
import CryptoJS from 'crypto-js'

// ====== MusicFree 原生 packages polyfill ======
// 完全照搬原項目 src/core/pluginManager/plugin.ts 的 packages 對象

const axios = (function() {
  function axiosFn(config: any) {
    return fetch(config.url || config, {
      method: config.method || 'GET',
      headers: config.headers,
      body: config.data ? JSON.stringify(config.data) : undefined,
    }).then(async (res) => {
      const headers: Record<string, string> = {}
      res.headers.forEach((v, k) => { headers[k] = v })
      const data = config.responseType === 'json' ? await res.json() : await res.text()
      return {
        status: res.status,
        statusText: res.statusText,
        headers,
        config,
        data,
      }
    })
  }
  axiosFn.get = (url: string, config?: any) => axiosFn({ ...config, url, method: 'GET' })
  axiosFn.post = (url: string, data?: any, config?: any) => axiosFn({ ...config, url, method: 'POST', data })
  axiosFn.put = (url: string, data?: any, config?: any) => axiosFn({ ...config, url, method: 'PUT', data })
  axiosFn.delete = (url: string, config?: any) => axiosFn({ ...config, url, method: 'DELETE' })
  axiosFn.patch = (url: string, data?: any, config?: any) => axiosFn({ ...config, url, method: 'PATCH', data })
  axiosFn.defaults = { timeout: 2000 }
  axiosFn.create = () => axiosFn
  axiosFn.interceptors = { response: { use: () => ({ detach: () => {} }) } }
  return axiosFn
})()

// 原項目：packages = { cheerio, "crypto-js": CryptoJs, axios, dayjs, ... }
const packages: Record<string, any> = {
  axios,
  'crypto-js': CryptoJS,
  dayjs: (date?: any) => {
    const d = date ? new Date(date) : new Date()
    return {
      format: (fmt: string) => {
        const pad = (n: string | number) => { const s = String(n); return s.length === 1 ? '0' + s : s }
        return fmt
          .replace('YYYY', String(d.getFullYear()))
          .replace('MM', pad(d.getMonth() + 1))
          .replace('DD', pad(d.getDate()))
          .replace('HH', pad(d.getHours()))
          .replace('mm', pad(d.getMinutes()))
          .replace('ss', pad(d.getSeconds()))
      },
    }
  },
  qs: {
    parse: (str: string) => {
      const params = new URLSearchParams(str)
      const obj: Record<string, any> = {}
      for (const [k, v] of params) { obj[k] = v }
      return obj
    },
    stringify: (obj: Record<string, any>) => {
      const params = new URLSearchParams()
      for (const [k, v] of Object.entries(obj)) { params.set(k, String(v)) }
      return params.toString()
    },
  },
  he: {
    encode: (str: string) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
    decode: (str: string) => str.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&'),
  },
  'big-integer': {
    // 簡單實現
  },
  cheerio: {
    load: (html: string) => {
      // 簡單實現：用 DOMParser
      const parser = new DOMParser()
      const doc = parser.parseFromString(html, 'text/html')
      return {
        selector: (sel: string) => doc.querySelectorAll(sel),
        find: (sel: string) => doc.querySelectorAll(sel),
        eq: (i: number) => doc.querySelectorAll('*')[i],
        text: () => doc.body.innerText,
        html: () => doc.body.innerHTML,
        attr: (name: string) => doc.body.getAttribute(name),
      }
    },
  },
  webdav: {},
}

// 原項目：const _require = (packageName) => { let pkg = packages[packageName]; pkg.default = pkg; return pkg; }
const _require = (packageName: string) => {
  let pkg = packages[packageName]
  if (!pkg) {
    pkg = {}
  }
  pkg.default = pkg
  return pkg
}

const _console = {
  log: (...args: any[]) => console.log(...args),
  warn: (...args: any[]) => console.warn(...args),
  info: (...args: any[]) => console.info(...args),
  error: (...args: any[]) => console.error(...args),
}

const appVersion = '1.0.0'

function formatAuthUrl(url: string) {
  try {
    const urlObj = new URL(url)
    if (urlObj.username && urlObj.password) {
      const auth = `Basic ${btoa(decodeURIComponent(urlObj.username) + ':' + decodeURIComponent(urlObj.password))}`
      urlObj.username = ''
      urlObj.password = ''
      return { url: urlObj.toString(), auth }
    }
    return { url }
  } catch (e) {
    return { url }
  }
}

export class PluginRunner {
  static load(code: string): Plugin {
    const sandbox = {
      module: { exports: {} },
      exports: {},
      require: _require,
      packages,
      _require,
      _console,
      appVersion,
      formatAuthUrl,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      Promise,
      fetch,
      URL,
      btoa: (str: string) => btoa(str),
      atob: (str: string) => atob(str),
      console: _console,
    }

    const argNames = Object.keys(sandbox)
    const argValues = Object.values(sandbox)

    const pluginFunc = new Function(...argNames, code)
    pluginFunc(...argValues)

    const pluginDef = sandbox.module.exports || sandbox.exports
    return pluginDef as Plugin
  }

  static async loadFromURL(url: string): Promise<Plugin> {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Failed to fetch plugin: ${url}`)
    const code = await response.text()
    return this.load(code)
  }
}
