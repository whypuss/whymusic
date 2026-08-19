import { Plugin } from '../types'

/**
 * 插件執行環境。
 *
 * 一支插件就是一份 CommonJS 程式碼：`module.exports` 出幾個方法（`search`、
 * `getMediaSource`、`getLyric`…）就是一個音源。這裡用 `new Function` 建一個沙箱，
 * 只把明確列出的東西交給它 —— 沒有 `window`、沒有 `document`、沒有 `localStorage`，
 * 插件碰不到頁面狀態，也拿不到其他插件的東西。
 *
 * 沙箱刻意很小：插件要什麼自己用 `fetch` 去拿。曾經為了讓某個生態的現成插件能跑，
 * 這裡塞過 axios / crypto-js / dayjs / qs / he / big-integer / cheerio 七個 shim，
 * 還有一份「哪些網域要走代理」的清單。那些東西沒有一個是本專案的音源用得到的
 * （`plugins/whymusic.js` 只用原生 fetch），全部移除 —— 少一層猜測，插件行為就少一個
 * 說不清楚的地方。要代理的插件自己打 `/api/proxy`，那是明講的，不是我們替它決定的。
 */

/**
 * 未提供的模組要明確拋錯。
 *
 * 原本這裡對不認識的模組回一個空物件 `{}`，結果插件會在後面某個地方以
 * 「`undefined` is not a function」之類的訊息炸掉，完全看不出真正的原因是缺模組。
 */
const _require = (packageName: string) => {
  throw new Error(
    `插件要求模組「${packageName}」，但這個播放器的沙箱不提供任何模組。` +
    `插件請改用原生 fetch；需要跨域代抓時打 /api/proxy?url=<目標>。`,
  )
}

const _console = {
  log: (...args: any[]) => console.log(...args),
  warn: (...args: any[]) => console.warn(...args),
  info: (...args: any[]) => console.info(...args),
  error: (...args: any[]) => console.error(...args),
}

export class PluginRunner {
  static load(code: string): Plugin {
    const sandbox = {
      module: { exports: {} },
      exports: {},
      require: _require,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      Promise,
      fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init),
      URL,
      URLSearchParams,
      btoa: (str: string) => btoa(str),
      atob: (str: string) => atob(str),
      console: _console,
    }

    const argNames = Object.keys(sandbox)
    const argValues = Object.values(sandbox)

    const pluginFunc = new Function(...argNames, code)
    pluginFunc(...argValues)

    let pluginDef: any = sandbox.module.exports || sandbox.exports
    if (pluginDef && pluginDef.default) {
      pluginDef = pluginDef.default
    }
    return pluginDef as Plugin
  }

  static async loadFromURL(url: string): Promise<Plugin> {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Failed to fetch plugin: ${url}`)
    const code = await response.text()
    return this.load(code)
  }
}
