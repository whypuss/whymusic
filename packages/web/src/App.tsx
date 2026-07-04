import { useState, useEffect, useCallback, useMemo } from 'react'
import { Player, PluginManager, MusicItem, SearchType } from './core'

const player = new Player()
const pluginManager = new PluginManager()
const OFFICIAL_PLUGINS = [
  { name: 'Audiomack', url: 'https://cdn.jsdelivr.net/gh/maotoumao/MusicFreePlugins@master/dist/audiomack/index.js' },
  { name: 'Bilibili', url: 'https://cdn.jsdelivr.net/gh/maotoumao/MusicFreePlugins@master/dist/bilibili/index.js' },
  { name: 'Kuaishou', url: 'https://cdn.jsdelivr.net/gh/maotoumao/MusicFreePlugins@master/dist/kuaishou/index.js' },
  { name: '猫耳FM', url: 'https://cdn.jsdelivr.net/gh/maotoumao/MusicFreePlugins@master/dist/maoerfm/index.js' },
  { name: 'Suno', url: 'https://cdn.jsdelivr.net/gh/maotoumao/MusicFreePlugins@master/dist/suno/index.js' },
  { name: 'Udio', url: 'https://cdn.jsdelivr.net/gh/maotoumao/MusicFreePlugins@master/dist/udio/index.js' },
  { name: '音悦台', url: 'https://cdn.jsdelivr.net/gh/maotoumao/MusicFreePlugins@master/dist/yinyuetai/index.js' },
  { name: 'YouTube', url: 'https://cdn.jsdelivr.net/gh/maotoumao/MusicFreePlugins@master/dist/youtube/index.js' },
  { name: 'Airsonic', url: 'https://cdn.jsdelivr.net/gh/maotoumao/MusicFreePlugins@master/dist/airsonic/index.js' },
  { name: 'Navidrome', url: 'https://cdn.jsdelivr.net/gh/maotoumao/MusicFreePlugins@master/dist/navidrome/index.js' },
  { name: 'WebDAV', url: 'https://cdn.jsdelivr.net/gh/maotoumao/MusicFreePlugins@master/dist/webdav/index.js' },
  { name: '歌词网', url: 'https://cdn.jsdelivr.net/gh/maotoumao/MusicFreePlugins@master/dist/geciwang/index.js' },
  { name: '歌词千寻', url: 'https://cdn.jsdelivr.net/gh/maotoumao/MusicFreePlugins@master/dist/geciqianxun/index.js' },
]

// 加載插件（強制使用 jsDeliver CDN）
const initPlugins = async () => {
  // 1. 先從 localStorage 恢復插件代碼（優先使用已安裝的插件）
  let fromLocalStorage = false
  try {
    const saved = localStorage.getItem('musicfree-plugins')
    if (saved) {
      const data = JSON.parse(saved) as Array<{ name: string; code?: string; enabled: boolean }>
      for (const p of data) {
        if (p.name === 'Demo Plugin' || !p.code) continue
        pluginManager.loadPlugin(p.code, p.name)
        if (!p.enabled) pluginManager.setPluginEnabled(p.name, false)
      }
      fromLocalStorage = true
      console.log('[Auto-init] Loaded plugins from localStorage')
    }
  } catch (e) {
    console.error('Failed to load plugins from localStorage:', e)
  }

  // 2. 如果 localStorage 沒有插件，自動安裝 Audiomack
  if (!fromLocalStorage) {
    try {
      const response = await fetch('https://cdn.jsdelivr.net/gh/maotoumao/MusicFreePlugins@master/dist/audiomack/index.js')
      if (!response.ok) throw new Error('Failed to fetch')
      const code = await response.text()
      pluginManager.loadPlugin(code, 'Audiomack')
      // 保存到 localStorage，讓刷新後能恢復
      localStorage.setItem('musicfree-plugin-codes', JSON.stringify({ Audiomack: code }))
      localStorage.setItem('musicfree-plugins', JSON.stringify([
        { name: 'Audiomack', code: 'CDN', enabled: true }
      ]))
      console.log('[Auto-init] Installed Audiomack from CDN and saved to localStorage')
    } catch (e) {
      console.error('Failed to install Audiomack from CDN:', e)
    }
  }
}

// 等待插件加載完成
let pluginsLoaded = false
initPlugins().then(() => {
  pluginsLoaded = true
  console.log('[Plugins] All plugins loaded')
}).catch(e => {
  console.error('[Plugins] Failed to load plugins:', e)
})

// 公開的等待方法
const waitForPlugins = async (): Promise<boolean> => {
  if (pluginsLoaded) return true
  // 等待最多 10 秒
  const start = Date.now()
  while (!pluginsLoaded && Date.now() - start < 10000) {
    await new Promise(r => setTimeout(r, 100))
  }
  return pluginsLoaded
}

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
  const [currentView, setCurrentView] = useState<'search' | 'plugins' | 'store'>('search')
  const [isPlaying, setIsPlaying] = useState(false)
  const [pluginToggles, setPluginToggles] = useState<Record<string, boolean>>({})
  const [pluginKey, setPluginKey] = useState(0)
  const [searchType, setSearchType] = useState<SearchType>('music')

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

  const search = useCallback(async () => {
    if (!keyword.trim()) return
    setLoading(true)
    setResults([])
    setErrorMessage(null)
    try {
      const loaded = await waitForPlugins()
      if (!loaded) {
        setErrorMessage('插件加載中，請稍後再試...')
        setLoading(false)
        return
      }
      const allPlugins = pluginManager.getPlugins()
      const enabledPlugins = allPlugins.filter(p => pluginManager.isPluginEnabled(p.name))
      console.log('[Search] 插件列表:', enabledPlugins.map(p => p.name))
      if (enabledPlugins.length === 0) {
        setErrorMessage('沒有啟用的插件，請先安裝並啟用插件。')
        setLoading(false)
        return
      }
      const allResults = await pluginManager.search(keyword.trim(), searchType)
      console.log('[Search] 結果數量:', allResults.length)
      setResults(allResults)
      if (allResults.length === 0) {
        setErrorMessage(`沒有找到關鍵字「${keyword.trim()}」的搜尋結果。插件已載入 ${allPlugins.length} 個。`)
      }
    } catch (e: any) {
      const msg = `搜尋失敗: ${e.message || String(e)}`
      console.error('Search error:', e)
      setErrorMessage(msg)
      showNotification(msg, 'error')
    } finally {
      setLoading(false)
    }
  }, [keyword, searchType])

  const showNotification = (message: string, type: 'success' | 'error') => {
    setNotification({ message, type })
    setTimeout(() => setNotification(null), 3000)
  }

  const play = async (item: MusicItem) => {
    setPlayingItem(item)
    try {
      const plugin = pluginManager.getPlugin(item.platform)
      if (plugin) {
        const source = await plugin.getMediaSource(item)
        if (source.url) {
          await player.play(source.url)
          setIsPlaying(true)
        } else {
          showNotification('無法獲取音源 URL', 'error')
        }
      } else {
        showNotification('插件未找到', 'error')
      }
    } catch (e) {
      console.error('Get media source error:', e)
      showNotification('播放失敗', 'error')
    }
  }

  const togglePlay = () => {
    player.toggle()
    setIsPlaying(player.isPlaying)
  }

  const handleSearchSubmit = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      search()
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

  const installOfficialPlugin = async (plugin: { name: string; url: string }) => {
    if (pluginManager.getPlugin(plugin.name)) {
      showNotification(`插件 "${plugin.name}" 已安裝`, 'success')
      return
    }
    try {
      setLoading(true)
      const response = await fetch(plugin.url)
      if (!response.ok) throw new Error('Failed to fetch')
      const code = await response.text()
      pluginManager.loadPlugin(code, plugin.name)
      savePluginCode(plugin.name, code)
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
        code: pluginCodes[p.name] || '',
        enabled: pluginManager.isPluginEnabled(p.name)
      }))
      localStorage.setItem('musicfree-plugins', JSON.stringify(pluginData))
    } catch (e) {
      console.error('Failed to save plugins:', e)
    }
  }

  // 依賴 pluginKey 來觸發重渲染，確保商店按鈕狀態正確

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-900 to-purple-900 text-white" style={{ height: '100vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
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
                  onClick={search}
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
                    onClick={() => play(item)}
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
                  </div>
                ))}
              </div>
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
                {OFFICIAL_PLUGINS.map((plugin) => (
                  <div key={plugin.name} className="flex items-center justify-between p-3 bg-gray-800 rounded-lg">
                    <div>
                      <div className="font-medium">{plugin.name}</div>
                      <div className="text-sm text-gray-400">官方插件</div>
                    </div>
                    <button
                      onClick={() => installOfficialPlugin(plugin)}
                      disabled={installedNames.has(plugin.name) || loading}
                      className={`px-3 py-1 rounded text-sm ${
                        installedNames.has(plugin.name)
                          ? 'bg-gray-600 cursor-not-allowed'
                          : 'bg-green-600 hover:bg-green-700'
                      }`}
                    >
                      {installedNames.has(plugin.name) ? '已安裝' : '安裝'}
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
