import { useState, useEffect, useCallback, useMemo } from 'react'
import { Player, PluginManager, MusicItem, SearchType } from './core'

const player = new Player()
const pluginManager = new PluginManager()

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
const OFFICIAL_PLUGIN_NAME = 'WhyMusic'
const OFFICIAL_PLUGIN_URL = '/plugins/whymusic.js'

const STORAGE_CODES = 'musicfree-plugin-codes'
const STORAGE_PLUGINS = 'musicfree-plugins'

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

export default function App() {
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
  // 專輯/歌單詳情頁
  const [albumDetail, setAlbumDetail] = useState<MusicItem | null>(null)
  const [albumTracks, setAlbumTracks] = useState<MusicItem[]>([])
  const [albumLoading, setAlbumLoading] = useState(false)

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

  useEffect(() => {
    const unsubPlay = player.on('play', () => setIsPlaying(true))
    const unsubPause = player.on('pause', () => setIsPlaying(false))
    const unsubTime = player.on('timeupdate', (t: number, d: number) => {
      setCurrentTime(t)
      setDuration(d)
    })
    const unsubEnd = player.on('ended', () => {
      setIsPlaying(false)
      setCurrentTime(0)
    })
    return () => {
      unsubPlay()
      unsubPause()
      unsubTime()
      unsubEnd()
    }
  }, [])

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

  const handleDownload = async (item: MusicItem, isFallback = false) => {
    const platform = item.platform || ''
    const downloadParams = new URLSearchParams({
      id: String(item.id),
      platform,
      title: item.title || 'song',
      artist: item.artist || '',
    })
    // GD 聚合音源需帶子音源，後端才能直取而不必跨源重找
    if (item.subSource) downloadParams.set('source', item.subSource)
    const url = `/api/download?${downloadParams.toString()}`
    // 失敗重試（502 通常是伺服器重啟空窗或暫時性上游錯誤，重試一次即可）
    const attempts = [1, 2]
    for (const attempt of attempts) {
      try {
        const response = await fetch(url)
        if (!response.ok) {
          const err = await response.json().catch(() => null)
          const msg = err?.error || `HTTP ${response.status}`
          // 鎖定歌曲直接拋出（不重試）
          if (/Not authorized|1005/i.test(msg) || /Failed to get media/i.test(msg)) {
            // 該子音源無下載權限 → 用歌名+歌手在其餘子音源找同一首歌
            if (!isFallback && !item._dlFallbackAttempted) {
              const altItem = await findGdFallback(item)
              if (altItem) {
                altItem._dlFallbackAttempted = true
                showNotification('原音源無效，改用其他子音源下載', 'info')
                return await handleDownload(altItem, true)
              }
            }
            throw new Error(msg)
          }
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
          // 下載仍失敗（含 YouTube fallback 失敗）→ 彈窗提示
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

  // 用歌名+歌手到 GD 聚合音源找替代音源（Audiomack 無播放權限曲目的救援路徑）
  //
  // 原本這裡打 /api/yt-search 用 YouTube 頂替，但 YouTube 的 player API 現在對
  // 所有 client 都要求 PoToken（回 LOGIN_REQUIRED / "Sign in to confirm you're
  // not a bot"），搜到了也放不出聲音，故改用 GD。
  const findGdFallback = useCallback(async (item: MusicItem): Promise<MusicItem | null> => {
    const query = [item.title, item.artist].filter(Boolean).join(' ')
    if (!query.trim()) return null
    try {
      const response = await fetch(`/api/why-search?q=${encodeURIComponent(query)}&count=10`)
      if (!response.ok) return null
      const results = await response.json()
      const list: MusicItem[] = Array.isArray(results) ? results : (results?.data || [])
      // 挑最接近的：歌名完全相同優先，其次前綴/包含，避免配到 Live／伴奏版
      const norm = (s?: string) => (s || '').toLowerCase().replace(/[（([【].*?[)）\]】]/g, '').replace(/\s+/g, '')
      const target = norm(item.title)
      const targetArtist = norm(item.artist)
      const rank = (s: MusicItem) => {
        const t = norm(s.title)
        let score = 0
        if (target && t === target) score += 20
        else if (target && (t.startsWith(target) || target.startsWith(t))) score += 10
        else if (target && t.includes(target)) score += 5
        const a = norm(s.artist)
        if (targetArtist && a && (a.includes(targetArtist) || targetArtist.includes(a))) score += 8
        return score
      }
      const pick = list
        .filter(s => rank(s) > 0)
        .sort((a, b) => rank(b) - rank(a))[0]
      return pick || null
    } catch {
      return null
    }
  }, [])

  const play = async (item: MusicItem) => {
    setPlayingItem(item)
    try {
      let audioUrl: string | null = null
      const platform = item.platform || ''

      if (platform === 'WhyMusic') {
        // 聚合音源：後端依 subSource 解析（netease/joox 走 GD 上游、audiomack
        // 走 OAuth）並串流。帶上歌名/歌手，後端在該子音源拿不到音源時可跨子源
        // 找同一首歌，省一次前端往返。
        const params = new URLSearchParams({
          id: String(item.id),
          platform: 'WhyMusic',
          source: item.subSource || '',
          title: item.title || '',
          artist: item.artist || '',
        })
        audioUrl = `/api/play?${params.toString()}`
      } else if (platform === 'Youtube' || platform === 'YouTube') {
        // YouTube: 後端 player API 拿音頻 URL
        const mediaUrl = `/api/play?id=${encodeURIComponent(String(item.id))}&platform=Youtube`
        audioUrl = mediaUrl
      } else {
        // 其他平台：嘗試 getMediaSource，失敗後回 /api/play
        const plugin = pluginManager.getPlugin(platform)
        const getMediaSourceFn = plugin?.getMediaSource
        if (getMediaSourceFn) {
          try {
            const result = await getMediaSourceFn(item)
            if (result?.url) {
              audioUrl = `/api/proxy?url=${encodeURIComponent(result.url)}&method=GET`
              console.log('[play] Proxied URL for', platform)
            }
          } catch { /* ignore */ }
        }
        // Fallback: 後端 /api/play
        if (!audioUrl) {
          audioUrl = `/api/play?id=${encodeURIComponent(String(item.id))}&platform=${encodeURIComponent(platform)}`
        }
      }

      if (!audioUrl) {
        showNotification('無法獲取音源 URL', 'error')
        return
      }

      await player.play(audioUrl)
      setIsPlaying(true)
    } catch (e: any) {
      console.error('Get media source error:', e)
      const errMsg = e?.message || e || ''

      // 專輯內某首無源（常見於 audiomack 子源的授權曲目）→ 跳下一首，
      // 不要讓整張專輯停在一首放不出來的歌上
      const album = item._albumDetail
      if (album && item._trackIndex !== undefined) {
        const allTracks: MusicItem[] = album.musicList || []
        const nextIdx = (item._trackIndex || 0) + 1
        if (nextIdx < allTracks.length) {
          const nextTrack = { ...allTracks[nextIdx], _albumDetail: album, _trackIndex: nextIdx }
          console.log(`[play] ${item.id} failed (${errMsg}), trying next: ${nextTrack.id}`)
          return await play(nextTrack)
        }
      }

      // 單曲無源 → 用歌名+歌手在其餘子音源找替代（後端已試過一輪，
      // 這裡多一層是為了處理後端整條解析失敗、連 title 都沒帶到的情況）
      if (!album && !item._gdFallbackAttempted) {
        const altItem = await findGdFallback(item)
        if (altItem) {
          altItem._gdFallbackAttempted = true
          console.log(`[play] fallback to alternate sub-source: ${altItem.title}`)
          showNotification('原音源無效，已改用其他子音源播放', 'info')
          return await play(altItem)
        }
      }
      if (!album) {
        setLockedItem({ title: item.title || '', artist: item.artist || '' })
        return
      }
      showNotification(`播放失敗: ${String(errMsg)}`, 'error')
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

  // 載入推薦香港流行曲（最新/熱門）
  const loadRecommend = useCallback(async (mode: 'new' | 'hot') => {
    setRecommendMode(mode)
    setRecommendLoading(true)
    try {
      const response = await fetch(`/api/recommend?mode=${mode}&limit=40`)
      if (!response.ok) {
        const err = await response.json().catch(() => null)
        throw new Error(err?.error || `HTTP ${response.status}`)
      }
      const data = await response.json()
      const songs: MusicItem[] = Array.isArray(data) ? data : (data?.data || [])
      setRecommendSongs(songs)
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
      // 歌曲：直接播放
      play(item)
    }
  }

  // 從後端載入專輯歌曲列表
  const loadAlbumTracks = async (item: MusicItem) => {
    setAlbumLoading(true)
    try {
      const id = String(item.id || '')
      const slug = item.url_slug || ''
      const artist = item.artist || ''
      if (!slug || !artist) {
        setErrorMessage('專輯資訊不完整，無法載入歌曲列表')
        setAlbumLoading(false)
        return
      }
      const response = await fetch(`/api/album?id=${encodeURIComponent(id)}&slug=${encodeURIComponent(slug)}&artist=${encodeURIComponent(artist)}`)
      if (response.ok) {
        const data = await response.json()
        if (Array.isArray(data)) {
          setAlbumTracks(data)
        } else {
          setErrorMessage(`載入專輯失敗: ${data.error || '未知錯誤'}`)
        }
      } else {
        setErrorMessage('載入專輯失敗')
      }
    } catch (e) {
      console.error('Load album tracks failed:', e)
      setErrorMessage('載入專輯失敗')
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-800 to-indigo-900 text-white" style={{ height: '100vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* Notification */}
      {notification && (
        <div
          className="fixed top-4 right-4 z-50 px-4 py-2 rounded-lg"
          style={{
            background: notification.type === 'success' ? 'rgba(34, 197, 94, 0.2)' : notification.type === 'info' ? 'rgba(59, 130, 246, 0.2)' : 'rgba(239, 68, 68, 0.2)',
            color: notification.type === 'success' ? '#22c55e' : notification.type === 'info' ? '#3b82f6' : '#ef4444'
          }}
        >
          {notification.message}
        </div>
      )}

      {/* 會員限定彈窗 */}
      {lockedItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setLockedItem(null)}>
          <div className="bg-gray-800 rounded-xl p-6 max-w-sm w-full mx-4 border border-gray-700" onClick={(e) => e.stopPropagation()}>
            <div className="text-center mb-4">
              <div className="text-3xl mb-2">🔒</div>
              <h3 className="text-lg font-bold mb-1">此歌曲為會員限定</h3>
              <p className="text-gray-400 text-sm truncate">{lockedItem.title}</p>
              <p className="text-gray-500 text-xs truncate">{lockedItem.artist}</p>
            </div>
            <p className="text-sm text-gray-300 leading-relaxed mb-6">
              這首是 Audiomack 的會員專屬內容，需要升級為會員才能下載。
            </p>
            <button
              onClick={() => setLockedItem(null)}
              className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium transition"
            >
              知道了
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="h-16 px-4 md:px-6 flex items-center justify-between border-b border-gray-800">
        <h1 className="text-xl font-bold">MusicFree Web</h1>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          {currentView === 'search' && (
            <div>
              {/* 專輯詳情頁 */}
              {albumDetail ? (
                <div>
                  {/* 返回按鈕 */}
                  <button
                    onClick={goBackToSearch}
                    className="mb-4 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition"
                  >
                    ← 返回搜尋結果
                  </button>
                  {/* 專輯頭部 */}
                  <div className="text-center mb-6 max-w-2xl mx-auto">
                    <h2 className="text-2xl font-bold mb-2">{albumDetail.title || '未知專輯'}</h2>
                    <p className="text-gray-400">{albumDetail.artist || ''}</p>
                  </div>
                  {/* 歌曲列表 */}
                  <div className="space-y-2 max-w-2xl mx-auto">
                    {albumLoading && (
                      <div className="text-center text-gray-500 py-8">載入中...</div>
                    )}
                    {!albumLoading && albumTracks.length === 0 && (
                      <div className="text-center text-gray-500 py-8">無歌曲數據</div>
                    )}
                    {albumTracks
                      .map((track, idx) => (
                      <div
                        key={track.id}
                        className="flex items-center gap-3 p-3 bg-gray-800 rounded-lg cursor-pointer hover:bg-gray-700 transition"
                        onClick={() => {
                          // Attach album context to track for auto-skip
                          const trackWithCtx = { ...track, _albumDetail: albumDetail, _trackIndex: idx }
                          play(trackWithCtx)
                        }}
                      >
                        <div className="w-10 h-10 rounded bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center flex-shrink-0">
                          {playingItem?.id === track.id && isPlaying ? (
                            <span className="text-white font-bold text-xs">♪</span>
                          ) : (
                            <span className="text-white font-bold">{(track.title || '♪')[0]}</span>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{track.title || '未知歌曲'}</div>
                          <div className="text-sm text-gray-400 truncate">{track.artist || '未知藝術家'}</div>
                        </div>
                        <div className="text-sm text-gray-500 flex-shrink-0">{track.platform || '未知'}</div>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDownload(track) }}
                          title="下載歌曲"
                          className="px-2 py-1 text-xs bg-green-600 hover:bg-green-700 rounded flex-shrink-0 transition"
                        >
                          ⬇
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  {/* Search Bar */}
                  <div className="flex gap-2 max-w-2xl mx-auto mb-4">
                    <input
                      type="text"
                      value={keyword}
                      onChange={(e) => setKeyword(e.currentTarget.value)}
                      onKeyDown={handleSearchSubmit}
                      placeholder="輸入關鍵字搜索..."
                      className="flex-1 px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white outline-none"
                    />
                    <select
                      value={searchType}
                      onChange={(e) => setSearchType(e.target.value as SearchType)}
                      className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white outline-none"
                    >
                      <option value="music">歌曲</option>
                      <option value="album">專輯</option>
                    </select>
                    <button
                      onClick={() => { setSearchPage(1); search(1) }}
                      disabled={!keyword.trim() || loading}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium transition disabled:opacity-50"
                    >
                      {loading ? '搜索中...' : '搜索'}
                    </button>
                  </div>

                  {/* Results */}
                  <div className="space-y-2 max-w-2xl mx-auto">
                    {results.length === 0 && !loading && (
                      <div className="text-center text-gray-500 py-8">
                        {pluginManager.getEnabledPlugins().length === 0
                          ? '搜尋需要音源。請到下方「插件」頁安裝。'
                          : '未找到結果。'}
                      </div>
                    )}
                    {results
                      .map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center gap-3 p-3 bg-gray-800 rounded-lg cursor-pointer hover:bg-gray-700 transition"
                        onClick={() => handleItemClick(item)}
                      >
                        <div className="w-10 h-10 rounded bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center flex-shrink-0">
                          {playingItem?.id === item.id && isPlaying ? (
                            <span className="text-white font-bold text-xs">♪</span>
                          ) : (
                            <span className="text-white font-bold">{(item.title || '♪')[0]}</span>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{item.title || '未知歌曲'}</div>
                          <div className="text-sm text-gray-400 truncate">{item.artist || '未知藝術家'}</div>
                        </div>
                        {item.type && item.type !== 'music' && (
                          <div className="text-xs px-2 py-1 bg-blue-600 rounded flex-shrink-0">
                            {item.type === 'album' ? '專輯' : item.type === 'sheet' ? '歌單' : item.type}
                          </div>
                        )}
                        <div className="text-sm text-gray-500 flex-shrink-0">{item.platform || '未知'}</div>
                        {(!item.type || item.type === 'music') && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDownload(item) }}
                            title="下載歌曲"
                            className="px-2 py-1 text-xs bg-green-600 hover:bg-green-700 rounded flex-shrink-0 transition"
                          >
                            ⬇
                          </button>
                        )}
                      </div>
                    ))}
                    {/* 載入更多按鈕 */}
                    {results.length > 0 && hasMore && (
                      <div className="text-center mt-4">
                        <button
                          onClick={loadMore}
                          disabled={loadingMore}
                          className="px-6 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition disabled:opacity-50"
                        >
                          {loadingMore ? '載入中...' : '載入更多'}
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {currentView === 'recommend' && (
            <div className="max-w-2xl mx-auto">
              {/* 分頁：最新 / 熱門 */}
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold">推薦香港流行曲</h2>
                <div className="flex gap-2">
                  <button
                    onClick={() => switchRecommendMode('new')}
                    className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${
                      recommendMode === 'new' ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'
                    }`}
                  >
                    最新
                  </button>
                  <button
                    onClick={() => switchRecommendMode('hot')}
                    className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${
                      recommendMode === 'hot' ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'
                    }`}
                  >
                    熱門
                  </button>
                </div>
              </div>

              {recommendLoading && recommendSongs.length === 0 && (
                <div className="text-center text-gray-500 py-10">載入中...</div>
              )}
              {!recommendLoading &&
                recommendSongs.length === 0 &&
                currentView === 'recommend' && (
                  <div className="text-center text-gray-500 py-10">尚無推薦歌曲。</div>
              )}
              <div className="space-y-2">
                {recommendSongs
                  .map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-3 p-3 bg-gray-800 rounded-lg cursor-pointer hover:bg-gray-700 transition"
                      onClick={() => handleItemClick(item)}
                    >
                      <div className="w-10 h-10 rounded bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center flex-shrink-0">
                        {playingItem?.id === item.id && isPlaying ? (
                          <span className="text-white font-bold text-xs">♪</span>
                        ) : (
                          <span className="text-white font-bold">{(item.title || '♪')[0]}</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{item.title || '未知歌曲'}</div>
                        <div className="text-sm text-gray-400 truncate">{item.artist || '未知藝術家'}</div>
                      </div>
                      <div className="text-sm text-gray-500 flex-shrink-0">{item.platform || '未知'}</div>
                      {(!item.type || item.type === 'music') && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDownload(item) }}
                          title="下載歌曲"
                          className="px-2 py-1 text-xs bg-green-600 hover:bg-green-700 rounded flex-shrink-0 transition"
                        >
                          ⬇
                        </button>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          )}

          {currentView === 'plugins' && (
            <div className="max-w-2xl mx-auto">
              <h2 className="text-xl font-bold mb-4">插件管理</h2>

              {/* 內置音源：預設不安裝，由使用者自行匯入 */}
              <div className="mb-4">
                <div className="text-sm text-gray-400 mb-2">內置音源</div>
                {pluginError && (
                  <div className="mb-2 p-3 bg-red-900/40 border border-red-700 rounded-lg text-sm">
                    <div className="font-medium text-red-300">{pluginError}</div>
                  </div>
                )}
                {!officialInstalled && (
                  <div className="mb-2 p-3 bg-blue-900/30 border border-blue-700/60 rounded-lg text-sm">
                    <div className="font-medium text-blue-200">尚未安裝音源</div>
                    <div className="text-blue-300/80 mt-1">
                      安裝後才能搜尋歌曲。推薦頁與播放不需要音源即可使用。
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  <div className="p-3 bg-gray-800 rounded-lg">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium">{OFFICIAL_PLUGIN_NAME}</div>
                        <div className="text-sm text-gray-400">
                          {officialInstalled
                            ? `v${pluginManager.getPlugin(OFFICIAL_PLUGIN_NAME)?.version || '?'}`
                            : '未安裝'}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          onClick={installOfficialPlugin}
                          disabled={reloadingPlugin}
                          className="px-3 py-1 rounded text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
                        >
                          {reloadingPlugin ? '處理中…' : officialInstalled ? '更新' : '安裝'}
                        </button>
                        {officialInstalled && (
                          <>
                            <button
                              onClick={() => togglePlugin(OFFICIAL_PLUGIN_NAME)}
                              className={`px-3 py-1 rounded text-sm ${
                                pluginToggles[OFFICIAL_PLUGIN_NAME] !== false
                                  ? 'bg-green-600 hover:bg-green-700'
                                  : 'bg-gray-600 hover:bg-gray-700'
                              }`}
                            >
                              {pluginToggles[OFFICIAL_PLUGIN_NAME] !== false ? '已啟用' : '已禁用'}
                            </button>
                            <button
                              onClick={() => removePlugin(OFFICIAL_PLUGIN_NAME)}
                              className="px-3 py-1 rounded text-sm bg-red-700 hover:bg-red-800"
                            >
                              移除
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="text-xs text-gray-500 mt-2 break-all">
                      來源：{OFFICIAL_PLUGIN_URL}
                    </div>
                  </div>
                </div>
              </div>

              {/* 第三方插件 */}
              <div className="mb-4">
                <div className="text-sm text-gray-400 mb-2">第三方插件</div>
                <div className="space-y-2">
                  {pluginManager.getPlugins()
                    .filter((plugin) => plugin.name !== OFFICIAL_PLUGIN_NAME)
                    .map((plugin) => (
                      <div key={plugin.name} className="flex items-center justify-between p-3 bg-gray-800 rounded-lg">
                        <div>
                          <div className="font-medium">{plugin.name}</div>
                          <div className="text-sm text-gray-400">v{plugin.version}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => togglePlugin(plugin.name)}
                            className={`px-3 py-1 rounded text-sm ${
                              pluginToggles[plugin.name] === false
                                ? 'bg-gray-600 hover:bg-gray-700'
                                : 'bg-green-600 hover:bg-green-700'
                            }`}
                          >
                            {pluginToggles[plugin.name] === false ? '已禁用' : '已啟用'}
                          </button>
                          <button
                            onClick={() => removePlugin(plugin.name)}
                            className="px-3 py-1 rounded text-sm bg-red-600 hover:bg-red-700"
                          >
                            移除
                          </button>
                        </div>
                      </div>
                    ))}
                  {pluginManager.getPlugins().filter((plugin) => plugin.name !== OFFICIAL_PLUGIN_NAME).length === 0 && (
                    <div className="text-sm text-gray-500 py-4 text-center">尚無第三方插件</div>
                  )}
                </div>
              </div>

              {/* 新增插件 */}
              <div className="bg-gray-800 rounded-lg p-4">
                <div className="font-medium mb-2">新增插件</div>
                <div className="space-y-2">
                  <input
                    type="text"
                    value={pluginUrl}
                    onChange={(e) => setPluginUrl(e.currentTarget.value)}
                    placeholder="插件 URL（例：https://raw.githubusercontent.com/.../index.js）"
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white outline-none"
                  />
                  <input
                    type="text"
                    value={pluginName}
                    onChange={(e) => setPluginName(e.currentTarget.value)}
                    placeholder="插件名稱（選填，留空則用插件自己宣告的名稱）"
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white outline-none"
                  />
                  <button
                    onClick={installPluginFromURL}
                    disabled={loading || !pluginUrl.trim()}
                    className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium transition disabled:opacity-50"
                  >
                    {loading ? '安裝中...' : '安裝插件'}
                  </button>
                  <div className="text-xs text-gray-500">
                    插件由本站後端代抓，不需你的網路連得到託管站。
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Player Bar */}
        <div className="bg-gray-800 border-t border-gray-700 p-3 md:p-4">
          <div className="flex items-center gap-3 mb-2 max-w-2xl mx-auto">
            <div className="w-10 h-10 rounded bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center flex-shrink-0">
              {playingItem ? playingItem.title[0] : '♪'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{playingItem?.title || '未播放'}</div>
              <div className="text-sm text-gray-400 truncate">{playingItem?.artist || '選擇歌曲播放'}</div>
            </div>
          </div>
          {/* Progress Bar（可點擊跳轉；外層加 py 擴大點擊範圍） */}
          <div
            className="max-w-2xl mx-auto mb-2 py-2 cursor-pointer"
            onClick={handleSeek}
            title="點擊跳轉"
          >
            <div className="relative h-1 bg-gray-600 rounded-full">
              <div
                className="absolute top-0 left-0 h-full bg-blue-500 rounded-full transition-all"
                style={{ width: duration > 0 ? `${(currentTime / duration) * 100}%` : '0%' }}
              />
            </div>
          </div>
          <div className="flex items-center justify-center gap-4 max-w-2xl mx-auto">
            <span className="text-sm text-gray-400 w-10 text-right">{formatTime(currentTime)}</span>
            <button
              onClick={togglePlay}
              className="p-2 rounded-full bg-blue-600 hover:bg-blue-700"
            >
              {isPlaying ? '⏸' : '▶'}
            </button>
            <span className="text-sm text-gray-400 w-10">{formatTime(duration)}</span>
          </div>
        </div>
      </div>

      {/* Bottom Nav */}
      <div className="bg-gray-900 border-t border-gray-800 flex">
        <button
          className="flex-1 flex items-center justify-center gap-2 py-3"
          style={{ color: currentView === 'recommend' ? '#3b82f6' : '#6b7280' }}
          onClick={() => setCurrentView('recommend')}
        >
          <span className="text-sm">推薦</span>
        </button>
        <button
          className="flex-1 flex items-center justify-center gap-2 py-3"
          style={{ color: currentView === 'search' ? '#3b82f6' : '#6b7280' }}
          onClick={() => setCurrentView('search')}
        >
          <span className="text-sm">搜索</span>
        </button>
        <button
          className="flex-1 flex items-center justify-center gap-2 py-3"
          style={{ color: currentView === 'plugins' ? '#3b82f6' : '#6b7280' }}
          onClick={() => setCurrentView('plugins')}
        >
          <span className="text-sm">插件</span>
        </button>
      </div>
    </div>
  )
}
