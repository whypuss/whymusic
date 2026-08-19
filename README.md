# WhyMusic

用瀏覽器聽歌。搜尋、播放、收藏、下載，不用裝 App。

部署步驟 → [DEPLOY.md](DEPLOY.md) ｜ 現成的部署包 → [Releases](../../releases)

## 這是什麼

基於 [MusicFree](https://github.com/maotoumao/MusicFree) 的插件系統做的純 Web 版。
MusicFree 原本是 Android 播放器，靠插件連接不同音源；這個專案把那套插件機制搬到
瀏覽器，並補上一個自己的聚合音源。

**app 出廠不帶任何音源** —— 開啟後要到「設置」頁貼上網址安裝，才能搜尋與播放。
這是刻意的：播放器與音源完全分離（見下）。

## 音源

### WhyMusic（內建，需自行安裝）

對外是一個音源，底下並發扇出到兩個子音源後交錯合併、同名同歌手去重：

| 子音源 | 覆蓋範圍 |
|--------|----------|
| `netease` | 簡體華語曲庫最完整，附歌詞與封面 |
| `joox` | 港台繁體、粵語與 live 版本多 |

兩者都經 [GD 音樂台](https://music.gdstudio.xyz/) 的公開 API 取得，**由瀏覽器直連**，
不經本站後端。這樣上游的 IP 限流是各使用者各自計算，而不是全站共用一個出口；
音源也因此不依賴任何特定後端，同一支插件貼到任何一份 musicweb 都能用。

**跨子源救援**：單一子源取不到音源時，會用歌名+歌手到其餘子源找同一首歌。比對前
做繁簡歸一化，所以查「浮誇」也能命中簡體源的「浮夸」。

**播不出來時換子源**：音源給了 URL 但瀏覽器實際播不出來（CDN 對該地區回 403、
容器格式不支援…）時，前端會把該子源排除後請音源換一個再試同一首歌。這種失敗
只有播放端知道 —— 音源那邊只知道「解析成功」。

### 安裝與更新

音源插件不打包進前端，而是由後端從 repo 的 `plugins/` 供應。安裝方式只有一種：
到「設置」頁貼網址。內建音源的網址（`/plugins/whymusic.js`）列在該頁，點一下會填入。

安裝時會把程式碼整份存進瀏覽器的 localStorage，之後執行時不再向外抓 —— 換句話說
**裝完就與 GitHub 無關**。代價是它不會自動更新：改了 `plugins/whymusic.js` 並重新
部署之後，要在「設置」頁重新貼一次網址才會拿到新版。

改音源邏輯不必改前端程式碼。第三方 MusicFree 插件也能貼網址安裝；外部網址由後端
經 `/api/proxy` 代抓，你的瀏覽器不必連得到那個託管站。

## 播放器與音源完全分離

前端不直接呼叫任何音源 API，全部經插件介面：

| 功能 | 插件方法 |
|------|----------|
| 搜尋（歌曲） | `search(query, page, type)` |
| 推薦 | `getRecommend(mode, limit)` — musicweb 擴充，非 MusicFree 標準 |
| 播放 / 下載 | `getMediaSource(item)` |
| 歌詞 / 封面 | `getLyric` / `getMusicArtwork` |

`play()` 裡沒有任何平台名稱的判斷 —— 它只問音源要一個可播的 URL 然後播。要不要
跨源救援、要不要簽名、音質怎麼選，全是插件的事，**加新音源不必改前端**。

因此沒裝音源時整個 app 沒有內容：推薦與搜尋都顯示「需要音源」。插件未實作某個
方法時回 `null`，UI 會明確說「此音源不支援」，而不是顯示空清單讓人以為壞了。

前端剩下的兩個 `/api/` 呼叫都不是音源 API：`/api/proxy`（跨域代抓）與
`/plugins/*.js`（插件安裝），屬基礎設施。

## 收藏與歌單

曲目右邊的心心加入收藏，「收藏」頁列出全部並**依序播放** —— 那是自己一首一首挑
出來的清單，順序有意義。

收藏存在瀏覽器本機（localStorage），所以綁裝置。要搬到別處有兩條路：

**匯出 / 匯入歌單**（「設置」→ 歌單）。匯出成 Markdown：

```markdown
# WhyMusic 收藏

匯出時間：2026-08-19 12:49
共 2 首

1. 月亮代表我 — moon tang
2. 等一等 — The Hertz
```

任何文字編輯器、筆記軟體、聊天視窗都打得開。檔尾另藏一段 HTML 註解裡的 JSON ——
Markdown 算繪時看不見，但匯入本站時能精確還原（含 id 與子音源），不必逐首重新搜尋。

匯入也吃**任何純文字清單**（一行一首「歌名 - 歌手」），會逐首用音源搜尋比對，
找不到的會明確列出來。分隔符接受破折號、連字號、tab 與 `by`，編號和項目符號會自動
剝掉，上限 200 行。

**換裝置同步**（「設置」→ 換裝置）。產生一組 8 碼配對碼，在另一台裝置輸入即可套用
目前安裝的音源，24 小時後自動失效。沒有帳號、沒有 cookie、不存任何個人資料 ——
同步的只是「你選了哪些音源」，音源檔本來就在站上。目前只同步音源，收藏請用上面的
歌單匯出。

配對碼需要後端有儲存：CF 版用 KV，自架版用檔案系統。後端沒有對應儲存時，這一區
會整個隱藏而不是給一個按了必定失敗的按鈕。

## 推薦頁

資料來源是**香港叱咤903專業推介**（商業電台的粵語流行榜，每週更新，1000+ 首）：

- **最新** — 沿用榜單原順序（該榜本身按發行時間降序）
- **熱門** — 按網易雲的 `pop` 熱度降序；同熱度以發行時間新者優先，否則前段會擠滿
  一堆 `pop=100` 而順序無意義

## 播放模式

播放器上的按鈕循環切換三種模式，選擇記在 localStorage：

| 圖示 | 模式 | 行為 |
|------|------|------|
| 🔁 | 自動續播（預設） | 清單**依序**；推薦頁**隨機**（千首榜單依序播會永遠繞在前幾首） |
| 🔂 | 單曲循環 | 用 `audio` 原生 `loop`，重播不必重新解析音源，沒有可聽出來的空隙 |
| ➡️ | 播完即停 | — |

自動續播撞到播不出來的歌會**跳過它繼續**，連續失敗上限 8 首才收手，並說明是
「連續 N 首無可用音源」還是「清單裡沒有其他可播的曲目」。使用者自己點的那首
失敗時仍會彈窗告知 —— 那是他明確選的，不該默默跳走。

## 手機背景播放

播放器用**兩個 audio 元素輪替**：下一首在前台就先載進閒置的那一個，換歌時只對一個
已經播過、已經載好的元素呼叫 `play()`，完全不動 `src`、不碰網路。手機鎖屏時 JS 會
被凍結，而在背景把新的 `src` 塞進 audio 元素會讓音訊工作階段失效 —— 那正是「鎖屏
播到一半就沒聲音」的成因。

同時註冊 MediaSession，鎖定畫面／通知欄／耳機按鈕都能控制，上一首與下一首由系統
轉發，不依賴頁面自己的計時器。

平台差異（實測）：

- **Android** 建議「加到主畫面」裝成應用。部分國產 ROM 只給已安裝的應用完整的鎖屏
  媒體控制待遇；鎖屏看不到控制項時，先檢查該 ROM 的鎖屏通知顯示設定與瀏覽器的
  後台活動權限 —— 那些是系統設定，網頁沒有 API 可以覆寫。
- **iOS 建議直接用 Safari**，不要用桌面應用。iOS 的獨立模式（standalone）對背景音訊
  支援很差，鎖屏會播不下去。因此 iOS 上不會進入獨立模式，「加到主畫面」只會是一個
  開 Safari 的捷徑。

MediaSession 需要 secure context，所以純 HTTP 的部署（例如沒配憑證的 VPS）不會有
鎖屏控制。

## 介面

預設是蘋果平面風的深色 UI（大標題、分段控制、毛玻璃底欄、單一強調色）。
舊版的藍色漸層介面仍在 `packages/web/src/ui/ClassicUI.tsx`，沒有切換按鈕，
需要時可設 `localStorage.setItem('musicfree-ui', 'classic')` 切回去。

兩套 UI 共用同一份 `useMusicApp()` hook，換皮不必動任何音源或播放邏輯。

「設置」頁底部顯示前端與後端各自的建置戳記。兩者應一致 —— 不一致代表只部署了
一半（例如前端上去了但後端沒有），而不是快取問題。

## 快速開始

### 部署

| | **Cloudflare Pages** | **VPS / 自建** |
|---|---|---|
| 費用 | 免費 | 一臺 VPS |
| 功能 | 完整 | 完整（純 HTTP 時沒有鎖屏控制） |
| 配對碼儲存 | KV binding | 檔案系統 |
| 上游快取 | 只在單一 isolate 內 | 全站共用 |

```bash
pnpm install
pnpm deploy:cf      # 部署到 Cloudflare Pages
```

不想裝任何工具的話，[Releases](../../releases) 有現成的 zip，直接拖進 Cloudflare
儀表板就能部署。自己產一份：

```bash
pnpm build:zip      # → dist-cf/musicweb-cf.zip
```

詳細步驟見 [DEPLOY.md](DEPLOY.md)。

### 本地開發

```bash
pnpm install
pnpm dev            # 前端 dev server（API 需另外跑自架後端）
pnpm build          # 編譯前端
pnpm build:cf       # 前端 + _worker.js + plugins/，戳記只算一次傳給兩邊
pnpm typecheck
```

自架後端（同時服務前端與 API）：

```bash
node packages/web/scripts/server.mjs      # 預設 :8788
```

## 專案結構

```
musicweb/
├── plugins/                       # 音源插件（由後端供應於 /plugins/*.js）
│   └── whymusic.js
├── packages/
│   ├── core/                      # 播放器 + 插件管理器（型別與沙箱）
│   └── web/
│       ├── src/
│       │   ├── musicApp.ts        # 所有狀態與行為（兩套 UI 共用）
│       │   ├── App.tsx            # 外殼：取狀態、決定套哪張皮
│       │   ├── main.tsx           # 掛載 + service worker 註冊策略
│       │   ├── ui/AppleUI.tsx     # 預設介面
│       │   ├── ui/ClassicUI.tsx   # 舊介面（保留）
│       │   └── core/              # Player（雙元素）/ PluginManager / 插件沙箱
│       ├── shared/sync.js         # 配對碼規則（兩個後端共用）
│       ├── worker/                # Cloudflare 版後端
│       │   ├── index.js           # 路由（打包成 dist/_worker.js）
│       │   └── why.js             # 音源邏輯（後端側，插件的備援路徑）
│       ├── scripts/server.mjs     # 自架後端（Node，零外部依賴）
│       ├── public/                # logo / favicon / manifest / sw.js
│       └── wrangler.toml          # Pages 設定與 KV binding
├── scripts/
│   ├── build-cf.mjs               # 完整建置（戳記只算一次傳給前端與 worker）
│   ├── build-stamp.mjs            # 建置戳記
│   ├── build-worker.mjs           # 打包 worker → dist/_worker.js
│   └── build-cf-zip.mjs           # 產出可拖拉上傳的 zip
├── .env.example
└── DEPLOY.md
```

## 技術棧

| 層 | 技術 |
|----|------|
| 前端 | React 18 + TypeScript + Tailwind CSS |
| 核心 | MusicFree 插件系統（PluginManager + Player + `new Function` 沙箱） |
| CF 後端 | Cloudflare Workers（單一 `_worker.js`，esbuild 打包）+ KV |
| 自架後端 | Node.js（零外部依賴，只用內建模組） |

## License

MIT
