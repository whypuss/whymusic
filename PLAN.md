# MusicFree Web — Ultra Lite MVP

> 目標：**裝插件 → 搜索 → 播放音樂**，3 天內跑起來
> 砍掉所有"結構糖"，只做能動的核心

---

## 一、項目結構

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
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── index.html
│   └── vite.config.ts
│
├── plugins/
└── package.json
```

---

## 二、核心設計（極簡版）

### 1. Plugin 系統

**只做 2 件事：** `search()` + `getMediaSource()`

```typescript
const pluginFn = new Function("module", "exports", pluginCode)
const module = { exports: {} }
pluginFn(module, module.exports)
return module.exports
```

**❌ 不做：** sandbox、jsdom、webdav injection、白名單 API

---

### 2. Player（最小 HTML5 音頻）

```typescript
class Player {
  audio = new Audio()

  play(url: string) { this.audio.src = url; this.audio.play() }
  pause() { this.audio.pause() }
  on(event, cb) { this.audio.addEventListener(event, cb) }
}
```

**❌ 不做：** Zustand store、WebAudio API、rate system

---

### 3. 狀態管理（零依賴）

**不做 Zustand**，直接：

```typescript
// Player 實例 + event emitter
const player = new Player()
player.on('ended', () => { /* 通知 UI */ })

// UI 直接 subscribe
player.on('play', () => setPlaying(true))
player.on('pause', () => setPlaying(false))
```

---

### 4. Search（最簡模式）

**不單獨做 SearchManager**，UI 層自己 loop：

```typescript
async function searchAll(keyword) {
  const plugins = getEnabledPlugins()
  const results = await Promise.all(plugins.map(p => p.search(keyword)))
  return results.flat()
}
```

---

### 5. Types（最少定義）

```typescript
interface MusicItem {
  id: string
  title: string
  artist: string
  artwork?: string
  platform?: string
}
```

**不做 platform abstraction**，先不要分層。

---

### 6. 存儲（極簡）

**只用 localStorage：**

- `plugins` — 已安裝插件列表
- `enabledPlugins` — 啟用插件名

**不做 IndexedDB**，不做 cache system。

---

## 三、MVP 功能清單

| ✔ 必須有 | ❌ 不做 |
|---|---|
| 插件加載（new Function） | Zustand store |
| 搜索 | SearchManager 層 |
| 播放音樂 | 歌詞顯示 |
| 播放控制（play/pause） | IndexedDB |
| 插件開關 | 歌詞搜索 |
| 插件安裝/卸載 | settings system |

> **核心閉環：能搜 → 能播 → 能換插件**

---

## 四、開發順序（3 天）

### Day 1 — 插件能跑

- [ ] **1.1** 初始化項目
  - [ ] Vite + React + TypeScript
  - [ ] 基礎目錄（core / shared / web）
  - [ ] 一個能跑的空 React App

- [ ] **1.2** shared/types.ts
  - [ ] `MusicItem`（id, title, artist, artwork）
  - [ ] `Plugin`（name, version, search, getMediaSource）

- [ ] **1.3** core/plugin/Plugin.ts
  - [ ] `loadPlugin(code)` — `new Function()` 執行插件
  - [ ] 注入全局 API（axios, crypto-js, cheerio, he, qs, big-integer, nanoid）

- [ ] **1.4** core/plugin/PluginManager.ts
  - [ ] `loadPlugin(code)` — 加載並執行
  - [ ] `getPlugins()` — 返回已加載插件列表
  - [ ] `search(keyword)` — 調用所有插件 search
  - [ ] `savePlugin(code, name)` — localStorage 存插件
  - [ ] `loadSavedPlugins()` — 從 localStorage 恢復

- [ ] **1.5** 驗證
  - [ ] 手動 paste 一個插件 URL → 能加載
  - [ ] 調用 search → 能返回結果

---

### Day 2 — 播放能跑 + UI 列表

- [ ] **2.1** core/player/Player.ts
  - [ ] `play(url)` — audio.src + play
  - [ ] `pause()` / `toggle()`
  - [ ] `on(event, cb)` — event emitter 封裝
  - [ ] `currentTime` / `duration` getter

- [ ] **2.2** core/index.ts 統一導出

- [ ] **2.3** web/src/App.tsx — 搜索頁
  - [ ] 搜索輸入框
  - [ ] 搜索結果列表（歌曲名 + 作者）
  - [ ] 點擊 → 調用 `player.play(url)`（從 plugin.getMediaSource 獲取）
  - [ ] 搜索 loading 狀態

- [ ] **2.4** web/src/components/MusicBar.tsx — 底部播放條
  - [ ] 顯示歌曲信息
  - [ ] 播放/暫停按鈕
  - [ ] 進度條（audio.currentTime / duration）

- [ ] **2.5** 驗證
  - [ ] 搜索歌曲 → 點擊 → 底部播放條出現 → 能播放

---

### Day 3 — 插件管理 + 整合

- [ ] **3.1** web/src/pages/PluginManager.tsx
  - [ ] 顯示已安裝插件列表
  - [ ] 啟用 / 禁用
  - [ ] 從 URL 安裝（input + button）
  - [ ] 從文件安裝（`<input type="file">`）

- [ ] **3.2** App 整合
  - [ ] 路由切換（Search / Plugins）
  - [ ] 側邊欄導航

- [ ] **3.3** 驗證
  - [ ] 安裝插件 → 搜索 → 播放
  - [ ] 啟用/禁用插件 → 搜索結果變化

---

## 五、與前版差異

| 項目 | 前版 | Ultra Lite |
|---|---|---|
| 狀態管理 | Zustand | Event Emitter |
| Search | 單獨層 | UI 直接 loop |
| Types | IMusicItem + IPlugin + ... | MusicItem + Plugin |
| 歌詞 | Day 5 實現 | **不做了** |
| 開發時間 | 5 天 | **3 天** |

---

## 六、下一步

> 不再生成模板，**直接寫代碼**：
>
> 1. 初始化項目
> 2. 寫 plugin runtime（core/plugin/）
> 3. 寫 audio player（core/player/）
> 4. 寫搜索 UI（web/src/App.tsx）
>
> 做到：**`pnpm install && pnpm dev` 就能播歌**
