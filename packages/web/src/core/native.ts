/**
 * 「這份前端是不是跑在原生 App（Android APK）裡」的判定，以及由此而來的行為差異。
 *
 * 為什麼需要這個開關：網頁版與 APK 版對「跨域」的處境剛好相反。
 *
 *   網頁版：站台是 https，而音源 URL 常是 http（netease CDN 回的是
 *     http://m801.music.126.net/…）。瀏覽器擋 mixed content，所以音訊必須繞
 *     同源後端的 /api/proxy 轉一手，才播得出來。
 *
 *   APK 版：WebView 是我們自己配置的，可以直接允許 cleartext 與 mixed content，
 *     於是**直接播原始 URL 反而更好** —— 少一個代理跳點、少一份延遲，也不必
 *     隨 APK 附一個後端。而且 APK 裡沒有 /api/*，硬走代理只會全部失敗。
 *
 * 判定方式刻意用「有沒有 Capacitor 執行環境」而不是 UA 字串：UA 可以被改、
 * 也可能在其他 WebView 裡誤判，而 window.Capacitor 只有真的被 Capacitor 載入
 * 時才存在。額外接受建置期注入的旗標，方便在瀏覽器裡除錯原生行為。
 */

declare global {
  interface Window {
    Capacitor?: { isNativePlatform?: () => boolean; platform?: string }
    __WHYMUSIC_NATIVE__?: boolean
  }
}

/** 這份前端是否跑在原生 App 容器裡（沒有本站後端可用） */
export function isNative(): boolean {
  if (typeof window === 'undefined') return false
  if (window.__WHYMUSIC_NATIVE__ === true) return true
  const cap = window.Capacitor
  if (!cap) return false
  // isNativePlatform 在 Capacitor 的 web 目標會回 false，原生才 true
  return typeof cap.isNativePlatform === 'function' ? cap.isNativePlatform() : !!cap.platform
}

/**
 * 把跨域資源包成經由本站後端代抓的 URL。原生模式下不包 —— 沒有後端，
 * 而且 WebView 允許直連。同源路徑也不包（代理只吃絕對 URL）。
 */
export function viaProxy(url: string): string {
  if (isNative()) return url
  const sameOrigin = url.startsWith('/')
    || (typeof window !== 'undefined' && url.startsWith(window.location.origin))
  return sameOrigin ? url : `/api/proxy?url=${encodeURIComponent(url)}&method=GET`
}
