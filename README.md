# MusicFree Web

一個能用瀏覽器聽音樂的 Web 應用。不用安裝 App，搜尋、播放、看歌詞，跟手機 App 一樣方便。

詳細部署步驟 → [DEPLOY.md](DEPLOY.md)

## 這是什麼

基於開源專案 [MusicFree](https://github.com/maotoumao/MusicFree) 的插件系統，做了一個純 Web 版本。MusicFree 原本是一個 Android 音樂播放器，靠插件連接不同音源；這個項目把它搬到了瀏覽器裡，功能完全一致。

### 支援的音源

| 音源 | 說明 |
|------|------|
| WhyMusic | **主音源**。單一來源，底下聚合三個子音源（見下） |
| 猫耳FM | 聲劇、配音、動漫 |
| YouTube | 搜尋仍可用，但播放已失效（見下） |

WhyMusic 的子音源：

| 子音源 | 覆蓋範圍 | 取得方式 |
|--------|----------|----------|
| `netease` | 簡體華語曲庫最完整，附歌詞與封面 | 經 GD 上游 |
| `joox` | 港台繁體、粵語與 live 版本多 | 經 GD 上游 |
| `audiomack` | 歐美獨立音樂 / hip-hop / afrobeats | 本站 OAuth |

三者並發搜尋後交錯合併、同名同歌手去重，UI 上只呈現為一個「WhyMusic」。
單一子音源取不到音源時（GD 上游偶回空字串、Audiomack 對授權曲目回
`1005 Not authorized`），後端會用歌名+歌手到其餘子音源找同一首歌，
比對時做繁簡歸一化，所以查「浮誇」也能命中簡體源的「浮夸」。

**預設不附音源**：app 出廠不帶任何音源，使用者到「插件」頁自行匯入。內置音源
列在那裡可一鍵安裝（來源是同源的 `/plugins/whymusic.js`，由後端從 repo 的
`plugins/` 供應），也可以貼任意第三方插件 URL。裝過一次就快取到 localStorage，
之後開啟即載入。

改音源邏輯只要換掉 `plugins/whymusic.js`、在插件頁按「更新」即可生效，
不必重新 build 前端。

### 播放器與音源完全分離

前端不直接呼叫任何音源 API。搜尋、推薦、播放、下載、專輯詳情全部經插件介面：

| 功能 | 插件方法 |
|------|----------|
| 搜尋 | `search(query, page, type)` |
| 推薦 | `getRecommend(mode, limit)`（musicweb 擴充，非 MusicFree 標準） |
| 播放 / 下載 | `getMediaSource(item)` |
| 專輯曲目 | `getAlbumInfo(albumItem)` |
| 歌詞 / 封面 | `getLyric` / `getMusicArtwork` |

`play()` 裡沒有任何平台名稱的判斷 —— 它只問音源要一個可播的 URL 然後播。
要不要跨源救援、要不要 OAuth 簽名、音質怎麼選，全是插件（與其後端）的事，
**加新音源不必改前端**。

因此沒裝音源時整個 app 沒有內容：推薦與搜尋都顯示「需要音源」，沒有任何可播
的東西。插件未實作某個方法時回 null，UI 會明確說「此音源不支援」，而不是
顯示空清單讓人以為壞了。

前端剩下的兩個 `/api/` 呼叫都不是音源 API：`/api/proxy`（跨域代抓）與
`/plugins/*.js`（插件安裝），屬基礎設施。

執行時不依賴任何外部託管站：插件與 app 同源。使用者也可以在插件頁貼 URL
安裝第三方插件，外部 URL 會由後端經 `/api/proxy` 代抓（瀏覽器不必連得到
該託管站）。其餘內置插件源碼仍在 `packages/web/src/plugins/bundled/`。

#### 關於 YouTube 音源

YouTube 的 `youtubei/v1/player` 端點現在對所有 client（`ANDROID_MUSIC` / `ANDROID_VR` / `IOS` /
`TVHTML5_*` / `WEB*` / `MWEB`）都要求 PoToken（BotGuard），無憑證請求會回
`LOGIN_REQUIRED`（`Please sign in` 或 `Sign in to confirm you're not a bot`）。
程式碼保留了 YouTube 分支，待日後接上 PoToken 即可恢復，但目前無法取得音源，
因此救援音源改由 WhyMusic 的其餘子音源承擔。

#### WhyMusic 設定

`netease` 與 `joox` 經 [GD 音樂台](https://music.gdstudio.xyz/) 的公開 API 取得，無需憑證；
`audiomack` 走本站自己的 OAuth 實作，用 `AUDIOMACK_*` 那組金鑰。

| 變數 | 預設 | 說明 |
|------|------|------|
| `WHY_MUSIC_SOURCES` | `netease,joox,audiomack` | 啟用的子音源（逗號分隔） |
| `WHY_MUSIC_BITRATE` | `320` | 預設音質（kbps，僅 GD 子音源適用） |
| `GD_API_URL` | `https://music-api.gdstudio.xyz/api.php` | GD 上游 API 位址 |

未納入 `kuwo` 與 `bilibili`：上游的 `kuwo` 音源端點恆回空字串、`bilibili` 回 HTML，
兩者雖能搜到歌但點下去播不出來，列進來只會變成啞彈。後端對 GD 上游回應做 TTL 快取
（上游按 IP 限流，而伺服器所有使用者共用同一出口 IP）。

搜尋類型方面，「歌曲」走三子音源聚合；「專輯」目前只有 `audiomack` 子音源提供
（GD 上游沒有專輯搜尋），專輯內曲目同樣享有跨子音源救援。

### 推薦頁

資料來源是**香港叱咤903專業推介**（商業電台的粵語流行榜，每週更新，1000+ 首）：

- **最新** — 沿用榜單原順序（該榜本身按發行時間降序）
- **熱門** — 按網易雲的 `pop` 熱度降序；同熱度以發行時間新者優先，
  否則前段會擠滿一堆 `pop=100` 而順序無意義

原本用的是「香港電台中文歌曲龍虎榜」，但它最後更新是 2020-01-10、只有 13 首，
「最新」推薦的其實是六年前的歌。網易雲的新歌榜／熱歌榜／飆升榜雖然天天更新，
卻清一色國語內地歌，不是港樂。

### 播放模式

播放器上的按鈕循環切換三種模式，選擇記在 localStorage：

| 圖示 | 模式 | 行為 |
|------|------|------|
| 🔁 | 自動續播（預設） | 專輯內依序播下一首；從推薦／搜尋點的單曲則從同一清單隨機挑一首 |
| 🔂 | 單曲循環 | 用 `audio` 原生 `loop`，重播不必重新解析音源，沒有可聽出來的空隙 |
| ➡️ | 播完即停 | — |

### 為什麼不直接用 MusicFree App

- **不用安裝** — 手機、電腦、平板，有瀏覽器就行
- **跨裝置同步** — 伺服器跑起來，任何裝置都能訪問
- **插件一次部署，所有裝置共享** — 不需要每台手機單獨配置

## 快速開始

### 部署

兩種方式，選擇適合你的：

- **Cloudflare Pages（免費，功能同等）** — 約 5 分鐘，不需要伺服器
- **VPS 自托管** — 需要一臺 Linux 伺服器 + nginx

兩者功能已經對齊：CF Pages Functions（`packages/web/functions/`）把 WhyMusic
的三子源扇出、繁簡歸一化、跨子源救援全部移植過去了，Audiomack 的 OAuth 簽名
改用 Web Crypto（Workers 沒有 `node:crypto`）。CF 版部署指令：

```bash
pnpm build:cf     # build 並把 plugins/ 複製進 dist/（音源插件要當靜態檔供應）
cd packages/web && npx wrangler pages deploy dist --project-name=<你的專案>
```

CF 版的兩點差異：設定值寫在 `functions/_lib/why.js` 的模組常數裡（Workers
沒有 `process.env`）；TTL 快取只在單一 isolate 內有效，不像自托管版全站共用。

具體步驟見 [DEPLOY.md](DEPLOY.md)。

### 本地開發

```bash
pnpm install
pnpm dev              # 啟動前端
pnpm build            # 編譯生產版本
pnpm typecheck        # 類型檢查
```

## 專案結構

```
musicweb/
├── plugins/                  # 音源插件（由後端供應於 /plugins/*.js，部署時要一起上機）
│   └── whymusic.js
├── packages/
│   ├── core/                 # 播放器 + 插件管理器
│   └── web/                  # Web 前端 + 後端
│       ├── src/plugins/      # 其餘內置插件源碼（猫耳FM / YouTube 等）
│       ├── functions/api/    # Cloudflare Pages Functions
│       └── scripts/server.mjs   # 自托管後端（預設 :8788，可用 PORT 覆寫）
├── .env.example
├── DEPLOY.md
└── package.json
```

## 技術棧

| 層 | 技術 |
|----|------|
| 前端 | React 18 + TypeScript + Tailwind CSS |
| 核心 | MusicFree 插件系統（PluginManager + Player） |
| 自托管後端 | Node.js |
| 免費部署後端 | Cloudflare Pages Functions |

## License

MIT