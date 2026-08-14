# MusicFree Web

用瀏覽器聽音樂。不用安裝 App，打開網頁就能搜、能播。

[線上體驗](http://192.168.31.55:8895) · [部署指南](DEPLOY.md)

---

## 這是什麼

基於開源專案 [MusicFree](https://github.com/maotoumao/MusicFree) 的插件系統，做了一個**純 Web 版本**。

簡單說：MusicFree 原本是一個 Android 音樂播放器，靠插件接不同音源。這個項目把它搬到瀏覽器裡，功能一樣——搜尋、播放、歌詞、收藏，全部支援。

### 支援的音源

| 音源 | 狀態 | 說明 |
|------|------|------|
| Audiomack | ✅ 內置 | 歐美音樂為主，無需額外憑證 |
| YouTube | ✅ 內置 | 需自建伺服器才能用 |
| 猫耳FM | ✅ 內置 | 聲劇、配音、動漫 |

> 內置的插件源碼在 `packages/web/src/plugins/bundled/`。也可以自行新增第三方插件。

### 為什麼不直接用 MusicFree App

- **不用安裝**：手機、電腦、平板，有瀏覽器就行
- **跨裝置同步**：伺服器跑起來，哪台裝置都能登入
- **插件一次部署，所有裝置共享**：不需要每台手機單獨配

---

## 快速開始

### 想用一下

訪問 [http://192.168.31.55:8895](http://192.168.31.55:8895)（僅內網可訪問）。

### 想自己跑

有兩條路，選一條：

**5 分鐘版（免費，僅 Audiomack）：** Cloudflare Pages 部署，具體步驟 → [DEPLOY.md 方式一](DEPLOY.md#方式一cloudflare-pages推薦新手)

**完整功能版：** 一臺 VPS + nginx，支援全部音源 → [DEPLOY.md 方式二](DEPLOY.md#方式二vps--自建伺服器完整功能)

---

## 專案結構

```
musicweb/
├── packages/
│   ├── core/                 # 核心：播放器 + 插件管理器
│   └── web/                  # Web 前端 + 後端
│       ├── src/              # React 前端
│       │   └── plugins/bundled/   # 內置音源插件
│       ├── functions/api/    # Cloudflare Pages 後端
│       ├── scripts/
│       │   └── server.mjs    # 自托管伺服器（監聽 :8788）
│       └── wrangler.toml     # Cloudflare 設定
├── .env.example              # 環境變數範本
├── DEPLOY.md                 # 部署指南（詳細步驟）
└── package.json
```

---

## 本地開發

```bash
pnpm install
pnpm dev              # 啟動前端開發伺服器
pnpm build            # 編譯生產版本
pnpm typecheck        # 類型檢查
```

---

## 技術棧

| 層 | 技術 |
|----|------|
| 前端 | React 18 + TypeScript + Tailwind CSS |
| 核心 | MusicFree 插件系統（PluginManager + Player） |
| 自托管後端 | Node.js（`server.mjs`，監聽 `:8788`） |
| 免費部署後端 | Cloudflare Pages Functions |
| 反代 | nginx（TLS + 靜態檔案） |

---

## License

MIT