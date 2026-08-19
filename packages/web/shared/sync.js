/**
 * 裝置配對碼的共用規則 —— Cloudflare worker 與自架的 server.mjs 都 import 這一份。
 *
 * 為什麼要共用而不是各寫一份：兩個後端各自實作同一套規則，遲早會分岔。這個專案
 * 已經被這件事咬過一次（建置戳記在 vite 與 esbuild 各算一次，結果兩邊差一個字元，
 * 「前後端不一致」的警示天天誤報）。碼的字母表、長度、上限、正規化只要有一邊改了
 * 另一邊沒跟上，就會出現「A 裝置產生的碼 B 裝置說格式不正確」這種極難查的問題。
 *
 * 只放純邏輯，不碰儲存：KV 與檔案系統差太多，各自實作反而清楚。
 */

/** 去掉 0/O/1/I 這些看起來像的字元 —— 使用者要用手打。8 碼 × 32 種 = 40 bits */
export const SYNC_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
export const SYNC_CODE_LEN = 8
export const SYNC_TTL = 86400            // 24 小時（秒）
export const SYNC_MAX_BYTES = 256 * 1024 // 一份音源約 15 KB，這個上限很寬鬆
export const SYNC_MAX_PLUGINS = 12

/**
 * 產生配對碼。crypto.getRandomValues 在 Workers 與 Node 18+ 都是全域可用的，
 * 所以同一份實作兩邊都能跑。
 */
export function newSyncCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(SYNC_CODE_LEN))
  let out = ''
  // 32 是 2 的冪，取模不會有偏差
  for (const b of bytes) out += SYNC_ALPHABET[b % SYNC_ALPHABET.length]
  return out
}

/** 使用者可能連著連字號或小寫一起貼進來 */
export function normalizeSyncCode(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/**
 * 檢查並清洗要同步的音源清單。
 * 回 { error } 代表不接受；回 { clean } 才是可以存下去的內容。
 */
export function validateSyncPayload(parsed) {
  const plugins = Array.isArray(parsed?.plugins) ? parsed.plugins : null
  if (!plugins || plugins.length === 0) return { error: '沒有可同步的音源' }
  if (plugins.length > SYNC_MAX_PLUGINS) {
    return { error: `音源數量超過上限（${SYNC_MAX_PLUGINS}）` }
  }
  // 只留我們認得的欄位，別把前端塞進來的任何東西原樣存下
  const clean = plugins.map(p => ({
    name: String(p?.name || ''),
    code: String(p?.code || ''),
    enabled: p?.enabled !== false,
  }))
  if (clean.some(p => !p.name || !p.code)) return { error: '音源資料不完整' }
  return { clean }
}
