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

官方音源插件不打包進前端，而是由後端從 `plugins/` 供應，前端在首次開啟時
從 `/plugins/whymusic.js` 安裝並快取到 localStorage。改音源邏輯只要換掉那個
檔案、在插件頁按「重新載入」即可生效，不必重新 build 前端。

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

### 為什麼不直接用 MusicFree App

- **不用安裝** — 手機、電腦、平板，有瀏覽器就行
- **跨裝置同步** — 伺服器跑起來，任何裝置都能訪問
- **插件一次部署，所有裝置共享** — 不需要每台手機單獨配置

## 快速開始

### 部署

兩種方式，選擇適合你的：

- **Cloudflare Pages（免費，僅 Audiomack）** — 約 5 分鐘，適合想快速體驗的人
- **VPS 自托管（完整功能）** — 需要一臺 Linux 伺服器 + nginx，支援全部音源

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
├── packages/
│   ├── core/                 # 播放器 + 插件管理器
│   └── web/                  # Web 前端 + 後端
│       ├── src/plugins/      # 內置音源插件
│       ├── functions/api/    # Cloudflare Pages Functions
│       └── scripts/server.mjs   # 自托管後端（監聽 :8788）
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