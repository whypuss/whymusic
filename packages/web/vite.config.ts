import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'

/**
 * 建置戳記編進前端，顯示在「音源」頁 —— 用來判斷線上跑的是哪一版。
 *
 * 與 scripts/build-stamp.mjs（worker 用的那支）刻意保持同樣格式。這裡不 import
 * 它：vite.config 在 packages/web 下、那支在 repo 根層，跨 package 邊界 import
 * 會讓解析變複雜，重複這幾行更省事。
 */
function buildStamp(): string {
  const run = (cmd: string, fallback: string) => {
    try {
      return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    } catch {
      return fallback
    }
  }
  const sha = run('git rev-parse --short HEAD', 'nogit')
  const dirty = run('git status --porcelain', '') ? '+' : ''
  const t = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const when = `${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}`
  return `${sha}${dirty} · ${when}`
}

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(buildStamp()),
  },
  server: {
    host: '0.0.0.0',
    port: 8894,
    open: false,
  },
})
