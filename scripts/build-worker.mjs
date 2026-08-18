/**
 * 把 packages/web/worker/ 打包成 packages/web/dist/_worker.js。
 *
 * 為什麼用單一 _worker.js 而不是 Pages Functions 的 functions/ 目錄：
 *   1. Git 自動建置只會在 root_dir 底下找 functions/，而我們的程式在
 *      packages/web/ 之下 —— 位置對不上，Functions 就整包不會被帶上，
 *      所有 /api/* 會落到 SPA fallback 回 index.html（實測踩過）。
 *   2. 儀表板的拖拉／zip 上傳根本不編譯 functions/（官方文件明載），
 *      但兩種方式都支援 _worker.js。
 * 改用 _worker.js 之後，Git 建置、wrangler、zip 上傳三條路走的是同一份程式碼。
 */
import { build } from 'esbuild'
import path from 'node:path'
import fs from 'node:fs'
import { buildStamp } from './build-stamp.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const ENTRY = path.join(ROOT, 'packages/web/worker/index.js')
const OUT = path.join(ROOT, 'packages/web/dist/_worker.js')

if (!fs.existsSync(ENTRY)) {
  console.error(`✘ 找不到 worker 入口：${ENTRY}`)
  process.exit(1)
}

await build({
  entryPoints: [ENTRY],
  outfile: OUT,
  bundle: true,
  format: 'esm',
  target: 'es2022',
  platform: 'neutral',
  // 不 minify：這支 worker 會被別人拿去部署，保留可讀性讓人能檢查它做了什麼
  minify: false,
  legalComments: 'none',
  // 建置戳記編進 worker，供 /api/version 回報。前端也有自己的一份 ——
  // 兩者不一致就表示只部署了一半
  define: { __WORKER_VERSION__: JSON.stringify(buildStamp()) },
})

const kb = (fs.statSync(OUT).size / 1024).toFixed(1)
console.log(`✓ ${path.relative(ROOT, OUT)} (${kb} kB)`)
