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
 * 註冊 service worker —— 目的是讓這個站可以被「安裝」成獨立應用，因為國產
 * Android ROM 只給已安裝的應用完整的鎖屏媒體控制待遇（詳見 public/sw.js）。
 *
 * 只在正式建置註冊：開發時多一層 SW 只會讓「改了程式卻沒生效」變得更難查。
 * 註冊失敗不影響任何功能，所以只記 log 不打擾使用者。
 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[sw] 註冊失敗（不影響播放）:', err)
    })
  })
}
