# WhyMusic

用瀏覽器聽歌。搜尋、播放、下載、看專輯，不用裝 App。

部署步驟 → [DEPLOY.md](DEPLOY.md)

## 這是什麼

基於 [MusicFree](https://github.com/maotoumao/MusicFree) 的插件系統做的純 Web 版。
MusicFree 原本是 Android 播放器，靠插件連接不同音源；這個專案把那套插件機制搬到
瀏覽器，並補上一個自己的聚合音源。

**app 出廠不帶任何音源** —— 開啟後要到「音源」頁貼上網址安裝，才能搜尋與播放。
這是刻意的：播放器與音源完全分離（見下）。

## 音源

### WhyMusic（內建，需自行安裝）

對外是一個音源，底下並發扇出到三個子音源後交錯合併、同名同歌手去重：

| 子音源 | 覆蓋範圍 | 取得方式 |
|--------|----------|----------|
| `netease` | 簡體華語曲庫最完整，附歌詞與封面 | 經 [GD 音樂台](https://music.gdstudio.xyz/) 公開 API |
| `joox` | 港台繁體、粵語與 live 版本多 | 同上 |
| `audiomack` | 歐美獨立音樂 / hip-hop / afrobeats | 本站 OAuth 實作 |

**跨子源救援**：單一子源取不到音源時（GD 上游偶回空字串、Audiomack 對授權曲目回
`1005 Not authorized`），後端會用歌名+歌手到其餘子源找同一首歌。比對前做繁簡歸一化，
所以查「浮誇」也能命中簡體源的「浮夸」。

**未納入 `kuwo` 與 `bilibili`**：實測 `kuwo` 的 url 端點恆回空字串、`bilibili` 回 HTML，
兩者搜得到但播不出來，列進去只會變成啞彈。

**YouTube 不能用**：`youtubei/v1/player` 現在對所有 client（`ANDROID_MUSIC` /
`ANDROID_VR` / `IOS` / `TVHTML5_*` / `WEB*` / `MWEB`）都要求 PoToken（BotGuard），
無憑證請求回 `LOGIN_REQUIRED`。程式碼保留了分支，待日後接上即可恢復。
`packages/web/src/plugins/bundled/` 裡的 `youtube.js` 與 `maoerfm.js` 目前不被載入，
只是留著的參考實作。

### 安裝與更新

音源插件不打包進前端，而是由後端從 repo 的 `plugins/` 供應。安裝方式只有一種：
到「音源」頁貼網址。內建音源的網址（`/plugins/whymusic.js`）列在該頁，點一下會填入。

改音源邏輯只要換掉 `plugins/whymusic.js`、重新部署、在「音源」頁重新安裝一次即可，
**不必改前端程式碼**。

第三方 MusicFree 插件也能貼網址安裝。外部網址由後端經 `/api/proxy` 代抓 ——
你的瀏覽器不必連得到那個託管站（`raw.githubusercontent.com` 在部分地區不穩定，
直連會是連狀態碼都拿不到的 `Failed to fetch`）。

## 播放器與音源完全分離

前端不直接呼叫任何音源 API，全部經插件介面：

| 功能 | 插件方法 |
|------|----------|
| 搜尋（歌曲／專輯） | `search(query, page, type)` |
| 推薦 | `getRecommend(mode, limit)` — musicweb 擴充，非 MusicFree 標準 |
| 播放 / 下載 | `getMediaSource(item)` |
| 專輯曲目 | `getAlbumInfo(albumItem)` |
| 歌詞 / 封面 | `getLyric` / `getMusicArtwork` |

`play()` 裡沒有任何平台名稱的判斷 —— 它只問音源要一個可播的 URL 然後播。要不要
跨源救援、要不要 OAuth 簽名、音質怎麼選，全是插件（與其後端）的事，**加新音源
不必改前端**。

因此沒裝音源時整個 app 沒有內容：推薦與搜尋都顯示「需要音源」。插件未實作某個
方法時回 `null`，UI 會明確說「此音源不支援」，而不是顯示空清單讓人以為壞了。

前端剩下的兩個 `/api/` 呼叫都不是音源 API：`/api/proxy`（跨域代抓）與
`/plugins/*.js`（插件安裝），屬基礎設施。

## 推薦頁

資料來源是**香港叱咤903專業推介**（商業電台的粵語流行榜，每週更新，1000+ 首）：

- **最新** — 沿用榜單原順序（該榜本身按發行時間降序）
- **熱門** — 按網易雲的 `pop` 熱度降序；同熱度以發行時間新者優先，否則前段會擠滿
  一堆 `pop=100` 而順序無意義

原本用「香港電台中文歌曲龍虎榜」，但它最後更新是 2020-01-10、只有 13 首，「最新」
推薦的其實是六年前的歌。網易雲的新歌榜／熱歌榜／飆升榜雖然天天更新，卻清一色
國語內地歌，不是港樂。

## 播放模式

播放器上的按鈕循環切換三種模式，選擇記在 localStorage：

| 圖示 | 模式 | 行為 |
|------|------|------|
| 🔁 | 自動續播（預設） | 專輯與搜尋結果**依序**；推薦頁**隨機**（千首榜單依序播會永遠繞在前幾首） |
| 🔂 | 單曲循環 | 用 `audio` 原生 `loop`，重播不必重新解析音源，沒有可聽出來的空隙 |
| ➡️ | 播完即停 | — |

自動續播撞到播不出來的歌會**跳過它繼續**，連續失敗上限 8 首才收手，並說明是
「連續 N 首無可用音源」還是「清單裡沒有其他可播的曲目」。使用者自己點的那首
失敗時仍會彈窗告知 —— 那是他明確選的，不該默默跳走。

## 介面

預設是蘋果平面風的深色 UI（大標題、分段控制、毛玻璃底欄、單一強調色）。
舊版的藍色漸層介面仍在 `packages/web/src/ui/ClassicUI.tsx`，沒有切換按鈕，
需要時可設 `localStorage.setItem('musicfree-ui', 'classic')` 切回去。

兩套 UI 共用同一份 `useMusicApp()` hook，換皮不必動任何音源或播放邏輯。

## 快速開始

### 部署

| | **Cloudflare Pages** | **VPS / 自建** |
|---|---|---|
| 費用 | 免費 | 一臺 VPS |
| 功能 | 完整 | 完整 |
| 設定方式 | 改 `packages/web/worker/why.js` 的常數 | 環境變數 |
| 上游快取 | 只在單一 isolate 內 | 全站共用 |

```bash
pnpm install
pnpm deploy:cf      # 部署到 Cloudflare Pages
```

也可以產出一個 zip 給別人拖進 CF 儀表板（對方不需要裝任何工具）：

```bash
pnpm build:zip      # → dist-cf/musicweb-cf.zip
```

詳細步驟見 [DEPLOY.md](DEPLOY.md)。

### 本地開發

```bash
pnpm install
pnpm dev            # 前端 dev server（API 需另外跑自托管後端）
pnpm build          # 編譯前端
pnpm build:cf       # 編譯 + 打包 _worker.js + 複製 plugins/
pnpm typecheck
```

自托管後端（同時服務前端與 API）：

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
│       │   ├── ui/AppleUI.tsx     # 預設介面
│       │   ├── ui/ClassicUI.tsx   # 舊介面（保留）
│       │   ├── core/              # Player / PluginManager / 插件沙箱
│       │   └── plugins/bundled/   # 未載入的參考實作（youtube / maoerfm / audiomack）
│       ├── worker/                # Cloudflare 版後端
│       │   ├── index.js           # 路由（打包成 dist/_worker.js）
│       │   └── why.js             # WhyMusic 音源邏輯
│       ├── scripts/server.mjs     # 自托管後端（Node）
│       └── public/                # logo / favicon
├── scripts/
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
| CF 後端 | Cloudflare Workers（單一 `_worker.js`，esbuild 打包） |
| 自托管後端 | Node.js（零外部依賴，只用內建模組） |

## License

MIT
