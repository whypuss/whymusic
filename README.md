<div align="center">

# 🎵 WhyMusic

**極簡、現代、純瀏覽器運行的無損串流音樂播放器**  
無需安裝 App，即開即用。搜尋、播放、收藏、下載、歌單同步一站式體驗。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=black)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-CSS-38B2AC?style=flat-square&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![Cloudflare Pages](https://img.shields.io/badge/Deploy-Cloudflare%20Pages-F38020?style=flat-square&logo=cloudflare&logoColor=white)](https://pages.cloudflare.com/)
[![PWA Ready](https://img.shields.io/badge/PWA-Ready-5A0FC8?style=flat-square&logo=pwa&logoColor=white)](https://web.dev/progressive-web-apps/)

[繁體中文](README.md) • [English](README_EN.md) • [简体中文](README_ZH.md) • [日本語](README_JA.md)

</div>

---

## 🌟 這是什麼？

**WhyMusic** 是一個直接運行於現代瀏覽器中的高性能音樂播放器。本專案核心理念是**「播放器核心與音源架構徹底解耦」**：

- **出廠純淨零音源（Zero Built-in Sources）**：專案本身不攜帶、不託管、不提供任何版權音訊檔案或第三方音源接口。前端不認識任何音樂平台，僅透過一層標準化插件介面詢問：「請給我一個可播放的 URL」。
- **極致安全微沙箱（Micro Sandbox）**：使用者自行提供的插件為標準 CommonJS 規範，於瀏覽器端受控的 `new Function` 沙箱中隔離運行。沙箱嚴格限制權限（僅開放 `fetch`、定時器、`URL`、`btoa/atob` 與 `console`），徹底阻斷對 `window`、`document` 與敏感儲存區的直接存取。
- **手機背景持久播放（Dual-Audio Buffering）**：獨創**雙 Audio 元素雙緩衝輪替機制**，徹底攻克 iOS Safari 與 Android 瀏覽器在後台/鎖定畫面切換 URL 時 Session 被中斷暫停的頑疾。

---

## ✨ 核心亮點

### 1. 雙 Audio 元素無縫輪替（攻克鎖屏斷播）
- 瀏覽器在背景切換音訊 `src` 會導致音訊工作階段失效，這正是手機鎖屏播放容易斷音的元兇。
- WhyMusic 在前台預先將下一首歌載入閒置的 Audio 元素，切換曲目時直接觸發已就緒元素的 `play()`，不中斷網路與音訊通道。
- 完整介接系統級 **MediaSession API**：鎖定畫面、控制中心、下拉通知列、耳機線控（上一首/下一首/暫停/播放/快進）全功能支援，並動態呈現高畫質專輯封面與即時歌詞。

### 2. 跨子源自動救援與繁簡智慧歸一化
- 插件支援並發扇出與多子源聚合，同名同歌手智慧去重。
- **繁簡歸一化**：搜尋時自動轉化，查詢繁體「浮誇」能無縫匹配簡體源「浮夸」。
- **動態播放救援**：當某一子源給出的 URL 在特定地區被 CDN 403 阻擋或格式不支援時，播放器會自動將該子源標記並回退重試其他可用子源。

### 3. Apple 現代質感 UI
- 預設採用簡約克制的 Apple 深色質感介面：大字級標題、精緻半透明毛玻璃底欄（Frosted Glass Dock）、浮動播放卡片與流暢轉場。
- 支援動態歌詞（點擊封面展開全螢幕歌詞滾動）。

### 4. 歌單管理與無帳號換機同步
- **無依賴 Markdown 匯入/匯出**：歌單可一鍵匯出為通用的 Markdown 文本，任何文字編輯器均可閱讀；尾端內嵌隱藏版 JSON 標記，在任何 WhyMusic 實例重新匯入即可 100% 精準還原歌曲 ID 與指定子源。
- **純文字清單辨識**：支援貼上任意「歌名 - 歌手」純文字清單（上限 200 首），系統自動解析比對。
- **無帳號 8 碼換機配對**：產生 24 小時有效配對碼，另一台裝置輸入即可自動同步已安裝的音源插件，不儲存任何使用者個人隱私。

### 5. 唯讀 WebDAV 串流門面
- 內建符合 RFC 4918 規範的唯讀 WebDAV 服務（`/dav`）。
- 可直接掛載至 iOS 原生播放器（如 **Everplay**、**Evermusic**），將線上曲庫與推薦榜單模擬為本地音樂資料夾與 `.lrc` 歌詞外掛，即使在無瀏覽器環境也能享受串流。

---

## 🏗️ 技術架構

```
whymusic/
├── packages/
│   └── web/
│       ├── src/
│       │   ├── musicApp.ts        # 全域狀態機與核心播放邏輯
│       │   ├── App.tsx            # 主外殼與響應式介面路由
│       │   ├── ui/AppleUI.tsx     # 預設 Apple 現代磨砂深色介面
│       │   └── core/              # DualPlayer 播放器 / PluginManager 插件沙箱
│       ├── worker/                # Cloudflare Pages Functions 後端
│       │   └── index.js           # 路由分發與跨域代理 (/api/proxy)
│       ├── scripts/server.mjs     # 私有 VPS 專用 Node.js 伺服器 (零外部依賴)
│       └── wrangler.toml          # Cloudflare Pages 與 KV Binding 配置
├── scripts/                       # 跨端構建與打包自動化腳本
├── capacitor.config.json          # Android 原生容器設定
└── DEPLOY.md                      # 完整部署指南
```

### 技術棧一覽

| 維度 | 選型 | 特性 |
| :--- | :--- | :--- |
| **前端應用** | React 18 + TypeScript + Vite | 毫秒級極速渲染、嚴格型別校驗 |
| **樣式架構** | Tailwind CSS + Lucide Icons | 現代深色主題、流暢毛玻璃質感、全螢幕自適應 |
| **微伺服器** | Cloudflare Pages / Workers | 全球 Anycast CDN 低延遲分發、完全免費部署 |
| **私有部署** | Node.js 原生服務器 | 零外部 npm 生產依賴，單檔啟動 |
| **跨端支援** | PWA + Capacitor (Android) | 支援加到主畫面與原生 APK 打包 |

---

## 🚀 快速開始

### 部署途徑一：Cloudflare Pages（推薦，完全免費）

1. **安裝依賴並登入**：
   ```bash
   npm install -g pnpm wrangler
   git clone https://github.com/whypuss/whymusic.git
   cd whymusic
   pnpm install
   wrangler login
   ```

2. **一鍵構建並部署**：
   ```bash
   pnpm deploy:cf
   ```

> 💡 **免工具直接上傳**：至專案 [Releases](../../releases) 下載現成的 `musicweb-cf.zip`，在 Cloudflare Pages 儀表板拖拉上傳即可。

### 部署途徑二：Linux VPS / Docker 私有化自建

```bash
# 啟動自託管原生服務（同時服務前端靜態頁與 /api 代理，預設端口 8788）
node packages/web/scripts/server.mjs
```

完整部署環境（含 Nginx 反向代理、Systemd 服務註冊與 WebDAV 配置）請參閱 [DEPLOY.md](DEPLOY.md)。

---

## 🧩 音源插件規範

本播放器出廠不隨附音源。使用者部署後，需至 **「設置」** 介面黏貼相容的 CommonJS 音源插件網址。插件核心介面定義如下：

```javascript
module.exports = {
  platform: "自訂音源名稱",
  version: "1.0.0",
  // 1. 搜尋能力
  async search(query, page, type) {
    // 返回 { isEnd: boolean, data: TrackItem[] }
  },
  // 2. 獲取音訊串流網址
  async getMediaSource(musicItem, quality) {
    // 返回 { url: "https://..." }
  },
  // 3. 獲取歌詞與封面 (可選)
  async getLyric(musicItem) { /* 返回 { rawLrc: string } */ },
  async getMusicArtwork(musicItem) { /* 返回 { artwork: string } */ }
};
```

---

## 📱 移動端使用建議

- **iOS 用戶**：強烈建議直接使用 **Safari** 瀏覽器聆聽，點擊分享按鈕「加入主畫面」作為快捷方式。請勿開啟獨立全螢幕 standalone 模式（iOS 系統對 standalone 模式後台音訊保活限制極為嚴格）。
- **Android 用戶**：建議在 Chrome / Edge 中點擊「安裝應用程式」或「加到主畫面」為 PWA 獨立應用，並確保授予該應用「允許後台活動」與「鎖定螢幕通知」權限。

---

## 📄 開源授權

本專案依據 [MIT License](LICENSE) 條款開源發布。  
由 [@whypuss](https://github.com/whypuss) 獨立構思、架構設計並維護。
