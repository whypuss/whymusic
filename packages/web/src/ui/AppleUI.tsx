/**
 * 蘋果平面風 UI。
 *
 * 設計取向照 iOS 的幾個慣例：大標題、分段控制（segmented control）、
 * 毛玻璃底欄、克制的圓角與陰影、單一強調色（iOS 藍 #0A84FF），
 * 以留白和層次取代邊框。深色底以 iOS 的近黑（#000 / #1C1C1E）為基調，
 * 不用漸層 —— 平面風的重點是乾淨，不是華麗。
 */
import { useMemo } from 'react'
import { MusicItem } from './../core'
import {
  MusicApp,
  pluginManager,
  APP_VERSION,
  OFFICIAL_PLUGIN_URL,
  PLAY_MODE_ICON,
  PLAY_MODE_LABEL,
} from './../musicApp'

/** iOS 風格的分段控制 */
function Segmented<T extends string>({
  options, value, onChange,
}: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex p-0.5 bg-white/10 rounded-[10px]">
      {options.map(o => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`px-4 py-1.5 text-[13px] font-medium rounded-[8px] transition-all ${
            value === o.value
              ? 'bg-white/95 text-black shadow-sm'
              : 'text-white/60 hover:text-white/90'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** 歌曲／專輯列。用微妙的分隔線而非卡片邊框，接近 iOS 的 list */
function Row({
  item, active, onClick, onDownload, favorite, onToggleFavorite,
}: {
  item: MusicItem
  active: boolean
  onClick: () => void
  onDownload: () => void
  // 專輯／歌單這類容器沒有收藏的意義，那時不傳這兩個，心心就不出現
  favorite?: boolean
  onToggleFavorite?: () => void
}) {
  return (
    <div
      onClick={onClick}
      className={`group flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
        active ? 'bg-[#0A84FF]/15' : 'active:bg-white/10 md:hover:bg-white/[0.06]'
      }`}
    >
      {/*
        首字永遠鋪在底層、封面疊在上面。只在有 artwork 時才顯示首字的話，
        圖片載入前那一兩秒會是純黑方塊，看起來像壞掉。
      */}
      <div className={`relative w-11 h-11 rounded-[8px] flex items-center justify-center flex-shrink-0
                       text-[15px] font-semibold overflow-hidden ${
        active ? 'bg-[#0A84FF] text-white' : 'bg-white/10 text-white/70'
      }`}>
        <span>{(item.title || '♪')[0]}</span>
        {item.artwork && (
          <img src={item.artwork} alt="" loading="lazy"
            className="absolute inset-0 w-full h-full object-cover" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className={`text-[15px] leading-tight truncate ${active ? 'text-[#0A84FF] font-medium' : 'text-white'}`}>
          {item.title || '未知曲目'}
        </div>
        <div className="text-[13px] text-white/45 truncate mt-0.5">
          {item.artist || '未知歌手'}
          {item.type === 'album' && <span className="ml-1.5 text-white/30">· 專輯</span>}
        </div>
      </div>
      {onToggleFavorite && (
        <button
          onClick={e => { e.stopPropagation(); onToggleFavorite() }}
          title={favorite ? '取消收藏' : '收藏'}
          aria-label={favorite ? '取消收藏' : '收藏'}
          aria-pressed={favorite}
          className={`w-8 h-8 rounded-full flex items-center justify-center transition flex-shrink-0
                      hover:bg-white/10 ${favorite ? 'text-[#FF375F]' : 'text-white/35 hover:text-[#FF375F]'}`}
        >
          {/* 已收藏填滿、未收藏只有描邊 —— 靠顏色分辨在深色背景上不夠清楚 */}
          <svg width="17" height="17" viewBox="0 0 16 16"
            fill={favorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5">
            <path d="M8 13.5S2 10 2 6.2A3.2 3.2 0 0 1 8 4.6a3.2 3.2 0 0 1 6 1.6C14 10 8 13.5 8 13.5z"
              strokeLinejoin="round" />
          </svg>
        </button>
      )}
      <button
        onClick={e => { e.stopPropagation(); onDownload() }}
        title="下載"
        className="w-8 h-8 rounded-full flex items-center justify-center text-white/35 hover:text-[#0A84FF] hover:bg-white/10 transition flex-shrink-0"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M8 2v8m0 0L5 7m3 3l3-3M3 13h10" stroke="currentColor" strokeWidth="1.6"
            strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return <div className="px-6 py-16 text-center text-[15px] text-white/35">{text}</div>
}

export default function AppleUI({ app }: { app: MusicApp }) {
  const {
    albumDetail, albumLoading, albumTracks, applySyncCode, createSyncCode,
    currentTime, currentView, cyclePlayMode, duration, favorites,
    formatTime, goBackToSearch, handleDownload, handleItemClick, handleSearchSubmit, handleSeek,
    hasMore, installPluginFromURL, isFavorite, isPlaying, keyword, loadMore, loading,
    loadingMore, lockedItem, notification, play, playMode, playNext, playPrev, playingItem,
    pluginError, pluginKey, pluginName, pluginToggles, pluginUrl, recommendLoading, recommendMode,
    recommendSongs, recommendUnsupported, removePlugin, results, search,
    searchType, serverVersion, setCurrentView, setKeyword, setLockedItem, setPluginName, setPluginUrl,
    setSearchPage, setSearchType, setSyncInput, switchRecommendMode, syncAvailable, syncBusy,
    syncCode, syncInput, toggleFavorite, togglePlay, togglePlugin,
  } = app

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0
  const tabs = [
    { key: 'recommend' as const, label: '推薦' },
    { key: 'search' as const, label: '搜尋' },
    { key: 'favorites' as const, label: '收藏' },
    { key: 'plugins' as const, label: '音源' },
  ]
  // 內建與第三方音源不再分開列 —— 安裝方式統一成貼網址，區分它們沒有意義了。
  // 依 pluginKey 重算（安裝／移除／啟用都會遞增它）。
  const installedPlugins = useMemo(() => pluginManager.getPlugins(), [pluginKey])

  return (
    <div
      className="bg-black text-white flex flex-col"
      style={{
        // 用 index.html 定義的 --app-height（dvh，手機才會真正滿版）
        height: 'var(--app-height, 100vh)',
        overflow: 'hidden',
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", "PingFang TC", "Microsoft JhengHei", sans-serif',
      }}
    >
      {/* 頂部標題列。毛玻璃 + 安全區內距，內容捲動時仍可見 */}
      <header
        className="flex-shrink-0 border-b border-white/[0.08] bg-black/70 backdrop-blur-xl"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <div className="max-w-2xl mx-auto px-4 h-11 flex items-center gap-2">
          <img
            src="/logo.png"
            alt="W"
            className="w-[22px] h-[22px] rounded-[6px] object-cover"
          />
          <span className="text-[16px] font-semibold tracking-tight">WhyMusic</span>
        </div>
      </header>
      {/* 通知：iOS 風格的浮動膠囊 */}
      {notification && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-[14px]
                        bg-[#1C1C1E]/95 backdrop-blur-xl border border-white/10 shadow-2xl
                        text-[14px] max-w-[90vw]">
          <span className={
            notification.type === 'error' ? 'text-[#FF453A]'
              : notification.type === 'success' ? 'text-[#30D158]' : 'text-white/90'
          }>
            {notification.message}
          </span>
        </div>
      )}

      {/* 無音源曲目提示 */}
      {lockedItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm"
          onClick={() => setLockedItem(null)}>
          <div className="bg-[#1C1C1E] rounded-[18px] p-6 max-w-sm w-full text-center border border-white/10"
            onClick={e => e.stopPropagation()}>
            <div className="text-[17px] font-semibold mb-1.5">此曲目無可用音源</div>
            <div className="text-[14px] text-white/55 mb-5 leading-relaxed">
              「{lockedItem.title}」在目前所有子音源都取不到播放位址，換一首試試。
            </div>
            <button onClick={() => setLockedItem(null)}
              className="w-full py-2.5 rounded-[12px] bg-[#0A84FF] text-[15px] font-medium active:opacity-70">
              好
            </button>
          </div>
        </div>
      )}

      {/* 內容區 */}
      <div className="flex-1 overflow-y-auto overscroll-contain">
        <div className="max-w-2xl mx-auto pb-4">

          {/* ── 推薦 ── */}
          {currentView === 'recommend' && (
            <>
              <div className="px-4 pt-8 pb-4">
                <h1 className="text-[34px] font-bold tracking-tight leading-tight">推薦</h1>
                <p className="text-[15px] text-white/45 mt-0.5">香港粵語流行榜</p>
                <div className="mt-4">
                  <Segmented
                    value={recommendMode}
                    onChange={m => switchRecommendMode(m)}
                    options={[{ value: 'new', label: '最新' }, { value: 'hot', label: '熱門' }]}
                  />
                </div>
              </div>
              {recommendLoading && recommendSongs.length === 0 && <EmptyState text="載入中…" />}
              {!recommendLoading && recommendSongs.length === 0 && (
                <EmptyState text={recommendUnsupported
                  ? '推薦需要音源，請到「音源」頁安裝。'
                  : '尚無推薦曲目。'} />
              )}
              <div className="divide-y divide-white/[0.06]">
                {recommendSongs.map(item => (
                  <Row
                    key={`${item.platform}-${item.id}`}
                    item={item}
                    active={playingItem?.id === item.id}
                    onClick={() => handleItemClick(item)}
                    onDownload={() => handleDownload(item)}
                    favorite={isFavorite(item)}
                    onToggleFavorite={() => toggleFavorite(item)}
                  />
                ))}
              </div>
            </>
          )}

          {/* ── 收藏 ── */}
          {currentView === 'favorites' && (
            <>
              <div className="px-4 pt-8 pb-4">
                <h1 className="text-[34px] font-bold tracking-tight leading-tight">收藏</h1>
                <p className="text-[15px] text-white/45 mt-0.5">
                  {favorites.length > 0 ? `${favorites.length} 首 · 依序播放` : '存在這台裝置上'}
                </p>
              </div>
              {favorites.length === 0 && (
                <EmptyState text="還沒有收藏。點曲目右邊的心心加進來。" />
              )}
              <div className="divide-y divide-white/[0.06]">
                {favorites.map(item => (
                  <Row
                    key={`${item.platform}-${item.id}`}
                    item={item}
                    active={playingItem?.id === item.id}
                    onClick={() => handleItemClick(item)}
                    onDownload={() => handleDownload(item)}
                    favorite
                    onToggleFavorite={() => toggleFavorite(item)}
                  />
                ))}
              </div>
            </>
          )}

          {/* ── 搜尋 ── */}
          {currentView === 'search' && !albumDetail && (
            <>
              <div className="px-4 pt-8 pb-4">
                <h1 className="text-[34px] font-bold tracking-tight leading-tight">搜尋</h1>
                <div className="mt-4 flex gap-2">
                  <div className="flex-1 relative">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-white/35">
                      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.6" />
                      <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    </svg>
                    <input
                      value={keyword}
                      onChange={e => setKeyword(e.currentTarget.value)}
                      onKeyDown={handleSearchSubmit}
                      placeholder="歌曲、歌手或專輯"
                      className="w-full pl-9 pr-3 py-2.5 bg-white/10 rounded-[12px] text-[16px]
                                 placeholder:text-white/35 outline-none focus:bg-white/[0.14] transition"
                    />
                  </div>
                  <button
                    onClick={() => { setSearchPage(1); search(1) }}
                    disabled={loading || !keyword.trim()}
                    className="px-4 rounded-[12px] bg-[#0A84FF] text-[15px] font-medium
                               disabled:opacity-40 active:opacity-70 transition"
                  >
                    搜尋
                  </button>
                </div>

              </div>
              {loading && <EmptyState text="搜尋中…" />}
              {!loading && results.length === 0 && (
                <EmptyState text={pluginManager.getEnabledPlugins().length === 0
                  ? '搜尋需要音源，請到「音源」頁安裝。'
                  : keyword.trim() ? '找不到符合的結果。' : '輸入關鍵字開始搜尋。'} />
              )}
              <div className="divide-y divide-white/[0.06]">
                {results.map(item => (
                  <Row
                    key={`${item.platform}-${item.id}`}
                    item={item}
                    active={playingItem?.id === item.id}
                    onClick={() => handleItemClick(item)}
                    onDownload={() => handleDownload(item)}
                    // 專輯／歌單是容器，收藏它沒有意義（收藏頁要能直接播）
                    favorite={item.type === 'music' ? isFavorite(item) : undefined}
                    onToggleFavorite={item.type === 'music' ? () => toggleFavorite(item) : undefined}
                  />
                ))}
              </div>
              {results.length > 0 && hasMore && (
                <div className="px-4 py-5">
                  <button onClick={loadMore} disabled={loadingMore}
                    className="w-full py-2.5 rounded-[12px] bg-white/10 text-[15px]
                               disabled:opacity-40 active:opacity-70 transition">
                    {loadingMore ? '載入中…' : '載入更多'}
                  </button>
                </div>
              )}
            </>
          )}

          {/* ── 專輯詳情 ── */}
          {albumDetail && (
            <>
              <div className="px-4 pt-6 pb-4">
                <button onClick={goBackToSearch}
                  className="flex items-center gap-1 text-[15px] text-[#0A84FF] active:opacity-60 mb-5">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.8"
                      strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  返回
                </button>
                <div className="flex gap-4 items-end">
                  <div className="w-24 h-24 rounded-[12px] bg-white/10 flex-shrink-0 overflow-hidden
                                  flex items-center justify-center text-2xl">
                    {albumDetail.artwork
                      ? <img src={albumDetail.artwork} alt="" className="w-full h-full object-cover" />
                      : '♪'}
                  </div>
                  <div className="min-w-0">
                    <h1 className="text-[24px] font-bold leading-tight truncate">
                      {albumDetail.title || '未知專輯'}
                    </h1>
                    <p className="text-[15px] text-white/45 truncate mt-0.5">{albumDetail.artist}</p>
                    <p className="text-[13px] text-white/30 mt-1">{albumTracks.length} 首</p>
                  </div>
                </div>
              </div>
              {albumLoading && <EmptyState text="載入中…" />}
              {!albumLoading && albumTracks.length === 0 && <EmptyState text="此專輯沒有曲目。" />}
              <div className="divide-y divide-white/[0.06]">
                {albumTracks.map((track, idx) => (
                  <Row
                    key={`${track.id}-${idx}`}
                    item={track}
                    active={playingItem?.id === track.id}
                    onClick={() => play(
                      { ...track, _albumDetail: albumDetail, _trackIndex: idx },
                      { list: albumTracks, index: idx, order: 'sequential' },
                    )}
                    onDownload={() => handleDownload(track)}
                    favorite={isFavorite(track)}
                    onToggleFavorite={() => toggleFavorite(track)}
                  />
                ))}
              </div>
            </>
          )}

          {/* ── 音源 ── */}
          {currentView === 'plugins' && (
            <div className="px-4 pt-8 pb-4">
              <h1 className="text-[34px] font-bold tracking-tight leading-tight">音源</h1>
              <p className="text-[15px] text-white/45 mt-0.5">安裝音源後才能搜尋與播放</p>

              {pluginError && (
                <div className="mt-5 p-3.5 rounded-[12px] bg-[#FF453A]/15 border border-[#FF453A]/30">
                  <div className="text-[14px] text-[#FF453A]">{pluginError}</div>
                </div>
              )}
              {installedPlugins.length === 0 && !pluginError && (
                <div className="mt-5 p-3.5 rounded-[12px] bg-[#0A84FF]/15 border border-[#0A84FF]/25">
                  <div className="text-[14px] font-medium text-[#0A84FF]">尚未安裝音源</div>
                  <div className="text-[13px] text-white/55 mt-0.5 leading-relaxed">
                    在下方貼上音源網址並安裝，之後即可搜尋與播放。
                  </div>
                </div>
              )}

              {/* 從網址安裝 —— 唯一的安裝方式 */}
              <div className="mt-5">
                <div className="text-[13px] font-medium text-white/45 uppercase tracking-wide px-1 mb-2">
                  從網址安裝
                </div>
                <div className="rounded-[14px] bg-white/[0.07] p-4 space-y-2.5">
                  <input value={pluginUrl} onChange={e => setPluginUrl(e.currentTarget.value)}
                    placeholder="音源網址"
                    className="w-full px-3 py-2.5 bg-black/30 rounded-[10px] text-[15px]
                               placeholder:text-white/30 outline-none focus:bg-black/50 transition" />
                  <input value={pluginName} onChange={e => setPluginName(e.currentTarget.value)}
                    placeholder="名稱（選填，留空則用音源自報的名稱）"
                    className="w-full px-3 py-2.5 bg-black/30 rounded-[10px] text-[15px]
                               placeholder:text-white/30 outline-none focus:bg-black/50 transition" />
                  <button onClick={installPluginFromURL} disabled={loading || !pluginUrl.trim()}
                    className="w-full py-2.5 rounded-[10px] bg-[#0A84FF] text-[15px] font-medium
                               disabled:opacity-40 active:opacity-70 transition">
                    {loading ? '安裝中…' : '安裝'}
                  </button>
                  <div className="text-[12px] text-white/30 leading-relaxed">
                    {pluginUrl.trim()
                      ? '由本站後端代抓，你的網路不必連得到託管站。'
                      : '先填入音源網址才能安裝。'}
                  </div>
                  {/*
                    內建音源的網址列在這裡（可點擊填入），而不是做成一顆安裝按鈕。
                    否則清掉瀏覽器資料後沒人知道該貼什麼，等於死路。
                  */}
                  <button onClick={() => setPluginUrl(OFFICIAL_PLUGIN_URL)}
                    className="text-[12px] text-[#0A84FF] active:opacity-60 break-all text-left">
                    內建音源：{OFFICIAL_PLUGIN_URL}
                  </button>
                </div>
              </div>

              {/* 已安裝的音源 */}
              <div className="mt-6">
                <div className="text-[13px] font-medium text-white/45 uppercase tracking-wide px-1 mb-2">
                  已安裝
                </div>
                <div className="rounded-[14px] bg-white/[0.07] overflow-hidden divide-y divide-white/[0.06]">
                  {installedPlugins.map(p => (
                    <div key={p.name} className="p-4 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[15px] font-medium truncate">{p.name}</div>
                        <div className="text-[13px] text-white/45">v{p.version || '?'}</div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button onClick={() => togglePlugin(p.name)}
                          className={`px-3.5 py-1.5 rounded-full text-[13px] font-medium transition ${
                            pluginToggles[p.name] !== false
                              ? 'bg-[#30D158] text-black' : 'bg-white/15 text-white/70'
                          }`}>
                          {pluginToggles[p.name] !== false ? '已啟用' : '已停用'}
                        </button>
                        <button onClick={() => removePlugin(p.name)}
                          className="px-3.5 py-1.5 rounded-full bg-[#FF453A]/20 text-[#FF453A]
                                     text-[13px] font-medium active:opacity-70 transition">
                          移除
                        </button>
                      </div>
                    </div>
                  ))}
                  {installedPlugins.length === 0 && (
                    <div className="px-4 py-6 text-center text-[14px] text-white/30">尚無音源</div>
                  )}
                </div>
              </div>

              {/*
                裝置同步。音源是存在瀏覽器的 localStorage 裡（綁裝置 × 瀏覽器 ×
                網域），換一台就得重裝。這裡用一組 24 小時後自動失效的配對碼把
                「你選了哪些音源」搬過去，不需要帳號也不留任何個人資料。
                後端沒綁 SYNC KV 時整區隱藏 —— 不顯示一個按了必定失敗的按鈕。
              */}
              {syncAvailable && (
                <div className="mt-6">
                  <div className="text-[13px] font-medium text-white/45 uppercase tracking-wide px-1 mb-2">
                    換裝置
                  </div>
                  <div className="rounded-[14px] bg-white/[0.07] p-4 space-y-4">
                    <div>
                      <button onClick={createSyncCode} disabled={syncBusy}
                        className="w-full py-3 rounded-[11px] bg-white/15 text-[15px] font-medium
                                   active:opacity-70 disabled:opacity-40 transition">
                        產生同步碼
                      </button>
                      {syncCode && (
                        <div className="mt-3 text-center">
                          <div className="text-[26px] font-semibold tracking-[0.2em] tabular-nums">
                            {syncCode.slice(0, 4)}-{syncCode.slice(4)}
                          </div>
                          <div className="text-[12px] text-white/40 mt-1">
                            在另一台裝置輸入這組碼。24 小時後失效。
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="h-px bg-white/[0.08]" />
                    <div className="space-y-2">
                      <input value={syncInput} onChange={e => setSyncInput(e.target.value)}
                        placeholder="輸入另一台裝置的同步碼"
                        autoCapitalize="characters" autoCorrect="off" spellCheck={false}
                        className="w-full px-4 py-3 rounded-[11px] bg-white/[0.07] text-[15px]
                                   tracking-[0.15em] placeholder:tracking-normal
                                   placeholder:text-white/30 outline-none focus:bg-white/10 transition" />
                      <button onClick={applySyncCode} disabled={syncBusy || !syncInput.trim()}
                        className="w-full py-3 rounded-[11px] bg-[#0A84FF] text-[15px] font-medium
                                   active:opacity-70 disabled:opacity-40 transition">
                        套用
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/*
                版本資訊。前端與後端各報一個建置戳記 —— 換版後看到舊行為時，
                先看這裡就知道是「沒部署成功」還是「瀏覽器快取沒更新」。
                兩者不一致代表只部署了一半（例如前端上去了但 worker 沒有）。
              */}
              <div className="mt-6">
                <div className="text-[13px] font-medium text-white/45 uppercase tracking-wide px-1 mb-2">
                  版本
                </div>
                <div className="rounded-[14px] bg-white/[0.07] overflow-hidden divide-y divide-white/[0.06]">
                  <div className="px-4 py-3 flex items-center justify-between gap-3">
                    <span className="text-[14px] text-white/70">前端</span>
                    <span className="text-[13px] tabular-nums text-white/45">{APP_VERSION}</span>
                  </div>
                  <div className="px-4 py-3 flex items-center justify-between gap-3">
                    <span className="text-[14px] text-white/70">後端</span>
                    <span className="text-[13px] tabular-nums text-white/45">
                      {serverVersion === null ? '無法取得' : serverVersion}
                    </span>
                  </div>
                  {serverVersion && serverVersion !== APP_VERSION && (
                    <div className="px-4 py-3 text-[12px] text-[#FFD60A] leading-relaxed">
                      前後端戳記不一致 —— 可能只部署了一半，或瀏覽器還留著舊的前端。
                      硬重載一次；若仍不同，重新部署。
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── 播放器：毛玻璃底欄 ── */}
      <div
        className="flex-shrink-0 border-t border-white/[0.08] bg-[#1C1C1E]/80 backdrop-blur-2xl"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div className="max-w-2xl mx-auto px-4 pt-3 pb-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[8px] bg-white/10 flex-shrink-0 overflow-hidden
                            flex items-center justify-center text-[15px] font-semibold text-white/60">
              {playingItem?.artwork
                ? <img src={playingItem.artwork} alt="" className="w-full h-full object-cover" />
                : (playingItem?.title || '♪')[0]}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-medium truncate">{playingItem?.title || '未在播放'}</div>
              <div className="text-[12px] text-white/45 truncate">
                {playingItem?.artist || '選擇曲目開始播放'}
              </div>
            </div>
          </div>

          {/* 進度條：可點擊跳轉 */}
          <div className="mt-2.5 py-2 cursor-pointer group" onClick={handleSeek} title="點擊跳轉">
            <div className="relative h-[3px] bg-white/15 rounded-full">
              <div className="absolute inset-y-0 left-0 bg-white rounded-full transition-all"
                style={{ width: `${progress}%` }} />
              <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full
                              bg-white shadow opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ left: `${progress}%` }} />
            </div>
          </div>

          {/*
            播放鍵用絕對定位置中（left-1/2 + -translate-x-1/2），而非靠 flex/grid
            分欄。理由：只要左右兩側內容寬度不等（這裡右側多了循環鍵），分欄佈局
            算出來的中欄位置就會有視覺偏移；絕對定位是相對容器中線，與兩側內容無關。
          */}
          <div className="relative h-11 flex items-center">
            <span className="text-[11px] tabular-nums text-white/45">{formatTime(currentTime)}</span>
            {/*
              三顆一組絕對定位置中：播放鍵在正中線，前後曲各偏 44px。
              用固定偏移而非 flex，兩側的時間與循環鍵才不會把它們推歪。
            */}
            <button onClick={playPrev} aria-label="上一首"
              className="absolute left-1/2 -translate-x-[calc(50%+44px)] w-9 h-9 rounded-full
                         flex items-center justify-center text-white/70 active:bg-white/10 transition">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                <path d="M11 2v10L4.5 7 11 2z" /><rect x="2" y="2" width="1.8" height="10" rx="0.9" />
              </svg>
            </button>
            <button onClick={togglePlay}
              aria-label={isPlaying ? '暫停' : '播放'}
              className="absolute left-1/2 -translate-x-1/2 w-11 h-11 rounded-full bg-white text-black
                         flex items-center justify-center active:scale-95 transition-transform">
              {isPlaying
                ? <svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor">
                    <rect x="3" y="2" width="3.2" height="11" rx="1" />
                    <rect x="8.8" y="2" width="3.2" height="11" rx="1" />
                  </svg>
                : <svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor">
                    <path d="M4 2.5v10l9-5-9-5z" />
                  </svg>}
            </button>
            <button onClick={playNext} aria-label="下一首"
              className="absolute left-1/2 translate-x-[calc(-50%+44px)] w-9 h-9 rounded-full
                         flex items-center justify-center text-white/70 active:bg-white/10 transition">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                <path d="M3 2v10l6.5-5L3 2z" /><rect x="10.2" y="2" width="1.8" height="10" rx="0.9" />
              </svg>
            </button>
            <div className="ml-auto flex items-center gap-2.5">
              <span className="text-[11px] tabular-nums text-white/45">{formatTime(duration)}</span>
              <button onClick={cyclePlayMode} title={PLAY_MODE_LABEL[playMode]}
                aria-label={PLAY_MODE_LABEL[playMode]}
                className={`w-8 h-8 rounded-full flex items-center justify-center text-[15px] transition ${
                  playMode === 'off' ? 'text-white/30 active:bg-white/10' : 'text-[#0A84FF] bg-[#0A84FF]/15'
                }`}>
                {PLAY_MODE_ICON[playMode]}
              </button>
            </div>
          </div>
        </div>

        {/* 分頁 */}
        <div className="flex border-t border-white/[0.08]">
          {tabs.map(t => (
            <button key={t.key}
              onClick={() => setCurrentView(t.key)}
              className={`flex-1 py-2.5 text-[11px] font-medium transition-colors ${
                currentView === t.key ? 'text-[#0A84FF]' : 'text-white/40'
              }`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
