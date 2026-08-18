/**
 * 建置戳記：讓「線上跑的是哪一版」能一眼看出來。
 *
 * 前端與後端（worker）各自把這個字串編進去，並且都顯示在「音源」頁上。
 * 這樣不只能看出有沒有更新，還能看出**是不是只更新了一半** —— 例如前端部署了
 * 但 worker 沒有（或反過來），兩個戳記就會不一樣。
 *
 * 格式：<git short sha><有未提交變更則加 +> · <建置時間 MM-DD HH:mm>
 * 用建置時間而非 commit 時間：同一個 commit 重新部署時戳記也會變，才分得出
 * 「我剛剛部署過」與「還是舊的那次」。
 *
 * 前端與 worker 都 import 這一支（vite.config.ts 也是），而且 scripts/build-cf.mjs
 * 會先算好、用 BUILD_STAMP 傳給兩邊 —— 一次建置只算一次。這很重要：兩邊各自算
 * 過的時候戳記會不一致，因為時間可能跨分鐘，而且 Vite 5 載入 TS 設定檔時會在
 * vite.config.ts 旁邊寫一個臨時檔，讓前端那次剛好看到「髒」的工作區、多一個 `+`。
 * 那會讓 UI 誤報「只部署了一半」，等於警示失效。
 */
import { execSync } from 'node:child_process'

function git(cmd, fallback) {
  try {
    return execSync(`git ${cmd}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return fallback
  }
}

/** Vite 載入 TS 設定檔時吐在設定檔旁邊的臨時檔，不算工作區變更 */
const IS_BUILD_ARTIFACT = /\.timestamp-\d+/

function isDirty() {
  const lines = git('status --porcelain', '').split('\n').filter(Boolean)
  return lines.some((line) => !IS_BUILD_ARTIFACT.test(line))
}

export function buildStamp() {
  // 由 build-cf.mjs 算好傳進來時直接沿用，確保前端與 worker 拿到同一個字串
  if (process.env.BUILD_STAMP) return process.env.BUILD_STAMP

  const sha = git('rev-parse --short HEAD', 'nogit')
  const dirty = isDirty() ? '+' : ''
  const t = new Date()
  const p = (n) => String(n).padStart(2, '0')
  const when = `${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}`
  return `${sha}${dirty} · ${when}`
}
