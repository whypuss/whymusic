import { Plugin } from '../types'
import { isNative } from '../native'

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

/**
 * 給插件的 fetch。網頁版就是原生 fetch；App 版多一條救援路徑。
 *
 * 為什麼需要救援：App 版沒有本站後端，插件不能像網頁版那樣打 `/api/proxy`
 * 繞過跨域限制，於是**只有送 CORS 標頭的上游**打得到。這不是理論問題 ——
 * 網易雲的公開端點（專輯詳情、專輯搜尋）一個 CORS 標頭都不送，在 APK 裡
 * 直接 fetch 一律 `Failed to fetch`，而它是專輯資料唯一的來源。
 *
 * 救援用 Capacitor 的原生 HTTP：請求由 Java 層發出，不經 WebView 的
 * 跨域檢查（那個檢查是瀏覽器的安全模型，對已安裝的原生應用沒有意義 ——
 * App 本來就能開任何 socket）。
 *
 * **先試原生 fetch，失敗才走原生傳輸**，而不是在 App 版一律改道：
 * 目前跑得好的請求（GD API 有 CORS）行為完全不變，這條只是多出來的退路。
 * 回傳一個只做到插件實際會用的部分的 Response 形狀（status/ok/text/json）——
 * 假裝實作完整的 Response 只會在別的地方騙人。
 */
async function pluginFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init)
  } catch (err) {
    if (!isNative()) throw err
    const url = String(typeof input === 'string' ? input : (input as Request).url ?? input)
    // 相對路徑在 App 版指向不存在的本站後端，救不了也不該救
    if (!/^https?:\/\//i.test(url)) throw err
    const http = (window as any).Capacitor?.Plugins?.CapacitorHttp
    if (!http?.request) throw err
    console.warn('[plugin] 直連失敗，改用原生 HTTP：' + url.slice(0, 80))
    const res = await http.request({
      url,
      method: (init?.method || 'GET').toUpperCase(),
      headers: (init?.headers as Record<string, string>) || undefined,
      data: init?.body,
    })
    // 原生層可能已經把 JSON 解好了，也可能回字串 —— 兩種都要能給出文字
    const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? '')
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      text: async () => text,
      json: async () => (typeof res.data === 'string' ? JSON.parse(res.data) : res.data),
    } as Response
  }
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
      fetch: (input: RequestInfo | URL, init?: RequestInit) => pluginFetch(input, init),
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
