/**
 * Cloudflare 版的完整建置：前端 → worker → 音源插件。
 *
 * 為什麼要一支腳本而不是串 npm script：建置戳記必須**只算一次**再傳給前端與
 * worker。原本兩邊各自算，結果不一致 —— Vite 5 載入 TS 設定檔時會在
 * vite.config.ts 旁邊寫一個 vite.config.ts.timestamp-*.mjs 臨時檔，那個檔沒被
 * gitignore，所以前端算戳記的那一瞬間 `git status` 是髒的、多了個 `+`，而 worker
 * 是在那之後才算、看到的是乾淨的工作區。兩個戳記就差了一個字元，UI 於是誤報
 * 「只部署了一半」。
 *
 * 現在戳記在這裡算好，透過 BUILD_STAMP 環境變數傳下去，兩邊必然一致 ——
 * 不一致就真的代表只部署了一半，那個警示才有意義。
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { buildStamp } from './build-stamp.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const DIST = path.join(ROOT, 'packages/web/dist')

const stamp = buildStamp()
const env = { ...process.env, BUILD_STAMP: stamp }
const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd: cwd || ROOT, env, stdio: 'inherit' })

console.log(`▸ 建置戳記：${stamp}`)

// 1) 前端（vite 會讀 BUILD_STAMP）
run('pnpm', ['--filter', '@whymusic/web', 'build'])

// 2) worker → dist/_worker.js（同樣讀 BUILD_STAMP）
run('node', [path.join(ROOT, 'scripts/build-worker.mjs')])

// 3) 音源插件當靜態檔供應
const pluginsDst = path.join(DIST, 'plugins')
fs.mkdirSync(pluginsDst, { recursive: true })
for (const name of fs.readdirSync(path.join(ROOT, 'plugins'))) {
  if (name.endsWith('.js')) {
    fs.copyFileSync(path.join(ROOT, 'plugins', name), path.join(pluginsDst, name))
  }
}
console.log('✓ 已複製音源插件')

// 4) 驗證產物齊全 —— 少了任何一項在線上都是難查的故障
const required = ['index.html', '_worker.js', 'plugins/whymusic.js']
const missing = required.filter(f => !fs.existsSync(path.join(DIST, f)))
if (missing.length > 0) {
  console.error(`✘ 產物缺少：${missing.join(', ')}`)
  process.exit(1)
}

// 5) 確認兩邊的戳記真的一致（這是 UI 那個警示的前提）
const workerJs = fs.readFileSync(path.join(DIST, '_worker.js'), 'utf8')
const frontendJs = fs.readdirSync(path.join(DIST, 'assets'))
  .filter(f => f.endsWith('.js'))
  .map(f => fs.readFileSync(path.join(DIST, 'assets', f), 'utf8'))
  .join('')
// 檔案裡的 · 可能被轉義成 \xB7，故只比對 sha 與時間部分
const key = stamp.replace(' · ', '')
const norm = (s) => s.replace(/\\xB7/g, '·').replace(/ · /g, '')
if (!norm(workerJs).includes(key) || !norm(frontendJs).includes(key)) {
  console.error(`✘ 戳記未正確注入（worker 或前端找不到 ${stamp}）`)
  process.exit(1)
}
console.log(`✓ 前端與 worker 戳記一致：${stamp}`)
