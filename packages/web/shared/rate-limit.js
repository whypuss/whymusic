/**
 * 每來源（IP）的 token bucket 限流。純記憶體、零依賴。
 *
 * 給自架版用（Node）。Cloudflare 那邊不用這個 —— Workers 每個請求可能落在不同
 * isolate，記憶體狀態不共用，限流要靠 CF 平台的規則，不是應用層。
 *
 * 為什麼要限流：/api/proxy 會實際去外部抓資料，沒有節流的話，一台 0.5 核的小機
 * 很容易被單一來源灌爆，或因為短時間打太多次而被上游（GD）封 IP。token bucket
 * 允許突發（桶滿時可連續取用）但長期平均受 refill 速率約束，比固定視窗更貼合
 * 「偶爾一陣、平常很閒」的真實使用。
 */

export class RateLimiter {
  /**
   * @param {object} opts
   * @param {number} opts.capacity   桶容量（可累積的突發次數）
   * @param {number} opts.refillPerSec 每秒回補幾個 token（≈ 長期平均每秒允許次數）
   * @param {number} [opts.maxKeys]   最多追蹤幾個來源，防止記憶體被大量 IP 撐爆
   */
  constructor({ capacity, refillPerSec, maxKeys = 10000 }) {
    this.capacity = capacity
    this.refillPerSec = refillPerSec
    this.maxKeys = maxKeys
    this.buckets = new Map() // key → { tokens, ts }
  }

  /**
   * 取用一個 token。回 true＝放行，false＝超限該擋。
   * key 通常是來源 IP。
   */
  take(key) {
    const now = Date.now()
    let b = this.buckets.get(key)
    if (!b) {
      // 到上限就從最舊的開始清（Map 保留插入順序）。被清掉的來源下次來視同新桶，
      // 等於放它過 —— 可接受：能撐爆 maxKeys 個不同 IP 的攻擊，限流也不是主防線。
      if (this.buckets.size >= this.maxKeys) {
        const oldest = this.buckets.keys().next().value
        this.buckets.delete(oldest)
      }
      b = { tokens: this.capacity, ts: now }
      this.buckets.set(key, b)
    } else {
      // 依經過時間回補
      const elapsed = (now - b.ts) / 1000
      b.tokens = Math.min(this.capacity, b.tokens + elapsed * this.refillPerSec)
      b.ts = now
    }
    if (b.tokens < 1) return false
    b.tokens -= 1
    return true
  }
}
