/**
 * Service Worker —— 存在的理由是「可安裝」，不是為了快取。
 *
 * 國產 Android ROM 對「瀏覽器裡的網頁」和「已安裝的應用」是兩套待遇（實測：一台
 * 一加通知欄有媒體通知但鎖屏沒有、一台 vivo 兩邊都沒有，同一份程式在 iOS 鎖屏正常）。
 * 要讓 Chrome 產生 WebAPK、把這個站當成有獨立身分的應用，需要一支帶 fetch handler
 * 的 service worker —— 手動「加到主畫面」不需要它，但自動安裝提示與 WebAPK 需要。
 *
 * 策略刻意是**網路優先，只有離線才退回快取**。快取優先會讓使用者看到舊版前端，
 * 而這個專案已經被版本混淆咬過一次（CF 邊緣延遲 vs 沒部署，分不出來），絕不能再
 * 自己加一層更難察覺的舊版來源。線上時永遠拿最新的。
 */
const CACHE = 'whymusic-v1'

// 不進快取的路徑：
//   /api/    後端回應本身就標了 no-store，快取只會製造矛盾
//   /plugins/ 音源程式碼，重新安裝時必須拿到最新的那份
const NO_CACHE = ['/api/', '/plugins/']

self.addEventListener('install', () => {
  // 不預快取任何東西：離線可用是附帶效果，不是目標
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(names.filter(n => n !== CACHE).map(n => caches.delete(n)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  let url
  try {
    url = new URL(request.url)
  } catch {
    return
  }
  if (url.origin !== self.location.origin) return
  if (NO_CACHE.some(prefix => url.pathname.startsWith(prefix))) return

  event.respondWith(
    (async () => {
      try {
        const response = await fetch(request)
        // 只快取成功的完整回應。206（Range，音訊）與錯誤頁都不留
        if (response.ok && response.status === 200) {
          const cache = await caches.open(CACHE)
          cache.put(request, response.clone())
        }
        return response
      } catch (err) {
        // 這裡才是快取唯一的用途：真的連不上網
        const cached = await caches.match(request)
        if (cached) return cached
        // SPA 導覽：離線時退回首頁的快取
        if (request.mode === 'navigate') {
          const shell = await caches.match('/')
          if (shell) return shell
        }
        throw err
      }
    })(),
  )
})
