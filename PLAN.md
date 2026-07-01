# MusicFree Web — Ultra Lite MVP

> 目標：**裝插件 → 搜索 → 播放音樂**，3 天內跑起來
> 砍掉所有「結構糖」，只做能動的核心

---

## 一、核心設計

### 1. Plugin 系統（只做 2 件事）

```typescript
const pluginFn = new Function("module", "exports", pluginCode)
const module = { exports: {} }
pluginFn(module, module.exports)
return module.exports
```

**❌ 不做：** sandbox、jsdom、webdav injection、白名單 API

### 2. Player（最小 HTML5 音頻）

```typescript
class Player {
  audio = new Audio()
  play(url) { this.audio.src = url; this.audio.play() }
  pause() { this.audio.pause() }
  on(event, cb) { this.audio.addEventListener(event, cb) }
}
```

**❌ 不做：** Zustand store、WebAudio API

### 3. 狀態管理（零依賴）

**不做 Zustand**，UI 直接 subscribe：

```typescript
const player = new Player()
player.on('play', () => setPlaying(true))
player.on('pause', () => setPlaying(false))
```

### 4. Search（最簡模式）

**不單獨做 SearchManager**，UI 層直接 loop：

```typescript
const results = await Promise.all(plugins.map(p => p.search(keyword)))
```

### 5. Types（最少定義）

```typescript
interface MusicItem {
  id: string
  title: string
  artist: string
  artwork?: string
}
```

### 6. 存儲

**只用 localStorage**，存 plugins 和 enabledPlugins。

---

## 二、開發順序（3 天）

### Day 1 — 插件能跑

- [ ] 初始化項目（Vite + React + TypeScript）
- [ ] `shared/types.ts` — MusicItem, Plugin
- [ ] `core/plugin/Plugin.ts` — `new Function()` 執行插件
- [ ] `core/plugin/PluginManager.ts` — loadPlugin, search, localStorage
- [ ] 驗證：paste 插件 URL → 能加載 → 能搜索

### Day 2 — 播放能跑 + UI 列表

- [ ] `core/player/Player.ts` — audio.src + play + event emitter
- [ ] `web/src/App.tsx` — 搜索頁（input + results list）
- [ ] `web/src/components/MusicBar.tsx` — 底部播放條
- [ ] 驗證：搜索歌曲 → 點擊 → 播放

### Day 3 — 插件管理 + 整合

- [ ] `web/src/pages/PluginManager.tsx` — 安裝/啟用/禁用
- [ ] 路由切換（Search / Plugins）
- [ ] 驗證：安裝插件 → 搜索 → 播放

---

## 三、與前版差異

| 項目 | 前版 | Ultra Lite |
|---|---|---|
| 狀態管理 | Zustand | Event Emitter |
| Search | 單獨層 | UI 直接 loop |
| Types | 多層定義 | MusicItem + Plugin |
| 歌詞 | Day 5 實現 | **不做了** |
| 開發時間 | 5 天 | **3 天** |

---

## 四、下一步

> 直接寫代碼，做到 `pnpm install && pnpm dev` 就能播歌。
