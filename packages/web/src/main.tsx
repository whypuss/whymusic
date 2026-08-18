import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

/**
 * iOS / iPadOS 判定。iPadOS 的 Safari 會偽裝成 Mac，只能靠「MacIntel 但有觸控點」
 * 這個組合認出來。
 */
function isIOS(): boolean {
  if (/iP(hone|ad|od)/.test(navigator.userAgent)) return true
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
}

/**
 * Service worker：只在非 iOS 註冊，iOS 上主動反註冊。
 *
 * SW 加進來的唯一目的是讓 Chrome 產生 WebAPK，因為國產 Android ROM 只給已安裝的
 * 應用完整的鎖屏媒體控制待遇（詳見 public/sw.js）。iOS 的「加到主畫面」不需要 SW，
 * 所以 iOS 完全沒有理由承擔它的風險。
 *
 * 而風險是真的：iOS 會很積極地終止 service worker，而頁面一旦被 SW 控制，同源的
 * 音訊請求都得先經過 SW 的 fetch handler。鎖屏時音訊要續抓下一段，瀏覽器得先叫醒
 * SW —— 叫不醒就抓不到，於是鎖屏顯示「播放中」卻沒聲音，解鎖後 SW 醒了聲音才回來。
 * 使用者實測正是這個症狀，而且時間點正好落在 SW 上線之後。
 *
 * iOS 上必須「主動反註冊」而不是單純不註冊：已經裝上的 SW 會一直留著。
 *
 * 只在正式建置動作：開發時多一層 SW 只會讓「改了程式卻沒生效」更難查。
 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    if (isIOS()) {
      void (async () => {
        try {
          const regs = await navigator.serviceWorker.getRegistrations()
          await Promise.all(regs.map(r => r.unregister()))
          // 連快取一起清掉，別留下任何會蓋住新版前端的舊資料
          if ('caches' in window) {
            const names = await caches.keys()
            await Promise.all(names.map(n => caches.delete(n)))
          }
          if (regs.length > 0) console.log(`[sw] iOS：已反註冊 ${regs.length} 個 SW`)
        } catch (err) {
          console.warn('[sw] iOS 反註冊失敗:', err)
        }
      })()
      return
    }
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[sw] 註冊失敗（不影響播放）:', err)
    })
  })
}
