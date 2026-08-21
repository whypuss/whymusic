/**
 * /api/proxy 的安全檢查 —— Cloudflare worker 與自架 server.mjs 共用這一份。
 *
 * proxy 存在的理由是幫瀏覽器代抓跨域資源（音源 URL、使用者貼的第三方插件）。
 * 但「代抓任意 URL」正是 SSRF：沒有防護的話，任何人都能用
 *     GET /api/proxy?url=http://169.254.169.254/latest/meta-data/...
 * 把這台伺服器當跳板去打雲端 metadata（偷 IAM 憑證）、掃內網、或當反射器。
 * 這台機器一旦在公網上，這就是最先會被打的洞。
 *
 * 威脅模型與取捨：
 *   - 這個 app 刻意支援「貼任意第三方插件 URL」與「從任意 CDN 播放」，所以
 *     **不能**用硬性網域白名單當主防線 —— 那會把正常功能一起擋掉。
 *   - 真正的主防線是**封鎖私有／保留 IP 網段**：外網公開位址照樣能代抓，但
 *     指向內網、loopback、雲 metadata 的一律拒絕。攻擊者就算把自己的網域解析
 *     到 127.0.0.1 也沒用 —— 見 server.mjs 的 DNS 解析後複查。
 *   - 網域白名單仍然提供，但**預設關閉**（空 = 允許任何公網 host）。想鎖死的
 *     營運者可用 PROXY_ALLOWED_HOSTS 開啟。
 *
 * 這一份只放「不需要 DNS 的同步檢查」（scheme、字面 IP、白名單）。Node 端另外
 * 做 DNS 解析後的複查（見 server.mjs 的 assertPublicHost）—— Workers 沒有
 * dns 模組，但 CF 邊緣本來就到不了私有網段，字面檢查對它已足夠。
 */

/** 把 IPv4 點分字串轉成 32-bit 整數；格式不對回 null */
function ipv4ToInt(s) {
  const parts = s.split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const p of parts) {
    // 只收純十進位 0–255，不接受空段或前導文字
    if (!/^\d{1,3}$/.test(p)) return null
    const v = Number(p)
    if (v > 255) return null
    n = n * 256 + v
  }
  return n >>> 0
}

/**
 * 這個 IPv4（整數形式）是否落在私有／保留網段。
 * 涵蓋 loopback、私有、link-local（含 169.254.169.254 雲 metadata）、
 * CGNAT、多播、保留等，凡是不該從公網代抓去打的都算。
 */
function isPrivateV4(n) {
  const inRange = (base, bits) => (n >>> (32 - bits)) === (ipv4ToInt(base) >>> (32 - bits))
  return (
    inRange('0.0.0.0', 8) ||        // 本網段
    inRange('10.0.0.0', 8) ||       // 私有
    inRange('100.64.0.0', 10) ||    // CGNAT
    inRange('127.0.0.0', 8) ||      // loopback
    inRange('169.254.0.0', 16) ||   // link-local（含雲 metadata 169.254.169.254）
    inRange('172.16.0.0', 12) ||    // 私有
    inRange('192.0.0.0', 24) ||     // IETF 保留
    inRange('192.0.2.0', 24) ||     // TEST-NET-1
    inRange('192.168.0.0', 16) ||   // 私有
    inRange('198.18.0.0', 15) ||    // benchmark
    inRange('198.51.100.0', 24) ||  // TEST-NET-2
    inRange('203.0.113.0', 24) ||   // TEST-NET-3
    n >= ipv4ToInt('224.0.0.0')     // 多播 224/4 與保留 240/4 以上全拒
  )
}

/**
 * 判斷一個 IP 字串（v4 或 v6）是否為私有／保留位址。
 * 認不出格式時回 true（當作不安全）—— 寧可誤擋，不可漏放。
 */
export function isPrivateIp(ip) {
  if (!ip) return true
  const addr = String(ip).trim().toLowerCase().replace(/^\[|\]$/g, '')

  // 純 IPv4
  if (/^\d+\.\d+\.\d+\.\d+$/.test(addr)) {
    const n = ipv4ToInt(addr)
    return n === null ? true : isPrivateV4(n)
  }

  // IPv6
  if (addr.includes(':')) {
    // IPv4-mapped / -embedded（::ffff:127.0.0.1、64:ff9b::7f00:1 等）：抽出尾段的 v4 複查
    const v4tail = addr.match(/(\d+\.\d+\.\d+\.\d+)$/)
    if (v4tail) {
      const n = ipv4ToInt(v4tail[1])
      if (n !== null && isPrivateV4(n)) return true
    }
    if (addr === '::1' || addr === '::') return true       // loopback / 未指定
    if (addr.startsWith('fe80') || addr.startsWith('fe9') ||
        addr.startsWith('fea') || addr.startsWith('feb')) return true  // link-local fe80::/10
    if (/^f[cd]/.test(addr)) return true                   // ULA fc00::/7（含 AWS v6 metadata fd00:ec2::254）
    return false
  }

  // 不是可辨識的 IP 字面 —— 交給呼叫端（可能是網域，Node 會再 DNS 解析複查）
  return false
}

/**
 * 不需要 DNS 的同步檢查：scheme 必須是 http/https、字面 IP 不得為私有、
 * 若設了白名單則 host 必須命中。
 *
 * allowedHosts：網域字串陣列，空陣列＝不限制（允許任何公網 host）。
 * 命中規則是後綴比對，所以 "gdstudio.xyz" 也涵蓋 "music-api.gdstudio.xyz"。
 *
 * 回傳 { ok: true, url } 或 { ok: false, reason }。
 */
export function checkProxyTarget(rawUrl, allowedHosts = []) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    return { ok: false, reason: 'URL 格式不正確' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: `不允許的協定：${url.protocol}` }
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')

  // host 若本身就是 IP 字面，當場擋掉私有網段（DNS 那關在 Node 端另做）
  if (/^[\d.]+$/.test(host) || host.includes(':')) {
    if (isPrivateIp(host)) return { ok: false, reason: '目標指向私有／保留位址' }
  }

  if (allowedHosts.length > 0) {
    const hit = allowedHosts.some(h => host === h || host.endsWith('.' + h))
    if (!hit) return { ok: false, reason: `host 不在白名單：${host}` }
  }
  return { ok: true, url }
}

/** 從逗號分隔字串解析白名單（給環境變數用）。空／未設回空陣列＝不限制 */
export function parseAllowedHosts(raw) {
  if (!raw) return []
  return String(raw).split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
}
