/**
 * 原本的 UI（深藍漸層）。JSX 與 App.tsx 拆分前完全一致，只是改由 hook 取狀態。
 * 保留它是為了能與新版 UI 並存比較，不必為了換皮放棄已驗證過的介面。
 */
import { MusicItem, SearchType } from './../core'
import { MusicApp } from './../musicApp'
import { pluginManager, OFFICIAL_PLUGIN_NAME, OFFICIAL_PLUGIN_URL, PLAY_MODE_ICON, PLAY_MODE_LABEL } from './../musicApp'

export default function ClassicUI({ app, onSwitchUi }: { app: MusicApp; onSwitchUi: () => void }) {
  const {
    albumDetail,
    albumLoading,
    albumTracks,
    currentTime,
    currentView,
    cyclePlayMode,
    duration,
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
    loadMore,
    loading,
    loadingMore,
    lockedItem,
    notification,
    officialInstalled,
    play,
    playMode,
    playingItem,
    pluginError,
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
    search,
    searchType,
    setCurrentView,
    setKeyword,
    setLockedItem,
    setPluginName,
    setPluginUrl,
    setSearchPage,
    setSearchType,
    switchRecommendMode,
    togglePlay,
    togglePlugin,
  } = app

  return (
    <div className="bg-gradient-to-br from-sky-800 to-indigo-900 text-white" style={{ height: 'var(--app-height, 100vh)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
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
        <div className="flex items-center gap-2">
          <img
            src="/logo.png"
            alt="WhyMusic"
            className="w-8 h-8 rounded-md object-cover"
          />
          <h1 className="text-xl font-bold">WhyMusic</h1>
        </div>
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
                          // 帶上專輯脈絡：某首無源時可跳下一首，播完也依序接續
                          const trackWithCtx = { ...track, _albumDetail: albumDetail, _trackIndex: idx }
                          play(trackWithCtx, { list: albumTracks, index: idx, isAlbum: true })
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
                  <div className="text-center text-gray-500 py-10">
                    {recommendUnsupported
                      ? '推薦需要音源。請到下方「插件」頁安裝。'
                      : '尚無推薦歌曲。'}
                  </div>
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
          {/*
            播放鍵用絕對定位置中，而非靠 flex/grid 分欄：只要左右兩側內容寬度不等
            （右側多了循環鍵），分欄算出的中欄位置就會有視覺偏移。
          */}
          <div className="relative flex items-center h-10 max-w-2xl mx-auto">
            <span className="text-sm text-gray-400">{formatTime(currentTime)}</span>
            <button
              onClick={togglePlay}
              aria-label={isPlaying ? '暫停' : '播放'}
              className="absolute left-1/2 -translate-x-1/2 p-2 rounded-full bg-blue-600 hover:bg-blue-700"
            >
              {isPlaying ? '⏸' : '▶'}
            </button>
            <div className="ml-auto flex items-center gap-3">
              <span className="text-sm text-gray-400">{formatTime(duration)}</span>
              <button
                onClick={cyclePlayMode}
                title={PLAY_MODE_LABEL[playMode]}
                aria-label={PLAY_MODE_LABEL[playMode]}
                className={`px-2 py-1 rounded text-base leading-none ${
                  playMode === 'off'
                    ? 'bg-gray-700 hover:bg-gray-600 text-gray-400'
                    : 'bg-blue-600/80 hover:bg-blue-600'
                }`}
              >
                {PLAY_MODE_ICON[playMode]}
              </button>
            </div>
          </div>
          <div className="text-center text-xs text-gray-500 mt-1">
            {PLAY_MODE_LABEL[playMode]}
            <button onClick={onSwitchUi} className="ml-3 underline hover:text-gray-300">
              切換至新版介面
            </button>
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

