# MusicFree Web

一個能用瀏覽器聽音樂的 Web 應用。不用安裝 App，搜尋、播放、看歌詞，跟手機 App 一樣方便。

詳細部署步驟 → [DEPLOY.md](DEPLOY.md)

## 這是什麼

基於開源專案 [MusicFree](https://github.com/maotoumao/MusicFree) 的插件系統，做了一個純 Web 版本。MusicFree 原本是一個 Android 音樂播放器，靠插件連接不同音源；這個項目把它搬到了瀏覽器裡，功能完全一致。

### 支援的音源

| 音源 | 說明 |
|------|------|
| Audiomack | 歐美音樂為主，無需在瀏覽器端設定憑證 |
| YouTube | 音視頻搜尋，需透過自托管後端代理 |
| 猫耳FM | 聲劇、配音、動漫 |

內置插件源碼位於 `packages/web/src/plugins/bundled/`，也可以自行新增第三方插件。

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