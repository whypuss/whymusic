/**
 * 產出可直接拖拉／上傳到 Cloudflare Pages 的 zip。
 *
 * 為什麼包成單一 _worker.js：CF 儀表板的拖拉／zip 上傳**不會編譯 functions/
 * 目錄**（官方文件明載那條路必須用 wrangler），但單一 _worker.js 兩種方式都支援。
 * 所以收到 zip 的人不必安裝任何東西。
 *
 * 這支只做「打包」：產物一律取自 scripts/build-cf.mjs 建好的 packages/web/dist，
 * 自己不再 build 一次。以前它自己跑 esbuild、自己算建置戳記，於是 zip 裡的 worker
 * 戳記和前端對不上，「前後端不一致」的警示就變成誤報。
 *
 * 用法：pnpm build:zip
 * 產出：dist-cf/musicweb-cf.zip
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const ROOT = path.resolve(import.meta.dirname, '..')
const DIST = path.join(ROOT, 'packages/web/dist')
const OUT_DIR = path.join(ROOT, 'dist-cf')
const STAGE = path.join(OUT_DIR, 'musicweb-cf')
const ZIP = path.join(OUT_DIR, 'musicweb-cf.zip')

function fail(msg) {
  console.error(`✘ ${msg}`)
  process.exit(1)
}

for (const f of ['index.html', '_worker.js', 'plugins/whymusic.js']) {
  if (!fs.existsSync(path.join(DIST, f))) {
    fail(`找不到 packages/web/dist/${f} —— 請先跑 pnpm build:cf`)
  }
}

// 1) 把 dist 整包搬進暫存區（前端 + _worker.js + 音源插件）
fs.rmSync(STAGE, { recursive: true, force: true })
fs.mkdirSync(STAGE, { recursive: true })
for (const name of fs.readdirSync(DIST)) {
  fs.cpSync(path.join(DIST, name), path.join(STAGE, name), { recursive: true })
}
console.log('✓ 已複製前端、_worker.js 與音源插件')

// 2) 附一份說明，收到 zip 的人不必回頭翻文件
fs.writeFileSync(path.join(STAGE, 'README.txt'), `WhyMusic Web — Cloudflare Pages 部署包

部署步驟（不需要安裝任何工具）：
  1. 登入 Cloudflare 儀表板 → Workers & Pages → Create → Pages
  2. 選「Upload assets」(Direct Upload)，替專案取個名字
  3. 把這個 zip 整包拖進去（不要解壓縮），或解壓後拖整個資料夾
  4. 部署完成後開啟 <你的專案>.pages.dev

匯入音源（播放器預設不附音源）：
  進站後到「音源」頁，在「從網址安裝」貼上：
      https://<你的專案>.pages.dev/plugins/whymusic.js
  按「安裝」即可搜尋與播放。也可以改貼任何其他相容音源的網址。

檔案說明：
  index.html / assets/     前端
  plugins/whymusic.js      音源插件（自行匯入，播放器本身不綁定它）
  _worker.js               後端 API（已打包，CF 不需要再 build）

注意：
  - 儀表板拖拉上傳單檔上限 25 MiB、檔案數上限 1000，本包遠低於此。
  - 選了 Direct Upload 之後無法改成 Git 連動，要自動部署得另建專案。
  - 音源走公開 API，不需要任何金鑰或環境變數。
  - 「音源」頁底部會顯示前端／後端建置戳記，兩者應一致；不一致代表只部署了一半。
`)

// 3) 打包 zip。zip 內不要有多一層目錄，CF 才認得出根目錄
fs.rmSync(ZIP, { force: true })
execFileSync('zip', ['-r', '-q', ZIP, '.'], { cwd: STAGE })

const size = (fs.statSync(ZIP).size / 1024 / 1024).toFixed(2)
const count = execFileSync('unzip', ['-l', ZIP], { encoding: 'utf8' })
  .trim().split('\n').pop().trim()
console.log(`✓ ${path.relative(ROOT, ZIP)}  (${size} MiB, ${count})`)
