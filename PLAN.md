# MusicFree Web — A Lite MVP

> 目標：**裝插件 → 搜索 → 播放音樂**，5 天內跑起來
> 不做工程潔癖，不做過早優化，只做能動的核心

---

## 一、最小架構

```
musicfree-web/
├── core/
│   ├── plugin/
│   ├── player/
│   ├── index.ts
│
├── shared/
│   ├── types.ts
│   ├── utils.ts
│
├── web/
│   ├── src/
│   │   ├── pages/
│   │   ├── components/
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── index.html
│   └── vite.config.ts
│
├── plugins/
└── package.json
```

---

## 二、核心設計

### 1. Plugin 系統（最重要）

**只做 4 件事：**

- `search()`
- `getMediaSource()`
- `getLyric()`
- `getArtistMusic()`

**執行方式（簡化）：**

```typescript
const pluginFn = new Function("module", "exports", pluginCode)
const module = { exports: {} }
pluginFn(module, module.exports)
const plugin = module.exports
```

**❌ 不做：** sandbox、jsdom、webdav injection、白名單 API

> 先跑起來再說安全

---

### 2. Player（最小 HTML5 音頻）

```typescript
class Player {
  audio = new Audio()

  play(url: string) {
    this.audio.src = url
    this.audio.play()
  }

  pause() {
    this.audio.pause()
  }
}
```

**❌ 不做：** WebAudio API、equalizer、rate system、complex state machine

---

### 3. 存儲（極簡）

**只用 localStorage，存：**

- plugins（插件列表）
- last song（最後一首）
- playlist（簡單 array）

**❌ 不做：** IndexedDB、LRU cache、media cache system

---

### 4. Search（最簡模式）

```typescript
async function searchAllPlugins(keyword: string) {
  const plugins = getEnabledPlugins()
  const results = await Promise.all(plugins.map(p => p.search(keyword)))
  return results.flat()
}
```

---

### 5. UI（最少頁面）

**只要 3 個頁面：**

| 頁面 | 內容 |
|---|---|
| **① Search** | input + results list + click play |
| **② Player** | song info + play/pause + progress bar |
| **③ Plugin** | install plugin (paste / file) + enable / disable |

---

## 三、最小功能清單（MVP）

### ✔ 必須有

- [x] 插件加載（JS）
- [x] 搜索
- [x] 點擊播放
- [x] 播放控制（play/pause）
- [x] 插件開關

### ❌ 不做

- playlist manager（正式版才做）
- lyric sync（先只顯示）
- download
- cache system
- settings system
- theme system
- PWA
- keyboard shortcuts

---

## 四、開發順序

### Day 1 — 插件能跑

- [ ] **1.1** 初始化項目
  - [ ] Vite + React + TypeScript
  - [ ] pnpm workspace（core / shared / web）
  - [ ] 基礎文件結構

- [ ] **1.2** shared/types.ts
  - [ ] 定義 `IMusicItem`（id, platform, title, artist, artwork）
  - [ ] 定義 `IPlugin`（platform, version, search, getMediaSource）

- [ ] **1.3** core/plugin/Plugin.ts
  - [ ] `new Function()` 執行插件代碼
  - [ ] 注入全局 API（axios, crypto-js, cheerio, he, qs, big-integer, nanoid）
  - [ ] 測試：手動執行一個插件 JS，確認能返回 plugin 對象

- [ ] **1.4** core/plugin/PluginManager.ts
  - [ ] `loadPlugin(code)` — 加載插件代碼
  - [ ] `getPlugin(name)` — 獲取插件
  - [ ] `search(keyword)` — 調用所有插件的 search
  - [ ] localStorage 存插件列表

- [ ] **1.5** 驗證：手動 paste 一個插件 URL，能加載，能搜索

---

### Day 2 — 播放能跑

- [ ] **2.1** core/player/Player.ts
  - [ ] `play(url)` — 設置 audio.src + play
  - [ ] `pause()`
  - [ ] `onEnded` 事件（播放完畢通知）
  - [ ] `currentTime` / `duration` getter

- [ ] **2.2** core/player/PlayerStore.ts（Zustand）
  - [ ] `currentSong` — 當前歌曲
  - [ ] `isPlaying` — 播放狀態
  - [ ] `progress` — 播放進度
  - [ ] `play(song)` — 播放歌曲（調用 plugin.getMediaSource 獲取 URL）
  - [ ] `pause()` / `togglePlay()`

- [ ] **2.3** core/index.ts 統一導出

- [ ] **2.4** 驗證：手動傳一個音頻 URL，能播放

---

### Day 3 — UI 能跑

- [ ] **3.1** web/src/pages/Search.tsx
  - [ ] 搜索輸入框
  - [ ] 搜索結果列表（歌曲名、作者、封面）
  - [ ] 點擊歌曲 → 調用 `playerStore.play(song)`
  - [ ] 顯示搜索中 loading

- [ ] **3.2** web/src/components/MusicBar.tsx（底部播放條）
  - [ ] 顯示歌曲信息（封面、標題、作者）
  - [ ] 播放/暫停按鈕
  - [ ] 進度條（可拖拽）

- [ ] **3.3** web/src/App.tsx
  - [ ] 路由配置（React Router DOM）
  - [ ] Search 頁為首頁
  - [ ] MusicBar 全局固定底部

- [ ] **3.4** 驗證：搜索歌曲 → 點擊 → 底部播放條出現 → 能播放

---

### Day 4 — 插件管理

- [ ] **4.1** web/src/pages/PluginManager.tsx
  - [ ] 顯示已安裝插件列表
  - [ ] 啟用 / 禁用插件
  - [ ] 從 URL 安裝插件（輸入框 + 加載）
  - [ ] 從文件安裝插件（`<input type="file">`）

- [ ] **4.2** 整合 PluginManager 到 App
  - [ ] 側邊欄導航（Search / Plugins）
  - [ ] 插件狀態同步到搜索（啟用插件才顯示結果）

- [ ] **4.3** 驗證：安裝插件 → 搜索 → 播放

---

### Day 5 — 收尾

- [ ] **5.1** Bug fix
  - [ ] 插件加載失敗處理（try/catch）
  - [ ] 搜索無結果處理（空狀態）
  - [ ] 播放錯誤處理（音源失效）

- [ ] **5.2** 歌詞顯示（最簡版）
  - [ ] `getLyric()` 獲取歌詞文本
  - [ ] Player 頁顯示歌詞（不滾動、不同步）

- [ ] **5.3** Demo 驗證
  - [ ] 安裝官方示例插件
  - [ ] 搜索一首歌
  - [ ] 播放
  - [ ] 切歌
  - [ ] 安裝/卸載插件

---

## 五、與原 PLAN 的差異

| 項目 | 原 PLAN | A Lite MVP |
|---|---|---|
| core 模塊 | 6–8 個 | 2 個 |
| phase | 17 個 | 5 個 |
| storage | IndexedDB | localStorage |
| player | WebAudio + 封裝 | HTML5 Audio |
| plugin system | sandbox | direct eval |
| playlist | full system | none |
| 可跑性 | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| 開發速度 | ⭐⭐ | ⭐⭐⭐⭐⭐ |

---

## 六、定位

> 原 PLAN 是「做產品」
> 這個版本是「先讓它活起來」

---

## 七、下一步

> 直接幫你生成：
>
> - 完整 monorepo 初始化模板
> - plugin runtime（可直接跑 MusicFree 插件）
> - 最小 React UI（可播放）
>
> 做到：**clone 下來直接 `npm install` + `npm run dev` 就能播歌**
