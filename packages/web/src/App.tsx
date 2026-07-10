import { useState, useEffect, useCallback, useMemo } from 'react'
import { Player, PluginManager, MusicItem, SearchType } from './core'
import audiomackCode from './plugins/bundled/audiomack.js?raw'

const player = new Player()
const pluginManager = new PluginManager()

/** 官方插件（內置代碼，無需 CDN 安裝） */
const OFFICIAL_PLUGINS = [
  { name: 'Audiomack', code: audiomackCode },
]

// 加載插件（優先使用內置代碼）
let pluginsInitialized = false
let pluginsReady = false  // ← 只有當插件真正加載完成後才設為 true

const initPlugins = async () => {
  // StrictMode guard：React 18 會執行兩次，防止重複初始化
  if (pluginsInitialized) return
  pluginsInitialized = true

  // 直接使用內置的 OFFICIAL_PLUGINS（確保使用最新版本）
  console.log('[Auto-init] Using bundled OFFICIAL_PLUGINS (latest version)')
  for (const p of OFFICIAL_PLUGINS) {
    try {
      pluginManager.loadPlugin(p.code, p.name)
      pluginManager.setPluginEnabled(p.name, true)
      console.log(`[Auto-init] Loaded ${p.name} from bundled code (${p.code.length} chars)`)
    } catch (e) {
      console.error(`[Auto-init] Failed to load ${p.name} from bundled code:`, e)
    }
  }
  
  // 將內置插件保存至 localStorage（覆蓋舊版本）
  const plugins = OFFICIAL_PLUGINS.map(p => ({ name: p.name, code: p.code, enabled: true }))
  const codes: Record<string, string> = {}
  for (const p of plugins) { codes[p.name] = p.code }
  localStorage.setItem('musicfree-plugin-codes', JSON.stringify(codes))
  localStorage.setItem('musicfree-plugins', JSON.stringify(plugins))
  
  // 標記插件加載完成
  pluginsReady = true
  console.log('[Auto-init] All plugins loaded')
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
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [pluginUrl, setPluginUrl] = useState('')
  const [pluginName, setPluginName] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [currentView, setCurrentView] = useState<'search' | 'plugins' | 'store'>('search')
  const [isPlaying, setIsPlaying] = useState(false)
  const [pluginToggles, setPluginToggles] = useState<Record<string, boolean>>({})
  const [pluginKey, setPluginKey] = useState(0)
  const [searchType, setSearchType] = useState<SearchType>('music')
  const [searchPage, setSearchPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  // 專輯/歌單詳情頁
  const [albumDetail, setAlbumDetail] = useState<MusicItem | null>(null)
  const [albumTracks, setAlbumTracks] = useState<MusicItem[]>([])
  const [albumLoading, setAlbumLoading] = useState(false)

  // 依賴 pluginKey 來觸發重渲染
  const installedNames = useMemo(() => new Set(pluginManager.getPlugins().map(p => p.name)), [pluginKey])

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
        // Audiomack：使用後端 API（OAuth 簽名由後端處理）
        if (plugin.name === 'Audiomack') {
          try {
            const response = await fetch(`/api/search?q=${encodeURIComponent(keyword)}&type=${searchType}&page=${pageNum}`)
            if (response.ok) {
              const apiResults = await response.json()
              newResults = newResults.concat(apiResults)
              console.log('[App] Backend API page', pageNum, 'results:', apiResults.length)
            }
          } catch (e) {
            console.error('[App] Backend API failed:', e)
          }
          continue
        }
        
        // 其他 plugin
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

  const showNotification = (message: string, type: 'success' | 'error') => {
    setNotification({ message, type })
    setTimeout(() => setNotification(null), 3000)
  }

  const play = async (item: MusicItem) => {
    setPlayingItem(item)
    try {
      let audioUrl: string | null = null
      const platform = item.platform || ''

      if (platform === 'Audiomack') {
        // Audiomack: 後端 OAuth 簽名，直接使用 signed URL（不走代理，避免簽名被編碼破壞）
        const mediaUrl = `/api/media?id=${encodeURIComponent(String(item.id))}&platform=Audiomack`
        const response = await fetch(mediaUrl)
        if (!response.ok) {
          const err = await response.json()
          const errMsg = err.error || 'Failed to get Audiomack media'
          // 如果專輯內有歌曲列表，嘗試下一首
          const album = (item as any)._albumDetail
          if (album && (item as any)._trackIndex !== undefined) {
            const allTracks = album.musicList || []
            const nextIdx = ((item as any)._trackIndex || 0) + 1
            if (nextIdx < allTracks.length) {
              const nextTrack = allTracks[nextIdx]
              console.log(`[play] Song ${item.id} failed (${errMsg}), trying next: ${nextTrack.id}`)
              nextTrack._albumDetail = album
              nextTrack._trackIndex = nextIdx
              return await play(nextTrack)
            }
          }
          throw new Error(errMsg)
        }
        const data = await response.json()
        audioUrl = data.url || null
        console.log('[play] Audiomack signed URL')
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
      showNotification(`播放失敗: ${e.message || e}`, 'error')
    }
  }

  const togglePlay = () => {
    player.toggle()
    setIsPlaying(player.isPlaying)
  }

  const loadMore = async () => {
    const nextPage = searchPage + 1
    setSearchPage(nextPage)
    await search(nextPage, true)
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
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const installPluginFromURL = async () => {
    const url = pluginUrl.trim()
    const name = pluginName.trim()
    if (!url || !name) {
      showNotification('請輸入插件 URL 和名稱', 'error')
      return
    }
    try {
      setLoading(true)
      const response = await fetch(url)
      if (!response.ok) throw new Error('Failed to fetch')
      const code = await response.text()
      pluginManager.loadPlugin(code, name)
      savePluginCode(name, code)
      setPluginToggles(prev => ({ ...prev, [name]: true }))
      showNotification(`插件 "${name}" 已安裝`, 'success')
      setPluginUrl('')
      setPluginName('')
      savePluginsToStorage()
    } catch (e) {
      console.error('Install error:', e)
      showNotification('插件安裝失敗', 'error')
    } finally {
      setLoading(false)
    }
  }

  const installOfficialPlugin = async (plugin: { name: string; code: string }) => {
    if (pluginManager.getPlugin(plugin.name)) {
      showNotification(`插件 "${plugin.name}" 已安裝`, 'success')
      return
    }
    try {
      setLoading(true)
      pluginManager.loadPlugin(plugin.code, plugin.name)
      pluginManager.setPluginEnabled(plugin.name, true)
      savePluginCode(plugin.name, plugin.code)
      setPluginToggles(prev => ({ ...prev, [plugin.name]: true }))
      setPluginKey(k => k + 1)
      showNotification(`插件 "${plugin.name}" 已安裝`, 'success')
      savePluginsToStorage()
    } catch (e) {
      console.error('Install error:', e)
      showNotification(`插件 "${plugin.name}" 安裝失敗: ${e}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  const removePlugin = (name: string) => {
    pluginManager.removePlugin(name)
    setPluginToggles(prev => {
      const newToggles = { ...prev }
      delete newToggles[name]
      return newToggles
    })
    showNotification(`插件 "${name}" 已移除`, 'success')
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

  // 依賴 pluginKey 來觸發重渲染，確保商店按鈕狀態正確

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-800 to-indigo-900 text-white" style={{ height: '100vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* Notification */}
      {notification && (
        <div
          className="fixed top-4 right-4 z-50 px-4 py-2 rounded-lg"
          style={{
            background: notification.type === 'success' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)',
            color: notification.type === 'success' ? '#22c55e' : '#ef4444'
          }}
        >
          {notification.message}
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
                    {albumTracks.map((track, idx) => (
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
                      <option value="sheet">歌單</option>
                      <option value="artist">歌手</option>
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
                        {pluginManager.getPlugins().length === 0
                          ? '請先在「商店」安裝插件。'
                          : '未找到結果。'}
                      </div>
                    )}
                    {results.map((item) => (
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

          {currentView === 'plugins' && (
            <div className="max-w-2xl mx-auto">
              <h2 className="text-xl font-bold mb-4">插件管理</h2>

              {/* Add Plugin */}
              <div className="bg-gray-800 rounded-lg p-4 mb-4">
                <div className="space-y-2">
                  <input
                    type="text"
                    value={pluginName}
                    onChange={(e) => setPluginName(e.currentTarget.value)}
                    placeholder="插件名稱"
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white outline-none"
                  />
                  <input
                    type="text"
                    value={pluginUrl}
                    onChange={(e) => setPluginUrl(e.currentTarget.value)}
                    placeholder="插件 URL"
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white outline-none"
                  />
                  <button
                    onClick={installPluginFromURL}
                    disabled={loading}
                    className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium transition disabled:opacity-50"
                  >
                    {loading ? '安裝中...' : '安裝插件'}
                  </button>
                </div>
              </div>

              {/* Plugin List */}
              <div className="space-y-2">
                {pluginManager.getPlugins().map((plugin) => (
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
                        {pluginToggles[plugin.name] === false ? '禁用' : '啟用'}
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
              </div>
            </div>
          )}

          {currentView === 'store' && (
            <div className="max-w-2xl mx-auto">
              <h2 className="text-xl font-bold mb-4">插件商店</h2>
              <p className="text-sm text-gray-400 mb-4">點擊安裝官方插件，安裝後可在插件管理中啟用/禁用</p>
              <div className="space-y-2">
                {OFFICIAL_PLUGINS.map((p) => (
                  <div key={p.name} className="flex items-center justify-between p-3 bg-gray-800 rounded-lg">
                    <div>
                      <div className="font-medium">{p.name}</div>
                      <div className="text-sm text-gray-400">官方插件</div>
                    </div>
                    <button
                      onClick={() => installOfficialPlugin(p)}
                      disabled={installedNames.has(p.name) || loading}
                      className={`px-3 py-1 rounded text-sm ${
                        installedNames.has(p.name)
                          ? 'bg-gray-600 cursor-not-allowed'
                          : 'bg-green-600 hover:bg-green-700'
                      }`}
                    >
                      {installedNames.has(p.name) ? '已安裝' : '安裝'}
                    </button>
                  </div>
                ))}
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
          {/* Progress Bar */}
          <div className="relative h-1 bg-gray-600 rounded-full max-w-2xl mx-auto mb-2">
            <div
              className="absolute top-0 left-0 h-full bg-blue-500 rounded-full transition-all"
              style={{ width: duration > 0 ? `${(currentTime / duration) * 100}%` : '0%' }}
            />
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
          style={{ color: currentView === 'search' ? '#3b82f6' : '#6b7280' }}
          onClick={() => setCurrentView('search')}
        >
          <span className="text-sm">搜索</span>
        </button>
        <button
          className="flex-1 flex items-center justify-center gap-2 py-3"
          style={{ color: currentView === 'store' ? '#3b82f6' : '#6b7280' }}
          onClick={() => setCurrentView('store')}
        >
          <span className="text-sm">商店</span>
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
