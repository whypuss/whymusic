/**
 * 產出可直接拖拉／上傳到 Cloudflare Pages 的 zip。
 *
 * 為什麼要打包成單一 _worker.js：CF 儀表板的拖拉／zip 上傳**不會編譯
 * functions/ 目錄**（官方文件明載那條路必須用 wrangler），但單一 _worker.js
 * 兩種方式都支援。所以這個腳本把 functions/_worker-entry.js 連同它 import 的
 * _lib/why.js 一起打包成 dist/_worker.js，讓收到 zip 的人不必安裝任何東西。
 *
 * 用法：pnpm build:zip
 * 產出：dist-cf/musicweb-cf.zip
 */
import { build } from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { buildStamp } from './build-stamp.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const WEB = path.join(ROOT, 'packages/web')
const DIST = path.join(WEB, 'dist')
const OUT_DIR = path.join(ROOT, 'dist-cf')
const STAGE = path.join(OUT_DIR, 'musicweb-cf')
const ZIP = path.join(OUT_DIR, 'musicweb-cf.zip')

function fail(msg) {
  console.error(`✘ ${msg}`)
  process.exit(1)
}

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  fail('找不到 packages/web/dist/index.html —— 請先跑 pnpm build')
}

// 1) 打包 worker
await build({
  entryPoints: [path.join(WEB, 'worker/index.js')],
  outfile: path.join(STAGE, '_worker.js'),
  bundle: true,
  format: 'esm',
  target: 'es2022',
  platform: 'neutral',
  // Workers 不需要 minify 也在限制內，保留可讀性方便別人檢查這支 worker 做了什麼
  minify: false,
  legalComments: 'none',
  define: { __WORKER_VERSION__: JSON.stringify(buildStamp()) },
})
console.log('✓ 已打包 _worker.js')

// 2) 複製靜態資源（前端 + 音源插件）
fs.rmSync(path.join(STAGE, 'assets'), { recursive: true, force: true })
for (const name of fs.readdirSync(DIST)) {
  fs.cpSync(path.join(DIST, name), path.join(STAGE, name), { recursive: true })
}
// 音源插件必須當靜態檔供應（前端從 /plugins/whymusic.js 安裝）
const pluginsSrc = path.join(ROOT, 'plugins')
const pluginsDst = path.join(STAGE, 'plugins')
fs.mkdirSync(pluginsDst, { recursive: true })
for (const name of fs.readdirSync(pluginsSrc)) {
  if (name.endsWith('.js')) fs.cpSync(path.join(pluginsSrc, name), path.join(pluginsDst, name))
}
console.log('✓ 已複製靜態資源與音源插件')

// 3) 附一份說明，收到 zip 的人不必回頭翻文件
fs.writeFileSync(path.join(STAGE, 'README.txt'), `MusicFree Web — Cloudflare Pages 部署包

部署步驟（不需要安裝任何工具）：
  1. 登入 Cloudflare 儀表板 → Workers & Pages → Create → Pages
  2. 選「Upload assets」(Direct Upload)，替專案取個名字
  3. 把這個 zip 整包拖進去（不要解壓縮），或解壓後拖整個資料夾
  4. 部署完成後開啟 <你的專案>.pages.dev
  5. 進站後到「插件」頁按「安裝」把音源裝上，才能搜尋

檔案說明：
  index.html / assets/     前端
  plugins/whymusic.js      音源插件（進站後自行安裝）
  _worker.js               後端 API（已打包，CF 不需要再 build）

注意：
  - 儀表板拖拉上傳單檔上限 25 MiB、檔案數上限 1000，本包遠低於此。
  - 選了 Direct Upload 之後無法改成 Git 連動，要自動部署得另建專案。
  - 音源走公開 API，不需要任何金鑰或環境變數。
`)

// 4) 打包 zip。zip 內不要有多一層目錄，CF 才認得出根目錄
fs.rmSync(ZIP, { force: true })
execFileSync('zip', ['-r', '-q', ZIP, '.'], { cwd: STAGE })

const size = (fs.statSync(ZIP).size / 1024 / 1024).toFixed(2)
const count = execFileSync('unzip', ['-l', ZIP], { encoding: 'utf8' })
  .trim().split('\n').pop().trim()
console.log(`✓ ${path.relative(ROOT, ZIP)}  (${size} MiB, ${count})`)
