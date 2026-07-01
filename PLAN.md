# MusicFree Web — 項目清單

> 方案 A Lite：Core / Web / Shared 三層分離架構
> 目標：網頁可直接播放音樂，支持插件搜索

---

## 一、項目結構

```
musicfree-web/
├── packages/
│   ├── core/              ← 純 JS 業務邏輯（無 React）
│   │   ├── plugin/        # PluginManager + Plugin 執行
│   │   ├── player/        # WebAudioPlayer（HTML5 Audio 封裝）
│   │   ├── lyric/         # LyricParser（原碼可直接用）
│   │   ├── playlist/      # 播放列表管理
│   │   ├── search/        # 搜索聚合
│   │   ├── cache/         # 音源緩存（IndexedDB）
│   │   ├── config/        # 用戶配置（localStorage）
│   │   └── index.ts       # 統一導出
│   │
│   ├── shared/            ← 共享類型 + 工具
│   │   ├── types/         # IMusicItem, IPluginDefine 等
│   │   ├── utils/         # mediaUtils, lrcParser, minDistance 等
│   │   └── index.ts
│   │
│   └── web/               ← React + Vite + Tailwind
│       ├── src/
│       │   ├── components/ # UI 組件
│       │   ├── pages/      # 頁面
│       │   ├── stores/     # Zustand 狀態
│       │   ├── App.tsx
│       │   └── main.tsx
│       ├── index.html
│       ├── vite.config.ts
│       ├── tailwind.config.js
│       └── package.json
│
├── plugins/               ← 插件目錄（手動放入 .js）
└── package.json           ← monorepo root (pnpm workspace)
```

---

## 二、依賴映射

| RN 原生模塊 | 用途 | Web 替代 |
|---|---|---|
| `react-native-track-player` | 音頻播放 | HTML5 `<audio>` + Web Audio API |
| `react-native-fs` | 文件系統 | IndexedDB (idb-keyval) |
| `react-native-mmkv` | 鍵值存儲 | localStorage / IndexedDB |
| `jotai` | 狀態管理 | Zustand |
| `react-native-device-info` | 設備信息 | navigator API |
| `axios` | HTTP | fetch / axios |
| `cheerio` | HTML 解析 | jsdom |
| `crypto-js` | 加密 | crypto-js（可直接用） |
| `eventemitter3` | 事件 | eventemitter3（可直接用） |
| `immer` | 不可變更新 | immer（可直接用） |
| `nanoid` | ID 生成 | nanoid（可直接用） |

---

## 三、技術選型

| 層 | 技術 | 理由 |
|---|---|---|
| 構建工具 | Vite | 快、HMR、ESM 原生支持 |
| 包管理 | pnpm workspace | monorepo 管理 |
| 狀態管理 | Zustand | 輕量、API 簡單 |
| 路由 | React Router DOM | 標準 Web 路由 |
| UI 框架 | TailwindCSS | 快速開發、自定義主題方便 |
| 圖標 | Lucide React | 開源、風格統一 |
| 存儲 | idb-keyval | IndexedDB 簡單封裝 |
| HTTP | fetch | 原生 API |
| 動畫 | CSS transitions | 足夠用 |

---

## 四、風險與應對

| 風險 | 影響 | 應對 |
|---|---|---|
| 音源 CORS 限制 | 無法播放 | 插件返回的 URL 需要支持 CORS；或提供代理方案 |
| 插件用 cheerio | 瀏覽器不兼容 | 插件運行時注入 jsdom 的 document |
| 插件用 Node API | 無法執行 | 插件沙箱限制，只允許白名單 API |
| 音頻自動播放 | 瀏覽器策略 | 需要用戶交互才能播放；首次播放需點擊 |
| 插件安全性 | 惡意代碼 | 沙箱執行（iframe / Web Worker） |

---

## 五、項目任務清單

### Phase 0：基礎架構（Day 1）

- [ ] **0.1** 初始化 pnpm monorepo
  - [ ] `pnpm init` 創建 root package.json
  - [ ] 配置 pnpm-workspace.yaml
  - [ ] 建立 packages/core/、packages/shared/、packages/web/ 目錄結構

- [ ] **0.2** 配置 TypeScript
  - [ ] root tsconfig.json（monorepo 共享配置）
  - [ ] packages/shared/tsconfig.json
  - [ ] packages/core/tsconfig.json
  - [ ] packages/web/tsconfig.json

- [ ] **0.3** 配置 Vite（web 包）
  - [ ] vite.config.ts（alias 配置，支持 @ 路徑）
  - [ ] index.html
  - [ ] src/main.tsx（React 入口）
  - [ ] src/App.tsx（空殼）

- [ ] **0.4** 配置 TailwindCSS
  - [ ] tailwind.config.js
  - [ ] postcss.config.js
  - [ ] src/index.css（Tailwind directives）

- [ ] **0.5** 安裝基礎依賴
  - [ ] React 18 + TypeScript types
  - [ ] Zustand
  - [ ] React Router DOM
  - [ ] Lucide React
  - [ ] idb-keyval
  - [ ] eventemitter3
  - [ ] immer
  - [ ] nanoid
  - [ ] crypto-js
  - [ ] qs
  - [ ] he
  - [ ] compare-versions
  - [ ] big-integer
  - [ ] deepmerge
  - [ ] object-path
  - [ ] path-browserify
  - [ ] marked
  - [ ] lodash.shuffle
  - [ ] dayjs

---

### Phase 1：Shared 層（Day 1–2）

> 從原 MusicFree 遷移共享代碼，移除 RN 依賴

- [ ] **1.1** 類型定義（packages/shared/types/）
  - [ ] `music.d.ts` — IMusicItem, IMusicItemBase, IMediaSource, IQualityKey
  - [ ] `plugin.d.ts` — IPluginDefine, IPluginInstance, IMediaSourceResult, ISearchResult
  - [ ] `lyric.d.ts` — ILyricSource, IParsedLrcItem
  - [ ] `common.d.ts` — IMediaBase, SupportMediaType, PaginationResponse
  - [ ] `config.d.ts` — IAppConfig
  - [ ] `infra.d.ts` — IInjectable

- [ ] **1.2** 工具函數（packages/shared/utils/）
  - [ ] `mediaUtils.ts` — getMediaUniqueKey, isSameMediaItem, resetMediaItem, getLocalPath
    - 移除 `localPluginPlatform` 依賴（改為常數）
    - 移除 `internalSerializeKey`（改為普通 key）
  - [ ] `lrcParser.ts` — LyricParser 類（原碼可直接用，幾乎不需要改）
  - [ ] `minDistance.ts` — 字符串距離計算（原碼可直接用）
  - [ ] `jsonUtil.ts` — safeParse（原碼可直接用）
  - [ ] `delay.ts` — delay 函數（原碼可直接用）
  - [ ] `mediaExtra.ts` — patchMediaExtra, getMediaExtraProperty
    - 移除 MMKV 依賴，改為接受 store 參數
    - 移除 React hooks（useMediaExtra 等）
  - [ ] `timeformat.ts` — 時間格式化（原碼可直接用）
  - [ ] `qualities.ts` — getQualityOrder（原碼可直接用）
  - [ ] `mediaIndexMap.ts` — createMediaIndexMap（原碼可直接用）
  - [ ] `network.ts` — Network.isCellular, Network.isOffline
    - 改為 navigator.onLine 等 Web API
  - [ ] `base64.ts` — Base64.btoa/decode（原碼可直接用）
  - [ ] `getUrlExt.ts` — 獲取 URL 擴展名（原碼可直接用）
  - [ ] `fileUtils.ts` — addFileScheme, getFileName
    - 移除 RNFS 依賴，改為純字符串操作

- [ ] **1.3** 常數（packages/shared/constants/）
  - [ ] `commonConst.ts` — CacheControl, localPluginPlatform, internalSerializeKey
  - [ ] `repeatModeConst.ts` — MusicRepeatMode（QUEUE/SHUFFLE/SINGLE）

- [ ] **1.4** packages/shared/index.ts 統一導出

---

### Phase 2：Core — 插件系統（Day 2–3）

> 從原 MusicFree 抽離插件系統，替換 RN 依賴

- [ ] **2.1** packages/core/plugin/Plugin.ts
  - [ ] 從 `src/core/pluginManager/plugin.ts` 抽離
  - [ ] 移除 `react-native-fs`（RNFS.exists, RNFS.readFile, RNFS.writeFile）
    - 替換為 IndexedDB 操作（傳入 store 實例）
  - [ ] 移除 `react-native-device-info`（deviceInfoModule.getVersion()）
    - 替換為 `navigator.userAgent` 或硬編碼版本
  - [ ] 移除 `expo-file-system`（readAsStringAsync）
    - 替換為 fetch API
  - [ ] cheerio 注入方式改為接受外部 document 實例
  - [ ] webdav 改為全局注入（CDN 加載）
  - [ ] 插件執行沙箱：`new Function()` 執行插件代碼
  - [ ] 注入全局 API：cheerio, crypto-js, axios, dayjs, big-integer, qs, he, webdav
  - [ ] PluginState 枚舉（Initializing, Loading, Mounted, Error）
  - [ ] PluginErrorReason 枚舉
  - [ ] PluginMethodsWrapper 類（search, getMediaSource, getMusicInfo, getLyric, ...）
  - [ ] getMediaSource 方法改造：
    - 移除 RNFS.exists（替換為 IndexedDB 查詢）
    - 移除 RNFS.readFile（替換為 IndexedDB 讀取）
    - 移除 RNFS.writeFile（替換為 IndexedDB 寫入）
    - 保留 axios 網絡請求
    - 保留 MediaCache 緩存邏輯

- [ ] **2.2** packages/core/plugin/PluginManager.ts
  - [ ] 從 `src/core/pluginManager/index.ts` 抽離
  - [ ] 移除 MMKV 依賴（pluginCacheStore）
    - 替換為 IndexedDB（存儲插件元數據）
  - [ ] 移除 RNFS 依賴（readDir, readFile, writeFile, unlink, copyFile）
    - 替換為 IndexedDB 或 fetch
  - [ ] 移除 expo-file-system（readAsStringAsync）
    - 替換為 fetch API
  - [ ] setup() 方法改造：
    - 不再從文件系統讀取插件
    - 改為從 IndexedDB 加載已安裝插件列表
    - 插件代碼從 URL 加載（fetch）
  - [ ] installPluginFromUrl() 方法：
    - fetch 插件代碼 → 執行 → 存儲到 IndexedDB
  - [ ] installPluginFromLocalFile() 方法：
    - 接受 File 對象 → FileReader 讀取 → 執行 → 存儲
  - [ ] uninstallPlugin() 方法：從 IndexedDB 刪除
  - [ ] getByName(), getByHash(), getEnabledPlugins(), getSortedPlugins()
  - [ ] getSearchablePlugins() — 返回支持搜索的插件列表
  - [ ] 事件系統：order-updated, enabled-updated

- [ ] **2.3** packages/core/plugin/meta.ts
  - [ ] 從 `src/core/pluginManager/meta.ts` 抽離
  - [ ] 移除 MMKV 依賴
  - [ ] 替換為 IndexedDB 存儲插件元數據（order, enabled, userVariables）

- [ ] **2.4** packages/core/plugin/index.ts 統一導出

---

### Phase 3：Core — 音源緩存（Day 3）

- [ ] **3.1** packages/core/cache/MediaCache.ts
  - [ ] 從 `src/core/mediaCache.ts` 抽離
  - [ ] 移除 MMKV 依賴（mediaCacheStore）
    - 替換為 IndexedDB（idb-keyval）
  - [ ] 移除 RNFS 依賴（exists, unlink）
    - 替換為 IndexedDB 操作
  - [ ] getMediaCache() — 從 IndexedDB 讀取音源緩存
  - [ ] setMediaCache() — 寫入 IndexedDB，LRU 淘汰（最多 800 條）
  - [ ] removeMediaCache() — 刪除緩存
  - [ ] clearLocalCaches() — 清理本地歌詞緩存（改為 IndexedDB）

- [ ] **3.2** packages/core/cache/index.ts 統一導出

---

### Phase 4：Core — 配置管理（Day 3）

- [ ] **4.1** packages/core/config/AppConfig.ts
  - [ ] 從 `src/core/appConfig.ts` 抽離
  - [ ] 移除 MMKV 依賴
    - 替換為 localStorage
  - [ ] 移除 RNFS 依賴
  - [ ] getConfig() — 讀取配置
  - [ ] setConfig() — 寫入配置
  - [ ] 默認配置：
    - basic.defaultPlayQuality
    - basic.playQualityOrder
    - basic.autoPlayWhenAppStart
    - basic.useCelluarNetworkPlay
    - basic.lazyLoadPlugin
    - lyric.showStatusBarLyric（Web 版不需要）
    - lyric.autoSearchLyric
    - lyric.showTranslation

- [ ] **4.2** packages/core/config/index.ts 統一導出

---

### Phase 5：Core — WebAudioPlayer（Day 3–4）

> 核心組件：HTML5 Audio 封裝，實現 ITrackPlayer 接口

- [ ] **5.1** packages/core/player/ITrackPlayer.ts
  - [ ] 定義 ITrackPlayer 接口（與原 RN 版一致）
  - [ ] 事件類型定義（PlayEnd, CurrentMusicChanged, ProgressChanged）

- [ ] **5.2** packages/core/player/WebAudioPlayer.ts
  - [ ] 封裝 HTML5 `<audio>` 元素
  - [ ] 實現 ITrackPlayer 接口：
    - [ ] `currentMusic` — 當前播放的歌曲
    - [ ] `previousMusic` — 上一首
    - [ ] `nextMusic` — 下一首
    - [ ] `repeatMode` — 播放模式
    - [ ] `quality` — 當前音質
    - [ ] `playList` — 播放列表
    - [ ] `setupTrackPlayer()` — 初始化，恢復上次狀態
    - [ ] `getMusicIndexInPlayList()` — 獲取歌曲索引
    - [ ] `isInPlayList()` — 判斷是否在播放列表
    - [ ] `getPlayListMusicAt()` — 獲取指定索引的歌曲
    - [ ] `isPlayListEmpty()` — 判斷播放列表是否為空
    - [ ] `addAll()` — 批量添加歌曲
    - [ ] `add()` — 添加單曲
    - [ ] `addNext()` — 添加到下一首位置
    - [ ] `remove()` — 移除歌曲
    - [ ] `isCurrentMusic()` — 判斷是否為當前歌曲
    - [ ] `play()` — 播放指定歌曲
    - [ ] `playWithReplacePlayList()` — 替換播放列表並播放
    - [ ] `pause()` — 暫停
    - [ ] `toggleRepeatMode()` — 切換播放模式
    - [ ] `clearPlayList()` — 清空播放列表
    - [ ] `changeQuality()` — 切換音質
    - [ ] `getProgress()` — 獲取播放進度
    - [ ] `getRate()` — 獲取播放速率
    - [ ] `setRate()` — 設置播放速率
    - [ ] `seekTo()` — 跳轉到指定位置
    - [ ] `skipToNext()` — 下一首
    - [ ] `skipToPrevious()` — 上一首
  - [ ] 事件系統（EventEmitter3）：
    - [ ] `on('playEnd', callback)` — 播放結束
    - [ ] `on('currentMusicChanged', callback)` — 當前歌曲變更
    - [ ] `on('progressChanged', callback)` — 進度變更
  - [ ] 播放模式實現：
    - [ ] QUEUE（列表循環）
    - [ ] SHUFFLE（隨機播放，使用 lodash.shuffle）
    - [ ] SINGLE（單曲循環）
  - [ ] 播放邏輯：
    - [ ] 通過插件獲取真實音源 URL
    - [ ] 設置 audio.src
    - [ ] 處理 CORS（audio.crossOrigin = 'anonymous'）
    - [ ] 處理播放錯誤（自動切換音質重試）
    - [ ] 處理播放結束（自動下一首）
  - [ ] 狀態恢復：
    - [ ] 從 localStorage 讀取上次播放狀態
    - [ ] 恢復播放列表
    - [ ] 恢復播放進度
  - [ ] 播放速率控制（audio.playbackRate）
  - [ ] 音量控制（audio.volume）

- [ ] **5.3** packages/core/player/index.ts 統一導出

---

### Phase 6：Core — 歌詞管理（Day 4）

- [ ] **6.1** packages/core/lyric/LyricManager.ts
  - [ ] 從 `src/core/lyricManager.ts` 抽離
  - [ ] 移除 LyricUtil（狀態欄歌詞 — Web 不需要）
  - [ ] 移除 RNTrackPlayer 事件監聽
    - 改為監聽 WebAudioPlayer 的 progressChanged 事件
  - [ ] 移除 MMKV 依賴
  - [ ] 移除 RNFS 依賴（unlink, writeFile）
    - 替換為 IndexedDB
  - [ ] 保留 LyricParser（原碼可直接用）
  - [ ] 保留 searchSimilarLyric（自動搜索歌詞）
  - [ ] 保留 associateLyric / unassociateLyric（歌詞關聯）
  - [ ] 保留 updateLyricOffset（歌詞偏移）
  - [ ] refreshLyric() 方法改造：
    - 監聽 WebAudioPlayer 的 progressChanged 事件
    - 更新當前歌詞行
    - 更新 UI（通過事件通知）
  - [ ] 事件系統：
    - [ ] `on('lyricUpdated', callback)` — 歌詞更新
    - [ ] `on('currentLyricChanged', callback)` — 當前歌詞行變更

- [ ] **6.2** packages/core/lyric/index.ts 統一導出

---

### Phase 7：Core — 搜索管理（Day 4）

- [ ] **7.1** packages/core/search/SearchManager.ts
  - [ ] 新建（原項目沒有獨立的 SearchManager）
  - [ ] 聚合所有插件的 search 方法
  - [ ] search() 方法：
    - [ ] 接受 query, page, type 參數
    - [ ] 並行調用所有啟用插件的 search 方法
    - [ ] 返回統一的搜索結果格式
    - [ ] 支持取消搜索（AbortController）
  - [ ] searchByPlugin() 方法：
    - [ ] 指定單個插件搜索
  - [ ] 搜索結果去重（基於 getMediaUniqueKey）
  - [ ] 搜索結果排序（按插件順序）

- [ ] **7.2** packages/core/search/index.ts 統一導出

---

### Phase 8：Core — 播放列表管理（Day 4）

- [ ] **8.1** packages/core/playlist/PlaylistManager.ts
  - [ ] 新建（原項目沒有獨立的 PlaylistManager）
  - [ ] 管理本地歌單（非播放隊列）
  - [ ] createSheet() — 創建歌單
  - [ ] deleteSheet() — 刪除歌單
  - [ ] updateSheet() — 更新歌單信息
  - [ ] addMusicToSheet() — 添加歌曲到歌單
  - [ ] removeMusicFromSheet() — 從歌單移除歌曲
  - [ ] getSheetMusicList() — 獲取歌單歌曲列表
  - [ ] getSheets() — 獲取所有歌單
  - [ ] 持久化到 IndexedDB

- [ ] **8.2** packages/core/playlist/index.ts 統一導出

---

### Phase 9：Core — 統一導出（Day 4）

- [ ] **9.1** packages/core/index.ts
  - [ ] 導出 PluginManager, Plugin
  - [ ] 導出 WebAudioPlayer, ITrackPlayer
  - [ ] 導出 LyricManager
  - [ ] 導出 SearchManager
  - [ ] 導出 PlaylistManager
  - [ ] 導出 MediaCache
  - [ ] 導出 AppConfig

---

### Phase 10：Web — 狀態管理（Day 5）

- [ ] **10.1** packages/web/src/stores/usePlayerStore.ts
  - [ ] 封裝 WebAudioPlayer
  - [ ] 狀態：
    - [ ] currentMusic
    - [ ] playList
    - [ ] currentIndex
    - [ ] repeatMode
    - [ ] isPlaying
    - [ ] progress（position, duration）
    - [ ] rate
    - [ ] volume
  - [ ] Actions：
    - [ ] play(), pause(), togglePlay()
    - [ ] next(), previous()
    - [ ] seekTo()
    - [ ] setVolume()
    - [ ] setRate()
    - [ ] toggleRepeatMode()
    - [ ] addMusic(), addAllMusic()
    - [ ] removeMusic()
    - [ ] clearPlayList()
    - [ ] changeQuality()
  - [ ] 訂閱 WebAudioPlayer 事件，更新 Zustand 狀態

- [ ] **10.2** packages/web/src/stores/usePluginStore.ts
  - [ ] 封裝 PluginManager
  - [ ] 狀態：
    - [ ] plugins（插件列表）
    - [ ] loading（加載中）
  - [ ] Actions：
    - [ ] installPluginFromUrl()
    - [ ] installPluginFromFile()
    - [ ] uninstallPlugin()
    - [ ] togglePluginEnabled()
    - [ ] updatePluginOrder()

- [ ] **10.3** packages/web/src/stores/useSearchStore.ts
  - [ ] 封裝 SearchManager
  - [ ] 狀態：
    - [ ] results（搜索結果）
    - [ ] loading（搜索中）
    - [ ] query（搜索關鍵字）
    - [ ] page（頁碼）
  - [ ] Actions：
    - [ ] search()
    - [ ] searchByPlugin()
    - [ ] nextPage()
    - [ ] clearResults()

- [ ] **10.4** packages/web/src/stores/useLyricStore.ts
  - [ ] 封裝 LyricManager
  - [ ] 狀態：
    - [ ] lyrics（歌詞列表）
    - [ ] currentLyric（當前歌詞行）
    - [ ] loading（加載中）
    - [ ] hasTranslation（有翻譯）
  - [ ] 訂閱 LyricManager 事件，更新 Zustand 狀態

- [ ] **10.5** packages/web/src/stores/usePlaylistStore.ts
  - [ ] 封裝 PlaylistManager
  - [ ] 狀態：
    - [ ] sheets（歌單列表）
    - [ ] currentSheet（當前歌單）
  - [ ] Actions：
    - [ ] createSheet()
    - [ ] deleteSheet()
    - [ ] addMusicToSheet()
    - [ ] removeMusicFromSheet()

---

### Phase 11：Web — 路由（Day 5）

- [ ] **11.1** 配置 React Router
  - [ ] `/` — 首頁
  - [ ] `/search` — 搜索頁
  - [ ] `/play` — 播放頁
  - [ ] `/playlist` — 播放列表頁
  - [ ] `/sheets` — 歌單頁
  - [ ] `/settings` — 設置頁
  - [ ] `/plugins` — 插件管理頁

---

### Phase 12：Web — 組件開發（Day 5–6）

- [ ] **12.1** 基礎組件（packages/web/src/components/base/）
  - [ ] Button.tsx — 按鈕組件
  - [ ] Input.tsx — 輸入框組件
  - [ ] Card.tsx — 卡片組件
  - [ ] Modal.tsx — 模態框組件
  - [ ] Toast.tsx — 提示組件
  - [ ] Loading.tsx — 加載組件
  - [ ] Empty.tsx — 空狀態組件

- [ ] **12.2** 音樂組件（packages/web/src/components/music/）
  - [ ] MusicList.tsx — 歌曲列表
  - [ ] MusicItem.tsx — 單曲行（標題、作者、時長、操作）
  - [ ] AlbumCover.tsx — 專輯封面
  - [ ] ProgressBar.tsx — 進度條（可拖拽）
  - [ ] PlayerControls.tsx — 播放控制（上一首、播放/暫停、下一首、模式）
  - [ ] VolumeControl.tsx — 音量控制
  - [ ] SpeedControl.tsx — 播放速度控制
  - [ ] QualitySelector.tsx — 音質選擇器

- [ ] **12.3** 歌詞組件（packages/web/src/components/lyric/）
  - [ ] LyricDisplay.tsx — 歌詞顯示（滾動、高亮當前行）
  - [ ] LyricItem.tsx — 單行歌詞
  - [ ] LyricTranslation.tsx — 翻譯顯示

- [ ] **12.4** 搜索組件（packages/web/src/components/search/）
  - [ ] SearchBar.tsx — 搜索輸入框
  - [ ] SearchResults.tsx — 搜索結果列表
  - [ ] SearchResultTabs.tsx — 搜索類型切換（歌曲、專輯、歌手）
  - [ ] PluginResultPanel.tsx — 單插件結果面板

- [ ] **12.5** 播放列表面板（packages/web/src/components/playlist/）
  - [ ] PlayListPanel.tsx — 播放列表面板（側邊欄）
  - [ ] PlayListItem.tsx — 播放列表單曲
  - [ ] PlayListHeader.tsx — 播放列表頭部

- [ ] **12.6** 底部播放條（packages/web/src/components/player/）
  - [ ] MusicBar.tsx — 全局底部播放條
  - [ ] MusicInfo.tsx — 歌曲信息（封面、標題、作者）
  - [ ] MiniControls.tsx — 迷你控制（播放/暫停、下一首）

---

### Phase 13：Web — 頁面開發（Day 6–7）

- [ ] **13.1** 首頁（packages/web/src/pages/Home/）
  - [ ] 搜索框
  - [ ] 推薦歌單（如果插件支持）
  - [ ] 最近播放
  - [ ] 收藏歌曲快捷入口

- [ ] **13.2** 搜索頁（packages/web/src/pages/Search/）
  - [ ] 搜索輸入框
  - [ ] 搜索類型切換（歌曲、專輯、歌手）
  - [ ] 多插件並行搜索結果
  - [ ] 分頁加載
  - [ ] 點擊歌曲直接播放

- [ ] **13.3** 播放頁（packages/web/src/pages/Player/）
  - [ ] 專輯封面（大圖）
  - [ ] 歌曲信息（標題、作者、專輯）
  - [ ] 播放控制（上一首、播放/暫停、下一首）
  - [ ] 進度條（可拖拽）
  - [ ] 播放模式切換
  - [ ] 音量控制
  - [ ] 播放速度控制
  - [ ] 音質切換
  - [ ] 歌詞顯示（可切換）
  - [ ] 播放列表（可展開）

- [ ] **13.4** 播放列表頁（packages/web/src/pages/PlayList/）
  - [ ] 播放列表歌曲列表
  - [ ] 拖拽排序
  - [ ] 批量操作（刪除、添加到歌單）
  - [ ] 清空播放列表

- [ ] **13.5** 歌單頁（packages/web/src/pages/Sheets/）
  - [ ] 歌單列表
  - [ ] 創建歌單
  - [ ] 歌單詳情
  - [ ] 歌單內歌曲管理

- [ ] **13.6** 插件管理頁（packages/web/src/pages/Plugins/）
  - [ ] 插件列表
  - [ ] 安裝插件（URL / 文件）
  - [ ] 卸載插件
  - [ ] 啟用/禁用插件
  - [ ] 插件排序
  - [ ] 插件信息（名稱、版本、作者、描述）

- [ ] **13.7** 設置頁（packages/web/src/pages/Settings/）
  - [ ] 播放設置（默認音質、自動播放、流量限制）
  - [ ] 歌詞設置（自動搜索、顯示翻譯）
  - [ ] 主題設置（深色/淺色）
  - [ ] 快捷鍵設置
  - [ ] 關於

---

### Phase 14：Web — 全局佈局（Day 7）

- [ ] **14.1** 全局佈局
  - [ ] 頂部導航欄（Logo、搜索、設置）
  - [ ] 側邊欄（導航菜單）
  - [ ] 主內容區
  - [ ] 底部播放條（全局，固定）

- [ ] **14.2** 響應式佈局
  - [ ] 桌面端（≥1024px）
  - [ ] 平板端（768px–1023px）
  - [ ] 手機端（<768px）

---

### Phase 15：聯調測試（Day 7）

- [ ] **15.1** 插件測試
  - [ ] 安裝示例插件
  - [ ] 驗證插件加載成功
  - [ ] 驗證插件搜索功能

- [ ] **15.2** 搜索測試
  - [ ] 輸入關鍵字搜索
  - [ ] 驗證多插件並行搜索
  - [ ] 驗證分頁加載
  - [ ] 驗證搜索結果去重

- [ ] **15.3** 播放測試
  - [ ] 點擊歌曲播放
  - [ ] 驗證音頻加載
  - [ ] 驗證播放/暫停
  - [ ] 驗證上一首/下一首
  - [ ] 驗證播放模式切換
  - [ ] 驗證進度拖拽
  - [ ] 驗證音量控制
  - [ ] 驗證播放速度
  - [ ] 驗證音質切換
  - [ ] 驗證 CORS 處理

- [ ] **15.4** 歌詞測試
  - [ ] 驗證歌詞加載
  - [ ] 驗證歌詞同步
  - [ ] 驗證歌詞滾動
  - [ ] 驗證翻譯顯示
  - [ ] 驗證自動搜索歌詞

- [ ] **15.5** 播放列表測試
  - [ ] 驗證添加歌曲
  - [ ] 驗證移除歌曲
  - [ ] 驗證播放列表順序
  - [ ] 驗證隨機播放

- [ ] **15.6** 狀態恢復測試
  - [ ] 刷新頁面後恢復播放狀態
  - [ ] 恢復播放列表
  - [ ] 恢復播放進度

---

### Phase 16：增強功能（第二階段）

- [ ] **16.1** IndexedDB 持久化
  - [ ] 播放歷史
  - [ ] 收藏歌曲
  - [ ] 本地歌單
  - [ ] 播放進度恢復

- [ ] **16.2** 鍵盤快捷鍵
  - [ ] 空格：播放/暫停
  - [ ] ←/→：快進/快退 5 秒
  - [ ] ↑/↓：音量 ±5%
  - [ ] N：下一首
  - [ ] P：上一首
  - [ ] L：切換播放模式
  - [ ] M：靜音
  - [ ] S：搜索聚焦

- [ ] **16.3** 主題系統
  - [ ] 深色/淺色模式切換
  - [ ] 自定義主題色
  - [ ] 主題持久化

- [ ] **16.4** 插件管理增強
  - [ ] 插件訂閱（自動更新）
  - [ ] 插件用戶變量
  - [ ] 插件替代插件設置

- [ ] **16.5** 音頻緩存
  - [ ] Service Worker 緩存音源
  - [ ] 離線播放支持

---

### Phase 17：進階功能（第三階段，可選）

- [ ] **17.1** PWA
  - [ ] manifest.json
  - [ ] Service Worker
  - [ ] 離線頁面
  - [ ] 安裝提示

- [ ] **17.2** Web Audio API 均衡器
  - [ ] BiquadFilterNode 均衡器
  - [ ] 預設均衡器配置
  - [ ] 自定義均衡器

- [ ] **17.3** 音頻視覺化
  - [ ] AnalyserNode 頻譜分析
  - [ ] 波形圖
  - [ ] 圓形視覺化

- [ ] **17.4** Media Session API
  - [ ] 鎖屏播放控制
  - [ ] 媒體通知
  - [ ] 後台播放

- [ ] **17.5** 桌面通知
  - [ ] 播放錯誤通知
  - [ ] 播放結束通知

- [ ] **17.6** 拖拽排序
  - [ ] 播放列表拖拽排序
  - [ ] 歌單拖拽排序

- [ ] **17.7** 響應式優化
  - [ ] 手機端適配
  - [ ] 觸控手勢（滑動切歌）
  - [ ] 橫屏適配

---

## 六、插件兼容性說明

原 MusicFree 插件是 CommonJS 格式，用 `new Function()` 執行。Web 環境同樣支持，但需要注意：

1. **cheerio**：插件內 `require('cheerio')` 需要替換為 jsdom 的 `document`
2. **fs**：插件內文件操作需要替換為 fetch / IndexedDB
3. **crypto**：`require('crypto-js')` 可以通過全局注入
4. **axios**：插件內 `require('axios')` 可以通過全局注入
5. **webdav**：插件內 `require('webdav')` 可以通過全局注入

**推薦方案**：插件沙箱注入全局 API，讓插件代碼盡量不改動就能運行。

```typescript
const sandboxGlobals = {
  cheerio: jsdom,
  'crypto-js': CryptoJS,
  axios: axios,
  'big-integer': bigInt,
  qs: qs,
  he: he,
  webdav: webdav,
}
```

---

## 七、里程碑

```
Week 1
├── Day 1    Phase 0–1：基礎架構 + Shared 層
├── Day 2–3  Phase 2–4：插件系統 + 緩存 + 配置
├── Day 3–4  Phase 5：WebAudioPlayer
├── Day 4    Phase 6–9：歌詞 + 搜索 + 播放列表 + Core 導出
├── Day 5    Phase 10–11：狀態管理 + 路由
├── Day 5–6  Phase 12：組件開發
├── Day 6–7  Phase 13–14：頁面開發 + 全局佈局
└── Day 7    Phase 15：聯調測試 → 第一版可用

Week 2
└── Phase 16：增強功能（持久化、快捷鍵、主題、插件管理）

Week 3+
└── Phase 17：進階功能（PWA、均衡器、視覺化）
```
