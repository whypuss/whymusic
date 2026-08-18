import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Player, PluginManager, MusicItem, SearchType } from './core'

const player = new Player()
export const pluginManager = new PluginManager()

/**
 * 官方音源插件：不打包進 app，改由 URL 安裝，但那個 URL 是**本站自己的**
 * /plugins/whymusic.js（後端從 repo 的 plugins/ 直接供應）。
 *
 * 為什麼不是 GitHub raw：執行時不該依賴 GitHub。先前指向 raw.githubusercontent.com
 * 造成兩個實際故障 —— 使用者網路連不到 GitHub 時整站沒有音源（瀏覽器層
 * Failed to fetch），以及 GitHub 的 max-age=300 CDN 快取讓「重新載入」抓回舊碼。
 * 改成同源後兩者都不存在，也不必再經 /api/proxy 繞道。
 * GitHub 仍是這支插件在版控裡的位置，但只在部署時參與，不在執行時。
 *
 * 插件呼叫本站後端的 /api/why-* 端點（子音源扇出、OAuth 簽名、跨源救援都在
 * 後端），所以它只能配 musicweb 使用，貼到別的 MusicFree 客戶端不會動。
 */
export const OFFICIAL_PLUGIN_NAME = 'WhyMusic'
export const OFFICIAL_PLUGIN_URL = '/plugins/whymusic.js'

const STORAGE_CODES = 'musicfree-plugin-codes'
const STORAGE_PLUGINS = 'musicfree-plugins'
const STORAGE_PLAY_MODE = 'musicfree-play-mode'

export type PlayMode = 'auto' | 'one' | 'off'
const PLAY_MODE_ORDER: PlayMode[] = ['auto', 'one', 'off']
export const PLAY_MODE_ICON: Record<PlayMode, string> = { auto: '🔁', one: '🔂', off: '➡️' }
export const PLAY_MODE_LABEL: Record<PlayMode, string> = {
  auto: '自動續播（清單依序，推薦頁隨機）',
  one: '單曲循環',
  off: '播完即停',
}

/**
 * 播放佇列：這首歌來自哪個清單、在第幾位、播完要依序還是隨機。
 *
 * order 由呼叫端決定而非猜測：專輯與搜尋結果依序（使用者看到的順序就是
 * 播放順序），推薦頁隨機（那是一份榜單，依序播會永遠停在前幾首）。
 */
export type PlayOrder = 'sequential' | 'shuffle'
export type PlayQueue = { list: MusicItem[]; index: number; order: PlayOrder }

/** 自動續播時連續失敗的上限。超過就停手，不要無止境地打上游 */
const MAX_AUTO_SKIP = 8

/**
 * 依播放順序挑下一首的索引，跳過 skip 裡的（已知播不出來的）。
 * 沒有可播的下一首時回 -1。
 * 依序模式播到清單尾端就停，不繞回開頭 —— 繞回去會變成無限循環，
 * 而使用者要的循環是用播放模式按鈕控制的。
 */
function pickNextIndex(queue: PlayQueue, skip: Set<number>): number {
  const total = queue.list.length
  if (total === 0) return -1
  if (queue.order === 'sequential') {
    for (let i = queue.index + 1; i < total; i++) {
      if (!skip.has(i)) return i
    }
    return -1
  }
  const pool: number[] = []
  for (let i = 0; i < total; i++) {
    if (i !== queue.index && !skip.has(i)) pool.push(i)
  }
  if (pool.length === 0) return -1
  return pool[Math.floor(Math.random() * pool.length)]
}

let pluginsInitialized = false
let pluginsReady = false  // ← 只有當插件真正加載完成後才設為 true

/** 讀 localStorage 快取的插件（含使用者自行安裝的第三方插件） */
const readCachedPlugins = (): { name: string; code: string; enabled: boolean }[] => {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_PLUGINS) || '[]')
    if (!Array.isArray(raw)) return []
    return raw.filter((p: any) => p && p.name && p.code)
  } catch {
    return []
  }
}

const writeCachedPlugin = (name: string, code: string, enabled = true) => {
  try {
    const codes = JSON.parse(localStorage.getItem(STORAGE_CODES) || '{}')
    codes[name] = code
    localStorage.setItem(STORAGE_CODES, JSON.stringify(codes))
    const list = readCachedPlugins().filter(p => p.name !== name)
    list.push({ name, code, enabled })
    localStorage.setItem(STORAGE_PLUGINS, JSON.stringify(list))
  } catch (e) {
    console.error('[plugin] cache write failed:', e)
  }
}

/**
 * 從 URL 取插件原始碼。
 *
 * 同源 URL（官方音源 /plugins/*.js）直接抓：沒有 CORS 問題，也不必經代理。
 * 外部 URL（使用者自行安裝的第三方插件）才走 /api/proxy 由後端代抓 —— 讓
 * 瀏覽器直連第三方託管站，等於要求每個使用者的網路都連得到那個站，而
 * raw.githubusercontent.com 這類站點在部分地區並不穩定，失敗時是瀏覽器層的
 * `Failed to fetch`，連狀態碼都拿不到。
 *
 * bustCache：手動「重新載入」時加，換掉快取鍵，避免抓回過期副本。
 */
const fetchPluginCode = async (url: string, bustCache = false): Promise<string> => {
  const target = bustCache
    ? `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`
    : url
  const isSameOrigin = target.startsWith('/') || target.startsWith(window.location.origin)
  const request = isSameOrigin
    ? target
    : `/api/proxy?url=${encodeURIComponent(target)}&method=GET`
  const response = await fetch(request, { cache: 'no-store' })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const code = await response.text()
  if (!code.trim()) throw new Error('回應為空')
  // 代理把上游錯誤也當內容回傳，這裡確認真的是插件碼而不是錯誤頁
  if (!code.includes('module.exports') && !code.includes('exports.')) {
    throw new Error('回應不是插件代碼（可能是上游錯誤頁）')
  }
  return code
}

/** 載入並啟用插件，回傳實際註冊的名稱（可能是插件自己宣告的 platform） */
const loadPluginCode = (code: string, fallbackName?: string): string => {
  const registered = pluginManager.loadPlugin(code, fallbackName)
  pluginManager.setPluginEnabled(registered, true)
  return registered
}

const initPlugins = async () => {
  // StrictMode guard：React 18 會執行兩次，防止重複初始化
  if (pluginsInitialized) return
  pluginsInitialized = true

  // 1) 先載入快取。第一次之後就能離線啟動，不必每次都等 GitHub
  const cached = readCachedPlugins()
  for (const p of cached) {
    try {
      loadPluginCode(p.code, p.name)
      if (!p.enabled) pluginManager.setPluginEnabled(p.name, false)
      console.log(`[init] ${p.name} 從快取載入 (${p.code.length} chars)`)
    } catch (e) {
      console.error(`[init] 快取的 ${p.name} 載入失敗:`, e)
    }
  }

  // 預設不附音源：不在這裡自動安裝任何插件。使用者到插件頁自行匯入
  // （內置音源列在那裡可一鍵安裝，也可貼任意第三方插件 URL）。
  // 裝過一次就進 localStorage 快取，之後開啟即載入。
  pluginsReady = true
}

// 公開的等待方法
const waitForPlugins = async (): Promise<boolean> => {
  if (pluginsReady) return true
  // 等待最多 10 秒
  const start = Date.now()
  while (!pluginsReady && Date.now() - start < 10000) {
    await new Promise(r => setTimeout(r, 100))
  }
  return pluginsReady
}

// 自動啟動插件初始化
initPlugins()

/**
 * 整個 app 的狀態與行為。抽成 hook 是為了讓多套 UI 共用同一份邏輯 ——
 * 換皮不必動任何音源、播放或插件的程式碼。
 */
export function useMusicApp() {
  const [keyword, setKeyword] = useState('')
  const [results, setResults] = useState<MusicItem[]>([])
  const [playingItem, setPlayingItem] = useState<MusicItem | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null)
  const [pluginUrl, setPluginUrl] = useState('')
  const [pluginName, setPluginName] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [lockedItem, setLockedItem] = useState<{ title: string; artist: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [currentView, setCurrentView] = useState<'search' | 'plugins' | 'recommend'>('recommend')
  const [isPlaying, setIsPlaying] = useState(false)
  const [pluginToggles, setPluginToggles] = useState<Record<string, boolean>>({})
  const [pluginKey, setPluginKey] = useState(0)
  // 安裝／重新載入音源失敗的原因（預設不自動安裝，所以這只在使用者主動操作後才有值）
  const [pluginError, setPluginError] = useState<string | null>(null)
  const [reloadingPlugin, setReloadingPlugin] = useState(false)
  const [searchType, setSearchType] = useState<SearchType>('music')
  const [searchPage, setSearchPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  // 推薦頁
  const [recommendMode, setRecommendMode] = useState<'new' | 'hot'>('new')
  const [recommendSongs, setRecommendSongs] = useState<MusicItem[]>([])
  const [recommendLoading, setRecommendLoading] = useState(false)
  // 沒有任何已啟用插件、或插件不提供推薦 → 要能區分於「推薦回空清單」
  const [recommendUnsupported, setRecommendUnsupported] = useState(false)
  // 專輯/歌單詳情頁
  const [albumDetail, setAlbumDetail] = useState<MusicItem | null>(null)
  const [albumTracks, setAlbumTracks] = useState<MusicItem[]>([])
  const [albumLoading, setAlbumLoading] = useState(false)

  /**
   * 播放模式：
   *   auto — 播完自動續播（專輯內依序、其他清單隨機挑一首）
   *   one  — 單曲循環
   *   off  — 播完即停
   */
  const [playMode, setPlayMode] = useState<PlayMode>(() => {
    const saved = localStorage.getItem(STORAGE_PLAY_MODE)
    return PLAY_MODE_ORDER.includes(saved as PlayMode) ? (saved as PlayMode) : 'auto'
  })
  /**
   * 目前的播放佇列：這首歌是從哪個清單點進來的、在第幾位。
   * 用 ref 而非 state：ended 事件的處理函式只註冊一次，讀 state 會拿到舊值。
   * 不靠 item._albumDetail.musicList —— 專輯曲目是經 getAlbumInfo 另外載入的，
   * albumDetail 上的 musicList 可能是空的。
   */
  const queueRef = useRef<PlayQueue>({ list: [], index: -1, order: 'sequential' })

  // 依賴 pluginKey 來觸發重渲染
  /** 內置音源是否已安裝。依 pluginKey 重算（安裝／移除／啟用都會遞增它） */
  const officialInstalled = useMemo(
    () => !!pluginManager.getPlugin(OFFICIAL_PLUGIN_NAME),
    [pluginKey],
  )

  useEffect(() => {
    const initializeState = async () => {
      await waitForPlugins()
      const plugins = pluginManager.getPlugins()
      const toggles: Record<string, boolean> = {}
      for (const p of plugins) {
        toggles[p.name] = pluginManager.isPluginEnabled(p.name)
      }
      setPluginToggles(toggles)
      setPluginKey(k => k + 1)

    }
    initializeState()
  }, [])

  // 進入推薦頁時自動載入
  useEffect(() => {
    if (currentView === 'recommend' && recommendSongs.length === 0) {
      loadRecommend(recommendMode)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView])

  // ended 的處理放在 ref 裡：事件只註冊一次，直接寫閉包會鎖住第一次渲染的
  // playMode 與佇列。每次渲染更新 ref，事件就能讀到最新值。
  const handleEndedRef = useRef<() => void>(() => {})
  handleEndedRef.current = () => {
    setIsPlaying(false)
    setCurrentTime(0)
    // one 由 audio 原生 loop 處理，根本不會發 ended；off 就是播完即停
    if (playMode !== 'auto') return

    const q = queueRef.current
    const nextIdx = pickNextIndex(q, new Set())
    if (nextIdx < 0) return
    // auto: true —— 下一首若也放不出來，play() 會自己繼續往後跳
    play(q.list[nextIdx], { ...q, index: nextIdx }, { auto: true })
  }

  useEffect(() => {
    const unsubPlay = player.on('play', () => setIsPlaying(true))
    const unsubPause = player.on('pause', () => setIsPlaying(false))
    const unsubTime = player.on('timeupdate', (t: number, d: number) => {
      setCurrentTime(t)
      setDuration(d)
    })
    const unsubEnd = player.on('ended', () => handleEndedRef.current())
    return () => {
      unsubPlay()
      unsubPause()
      unsubTime()
      unsubEnd()
    }
  }, [])

  // 單曲循環交給 audio 原生 loop；模式記在 localStorage，重開仍保留
  useEffect(() => {
    player.setLoop(playMode === 'one')
    localStorage.setItem(STORAGE_PLAY_MODE, playMode)
  }, [playMode])

  const cyclePlayMode = () => {
    setPlayMode(prev => {
      const next = PLAY_MODE_ORDER[(PLAY_MODE_ORDER.indexOf(prev) + 1) % PLAY_MODE_ORDER.length]
      showNotification(PLAY_MODE_LABEL[next], 'info')
      return next
    })
  }

  const search = useCallback(async (pageNum: number = 1, append = false) => {
    if (!keyword.trim()) return
    if (pageNum === 1) {
      setLoading(true)
      setResults([])
      setErrorMessage(null)
      setHasMore(true)
    } else {
      setLoadingMore(true)
    }
    
    // 確保插件已初始化
    const ready = await waitForPlugins()
    if (!ready) {
      setLoading(false)
      setLoadingMore(false)
      setErrorMessage('插件尚未載入，請稍後再試。')
      return
    }
    
    try {
      let newResults: any[] = []
      const enabledPlugins = pluginManager.getEnabledPlugins()
      console.log('[App] Searching page:', pageNum, 'plugins:', enabledPlugins.map(p => p.name))
      
      for (const plugin of enabledPlugins) {
        try {
          const pluginResults = await pluginManager.searchForPlugin(plugin.name, keyword, searchType, pageNum)
          if (pluginResults && pluginResults.length > 0) {
            newResults = newResults.concat(pluginResults)
            console.log('[App] Plugin results from', plugin.name, 'page', pageNum, ':', pluginResults.length)
          }
        } catch (e) {
          console.error('[App] Plugin search failed:', plugin.name, e)
        }
      }
      
      if (append) {
        setResults(prev => prev.concat(newResults))
      } else {
        setResults(newResults)
      }
      
      // 判斷是否還有更多結果（每頁結果少於預期 → 沒有更多了）
      if (newResults.length < 20) {
        setHasMore(false)
      }
      
      if (pageNum === 1 && newResults.length === 0) {
        setErrorMessage(`沒有找到關鍵字「${keyword}」的搜尋結果。`)
      }
    } catch (e: any) {
      const msg = `搜尋失敗: ${e.message || String(e)}`
      console.error('Search error:', e)
      setErrorMessage(msg)
      showNotification(msg, 'error')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [keyword, searchType, pluginManager])

  /**
   * 下載。與播放同一條路：先問音源要 URL，再把那個 URL 抓成 blob 存檔。
   * 同樣不含任何平台判斷；跨域 URL 由 /api/proxy 代抓（瀏覽器拿不到跨域 blob）。
   */
  const handleDownload = async (item: MusicItem) => {
    const platform = item.platform || ''
    const plugin = pluginManager.getPlugin(platform)
    if (!plugin) {
      showNotification(`找不到音源「${platform || '未知'}」，請到「插件」頁安裝`, 'error')
      return
    }
    // 失敗重試（502 通常是伺服器重啟空窗或暫時性上游錯誤，重試一次即可）
    const attempts = [1, 2]
    for (const attempt of attempts) {
      try {
        const media = await pluginManager.getMediaSource(plugin, item)
        if (!media?.url) throw new Error('音源沒有回傳可下載的 URL')
        const isSameOrigin = media.url.startsWith('/')
          || media.url.startsWith(window.location.origin)
        const url = isSameOrigin
          ? media.url
          : `/api/proxy?url=${encodeURIComponent(media.url)}&method=GET`
        const response = await fetch(url)
        if (!response.ok) {
          const err = await response.json().catch(() => null)
          const msg = err?.error || `HTTP ${response.status}`
          if (attempt < attempts.length) {
            await new Promise(r => setTimeout(r, 800))
            continue
          }
          throw new Error(msg)
        }
        const contentType = response.headers.get('content-type') || ''
        const blob = await response.blob()
        const blobUrl = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = blobUrl
        const ext = contentType.includes('ogg') ? 'ogg' : contentType.includes('wav') ? 'wav' : 'm4a'
        const safeName = (item.title || 'song').replace(/[\\/:*?"<>|]/g, '_').trim() || 'song'
        link.download = `${safeName}.${ext}`
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(blobUrl)
        return
      } catch (e) {
        // 最後一次才當作失敗
        if (attempt >= attempts.length) {
          console.error('Download failed:', e)
          const msg = e instanceof Error ? e.message : String(e)
          // 音源明確表示無權限 → 彈窗提示，不當成一般錯誤
          if (/Not authorized|1005/i.test(msg) || (e instanceof Error && /Failed to get media/i.test(e.message))) {
            setLockedItem({ title: item.title || '', artist: item.artist || '' })
            return
          }
          showNotification(`下載失敗: ${msg}`, 'error')
          return
        }
        await new Promise(r => setTimeout(r, 800))
      }
    }
  }

  const showNotification = (message: string, type: 'success' | 'error' | 'info') => {
    setNotification({ message, type })
    setTimeout(() => setNotification(null), 3000)
  }

  /**
   * 播放。播放器只做一件事：問音源要一個可播的 URL，然後播。
   * 這裡刻意沒有任何平台名稱的判斷 —— 音源怎麼解析、要不要跨源救援、
   * 要不要簽名，全是插件（與其後端）的事，加新音源不必改這個函式。
   */
  /**
   * 播放。播放器只做一件事：問音源要一個可播的 URL，然後播。
   * 這裡刻意沒有任何平台名稱的判斷 —— 音源怎麼解析、要不要跨源救援、
   * 要不要簽名，全是插件（與其後端）的事，加新音源不必改這個函式。
   *
   * opts.auto  這次播放是自動續播觸發的（而非使用者點的）
   * opts.skip  本輪已知播不出來的索引，跨遞迴共用同一個 Set
   */
  const play = async (
    item: MusicItem,
    queue?: PlayQueue,
    opts?: { auto?: boolean; skip?: Set<number> },
  ) => {
    if (queue) queueRef.current = queue
    const auto = opts?.auto ?? false
    const skip = opts?.skip ?? new Set<number>()
    setPlayingItem(item)
    try {
      const platform = item.platform || ''
      const plugin = pluginManager.getPlugin(platform)
      if (!plugin) {
        showNotification(`找不到音源「${platform || '未知'}」，請到「插件」頁安裝`, 'error')
        return
      }
      const media = await pluginManager.getMediaSource(plugin, item)
      if (!media?.url) throw new Error('音源沒有回傳可播放的 URL')

      await player.play(media.url)
      setIsPlaying(true)
    } catch (e: any) {
      const errMsg = e?.message || e || ''
      console.error(`[play] ${item.title} 失敗:`, errMsg)

      const q = queueRef.current
      if (q.index >= 0) skip.add(q.index)

      // 自動續播中遇到播不出來的歌 → 跳過它繼續，不要讓整輪停在一首壞歌上。
      // （這是先前的 bug：非專輯曲目一失敗就彈窗並停止播放）
      if (auto && skip.size <= MAX_AUTO_SKIP) {
        const nextIdx = pickNextIndex(q, skip)
        if (nextIdx >= 0) {
          const next = q.list[nextIdx]
          console.log(`[play] 跳過無源曲目，改播：${next.title}`)
          return await play(next, { ...q, index: nextIdx }, { auto: true, skip })
        }
      }

      if (auto) {
        // 跳不動了才收手，並說清楚為什麼停下來
        showNotification(
          skip.size > MAX_AUTO_SKIP
            ? `連續 ${skip.size} 首無可用音源，已停止續播`
            : '清單裡沒有其他可播的曲目了',
          'error',
        )
        setIsPlaying(false)
        return
      }

      // 使用者自己點的那首放不出來 → 明確告知，不要默默跳走
      setLockedItem({ title: item.title || '', artist: item.artist || '' })
    }
  }

  const togglePlay = () => {
    player.toggle()
    setIsPlaying(player.isPlaying)
  }

  /** 點進度條跳轉（音源端點支援 Range，可直接 seek） */
  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!duration || !Number.isFinite(duration)) return
    const rect = e.currentTarget.getBoundingClientRect()
    if (rect.width <= 0) return
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    const target = ratio * duration
    player.seekTo(target)
    setCurrentTime(target)
  }

  const loadMore = async () => {
    const nextPage = searchPage + 1
    setSearchPage(nextPage)
    await search(nextPage, true)
  }

  // 載入推薦（最新/熱門）。推薦是音源的能力，逐一問已啟用的插件要，
  // 沒裝音源就沒有推薦 —— 這樣才與「播放器不認識來源」一致。
  const loadRecommend = useCallback(async (mode: 'new' | 'hot') => {
    setRecommendMode(mode)
    setRecommendLoading(true)
    setRecommendUnsupported(false)
    try {
      await waitForPlugins()
      const enabled = pluginManager.getEnabledPlugins()
      if (enabled.length === 0) {
        setRecommendSongs([])
        setRecommendUnsupported(true)
        return
      }
      let songs: MusicItem[] = []
      let supported = false
      for (const plugin of enabled) {
        try {
          const list = await pluginManager.getRecommendForPlugin(plugin.name, mode, 40)
          if (list === null) continue  // 該插件不提供推薦
          supported = true
          songs = songs.concat(list)
        } catch (e) {
          console.error(`[recommend] ${plugin.name} 失敗:`, e)
        }
      }
      setRecommendSongs(songs)
      setRecommendUnsupported(!supported)
    } catch (e) {
      console.error('Load recommend failed:', e)
      setRecommendSongs([])
      showNotification(`載入推薦失敗: ${e instanceof Error ? e.message : String(e)}`, 'error')
    } finally {
      setRecommendLoading(false)
    }
  }, [])

  // 切換推薦分頁
  const switchRecommendMode = (mode: 'new' | 'hot') => {
    if (mode === recommendMode && recommendSongs.length > 0) return
    loadRecommend(mode)
  }

  // 點擊項目：歌曲直接播放，專輯/歌單展開詳情
  const handleItemClick = (item: MusicItem) => {
    if (item.type === 'album' || item.type === 'sheet') {
      // 專輯/歌單：顯示專輯詳情
      setAlbumDetail(item)
      // 如果後端已經返回 musicList，直接使用
      const tracks = item.musicList || []
      setAlbumTracks(tracks)
      if (tracks.length === 0) {
        // 需要從後端載入
        loadAlbumTracks(item)
      }
    } else {
      // 歌曲：連同它所在的清單一起傳入，播完才知道要接什麼。
      // 搜尋結果依序播（使用者看到的順序就是播放順序）；推薦頁隨機
      // （那是一份千首的榜單，依序播會永遠繞在前幾首）。
      const fromRecommend = currentView === 'recommend'
      const list = fromRecommend ? recommendSongs : results
      const index = list.findIndex(s => s.id === item.id && s.platform === item.platform)
      play(item, {
        list,
        index: index >= 0 ? index : 0,
        order: fromRecommend ? 'shuffle' : 'sequential',
      })
    }
  }

  // 專輯曲目由音源提供（插件的 getAlbumInfo），app 不直接打後端
  const loadAlbumTracks = async (item: MusicItem) => {
    setAlbumLoading(true)
    try {
      const platform = item.platform || ''
      const plugin = pluginManager.getPlugin(platform)
      if (!plugin) {
        setErrorMessage(`找不到音源「${platform || '未知'}」，請到「插件」頁安裝`)
        return
      }
      const tracks = await pluginManager.getAlbumInfoForPlugin(plugin.name, item)
      if (tracks === null) {
        setErrorMessage(`音源「${plugin.name}」不支援專輯詳情`)
        return
      }
      setAlbumTracks(tracks)
    } catch (e) {
      console.error('Load album tracks failed:', e)
      setErrorMessage(`載入專輯失敗: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setAlbumLoading(false)
    }
  }

  // 返回搜尋結果
  const goBackToSearch = () => {
    setAlbumDetail(null)
    setAlbumTracks([])
  }

  const handleSearchSubmit = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      setSearchPage(1)
      search(1)
    }
  }

  const formatTime = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const installPluginFromURL = async () => {
    const url = pluginUrl.trim()
    if (!url) {
      showNotification('請輸入插件 URL', 'error')
      return
    }
    try {
      setLoading(true)
      // 與官方插件走同一條路：經後端代抓 + 換快取鍵，避免瀏覽器直連不到
      // 插件託管站（Failed to fetch），也避免抓回 CDN 的過期副本
      const code = await fetchPluginCode(url, true)
      // 名稱優先用插件自己宣告的 platform，輸入框留空也能裝
      const registered = loadPluginCode(code, pluginName.trim() || undefined)
      savePluginCode(registered, code)
      setPluginToggles(prev => ({ ...prev, [registered]: true }))
      setPluginKey(k => k + 1)
      showNotification(`插件「${registered}」已安裝`, 'success')
      setPluginUrl('')
      setPluginName('')
      savePluginsToStorage()
    } catch (e: any) {
      // 原本只說「插件安裝失敗」，看不出是網路不通、URL 錯還是代碼有問題
      console.error('Install error:', e)
      showNotification(`插件安裝失敗：${e?.message || e}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  // 依賴 pluginKey 來觸發重渲染，確保官方插件狀態正確
  /**
   * 安裝或更新內置音源（同源 /plugins/whymusic.js）。
   * 首次是「安裝」，之後是「更新」—— 換掉插件檔後按這個才會生效，
   * 否則會一直用 localStorage 裡的舊版本。
   */
  const installOfficialPlugin = async () => {
    setReloadingPlugin(true)
    try {
      const code = await fetchPluginCode(OFFICIAL_PLUGIN_URL, true)
      pluginManager.removePlugin(OFFICIAL_PLUGIN_NAME)
      const registered = loadPluginCode(code, OFFICIAL_PLUGIN_NAME)
      writeCachedPlugin(registered, code)
      setPluginToggles(prev => ({ ...prev, [registered]: true }))
      setPluginKey(k => k + 1)
      setPluginError(null)
      // 帶上版本，使用者才看得出到底有沒有真的換版（先前只說「成功」，
      // 抓回舊碼時完全看不出來）
      // 清掉舊清單，回推薦頁時會用新音源重新載入
      setRecommendSongs([])
      const version = pluginManager.getPlugin(registered)?.version || '?'
      showNotification(`已安裝 ${registered} v${version}`, 'success')
    } catch (e: any) {
      const msg = `安裝失敗：${e?.message || e}`
      setPluginError(msg)
      showNotification(msg, 'error')
    } finally {
      setReloadingPlugin(false)
    }
  }

  const removePlugin = (name: string) => {
    pluginManager.removePlugin(name)
    setPluginToggles(prev => {
      const newToggles = { ...prev }
      delete newToggles[name]
      return newToggles
    })
    // 必須遞增 pluginKey：officialInstalled 是依它重算的，少了這行卡片會停在
    // 已安裝狀態（按鈕仍是「更新／已啟用／移除」、版號變成 v?），要重載才正確
    setPluginKey(k => k + 1)
    setPluginError(null)
    // 音源沒了，已載入的推薦清單也不再可播，清掉讓它重新判定
    setRecommendSongs([])
    setResults([])
    showNotification(`插件「${name}」已移除`, 'success')
    savePluginsToStorage()
  }

  const togglePlugin = (name: string) => {
    const newState = !pluginToggles[name]
    pluginManager.setPluginEnabled(name, newState)
    setPluginToggles(prev => ({ ...prev, [name]: newState }))
    savePluginsToStorage()
  }

  const savePluginCode = (name: string, code: string) => {
    try {
      const pluginCodes: Record<string, string> = JSON.parse(localStorage.getItem('musicfree-plugin-codes') || '{}')
      pluginCodes[name] = code
      localStorage.setItem('musicfree-plugin-codes', JSON.stringify(pluginCodes))
    } catch (e) {
      console.error('Failed to save plugin code:', e)
    }
  }

  const savePluginsToStorage = () => {
    try {
      const pluginCodes: Record<string, string> = JSON.parse(localStorage.getItem('musicfree-plugin-codes') || '{}')
      const pluginData = pluginManager.getPlugins().map(p => ({
        name: p.name,
        code: pluginCodes[p.name] || '',   // 直接存原始 code，不再 JSON 編碼
        enabled: pluginManager.isPluginEnabled(p.name)
      }))
      localStorage.setItem('musicfree-plugins', JSON.stringify(pluginData))
    } catch (e) {
      console.error('Failed to save plugins:', e)
    }
  }

  // 依賴 pluginKey 來觸發重渲染，確保插件按鈕狀態正確

  return {
    albumDetail,
    albumLoading,
    albumTracks,
    currentTime,
    currentView,
    cyclePlayMode,
    duration,
    errorMessage,
    formatTime,
    goBackToSearch,
    handleDownload,
    handleItemClick,
    handleSearchSubmit,
    handleSeek,
    hasMore,
    installOfficialPlugin,
    installPluginFromURL,
    isPlaying,
    keyword,
    loadAlbumTracks,
    loadMore,
    loadRecommend,
    loading,
    loadingMore,
    lockedItem,
    notification,
    officialInstalled,
    play,
    playMode,
    playingItem,
    pluginError,
    pluginKey,
    pluginName,
    pluginToggles,
    pluginUrl,
    recommendLoading,
    recommendMode,
    recommendSongs,
    recommendUnsupported,
    reloadingPlugin,
    removePlugin,
    results,
    savePluginCode,
    savePluginsToStorage,
    search,
    searchPage,
    searchType,
    setAlbumDetail,
    setAlbumLoading,
    setAlbumTracks,
    setCurrentTime,
    setCurrentView,
    setDuration,
    setErrorMessage,
    setHasMore,
    setIsPlaying,
    setKeyword,
    setLoading,
    setLoadingMore,
    setLockedItem,
    setNotification,
    setPlayMode,
    setPlayingItem,
    setPluginError,
    setPluginKey,
    setPluginName,
    setPluginToggles,
    setPluginUrl,
    setRecommendLoading,
    setRecommendMode,
    setRecommendSongs,
    setRecommendUnsupported,
    setReloadingPlugin,
    setResults,
    setSearchPage,
    setSearchType,
    showNotification,
    switchRecommendMode,
    togglePlay,
    togglePlugin,
  }
}

export type MusicApp = ReturnType<typeof useMusicApp>
