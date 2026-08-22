/**
 * 蘋果平面風 UI。
 *
 * 設計取向照 iOS 的幾個慣例：大標題、分段控制（segmented control）、
 * 毛玻璃底欄、克制的圓角與陰影、單一強調色（iOS 藍 #0A84FF），
 * 以留白和層次取代邊框。深色底以 iOS 的近黑（#000 / #1C1C1E）為基調，
 * 不用漸層 —— 平面風的重點是乾淨，不是華麗。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { MusicItem } from './../core'
import { formatSize } from './../core/downloads'
import {
  MusicApp,
  pluginManager,
  APP_VERSION,
  PLAY_MODE_ICON,
  PLAY_MODE_LABEL,
  RECOMMEND_CATEGORIES,
  QUALITIES,
} from './../musicApp'
import { t, useLang, setLang, isAutoLang, LANGS, Lang } from './../core/i18n'

/** iOS 風格的分段控制 */
function Segmented<T extends string>({
  options, value, onChange,
}: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex p-0.5 bg-white/10 rounded-[10px] whitespace-nowrap">
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
  item, active, onClick, onDownload, favorite, onToggleFavorite, downloading,
}: {
  item: MusicItem
  active: boolean
  onClick: () => void
  onDownload: () => void
  // 專輯／歌單這類容器沒有收藏的意義，那時不傳這兩個，心心就不出現
  favorite?: boolean
  onToggleFavorite?: () => void
  /** 這首正在下載。無損檔有 30MB＋，沒有回饋使用者不知道到底有沒有在動 */
  downloading?: boolean
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
          {item.title || t('未知曲目')}
        </div>
        <div className="text-[13px] text-white/45 truncate mt-0.5">
          {item.artist || t('未知歌手')}
          {item.type === 'album' && <span className="ml-1.5 text-white/30">· {t('專輯')}</span>}
        </div>
      </div>
      {onToggleFavorite && (
        <button
          onClick={e => { e.stopPropagation(); onToggleFavorite() }}
          title={favorite ? t('取消收藏') : t('收藏')}
          aria-label={favorite ? t('取消收藏') : t('收藏')}
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
        disabled={downloading}
        title={downloading ? t('下載中…') : t('下載')}
        aria-label={downloading ? t('下載中') : t('下載')}
        className={`w-8 h-8 rounded-full flex items-center justify-center transition flex-shrink-0
                    ${downloading
                      ? 'text-[#0A84FF]'
                      : 'text-white/35 hover:text-[#0A84FF] hover:bg-white/10'}`}
      >
        {downloading ? (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="animate-spin">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.6"
              strokeOpacity="0.25" />
            <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="1.6"
              strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 2v8m0 0L5 7m3 3l3-3M3 13h10" stroke="currentColor" strokeWidth="1.6"
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return <div className="px-6 py-16 text-center text-[15px] text-white/35">{text}</div>
}

/**
 * 進度條：可點擊也可拖曳。
 *
 * 用 pointer events 而不是 mouse/touch 兩套：pointerdown/move/up 同時涵蓋滑鼠與
 * 觸控，一份邏輯就好。關鍵是 setPointerCapture —— 沒有它，手指或游標一旦滑出
 * 這個細長的條子，後續事件就跑到別的元素上，拖曳會在中途斷掉。
 *
 * 拖曳期間**不即時 seek**，只更新畫面上的預覽位置，放開才真的跳。理由是每次 seek
 * 都會讓 audio 重新緩衝，邊拖邊 seek 在手機上會卡成一格一格，而且拖過的每個位置
 * 都可能觸發一次網路請求。
 *
 * 拖曳中也不能讓外部的 currentTime 蓋掉手指位置（timeupdate 每秒都在發），
 * 所以有 dragRatio 時一律以它為準。
 */
function ProgressBar({
  currentTime, duration, onSeek, formatTime,
}: {
  currentTime: number
  duration: number
  onSeek: (seconds: number) => void
  formatTime: (s: number) => string
}) {
  const barRef = useRef<HTMLDivElement>(null)
  const [dragRatio, setDragRatio] = useState<number | null>(null)
  const seekable = duration > 0 && Number.isFinite(duration)

  const ratioFromEvent = (clientX: number): number | null => {
    const rect = barRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return null
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!seekable) return
    const r = ratioFromEvent(e.clientX)
    if (r === null) return
    // 抓住指針：滑出條子外面也繼續收到事件，拖曳才不會中途斷掉
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragRatio(r)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRatio === null) return
    const r = ratioFromEvent(e.clientX)
    if (r !== null) setDragRatio(r)
  }

  const finish = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRatio === null) return
    const r = ratioFromEvent(e.clientX) ?? dragRatio
    setDragRatio(null)
    if (seekable) onSeek(r * duration)
  }

  // 拖曳中以手指位置為準，否則跟著播放進度
  const ratio = dragRatio !== null
    ? dragRatio
    : (seekable ? Math.min(1, Math.max(0, currentTime / duration)) : 0)
  const percent = ratio * 100
  const dragging = dragRatio !== null

  return (
    <div
      ref={barRef}
      // py-3 把可觸範圍撐到約 30px 高 —— 3px 的線在手機上根本按不準
      className={`mt-2.5 py-3 group ${seekable ? 'cursor-pointer touch-none' : 'cursor-default'}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      title={seekable ? t('點擊或拖曳跳轉') : ''}
      role="slider"
      aria-label={t('播放進度')}
      aria-valuemin={0}
      aria-valuemax={Math.round(duration) || 0}
      aria-valuenow={Math.round(ratio * (duration || 0))}
    >
      <div className="relative h-[3px] bg-white/15 rounded-full">
        {/* 拖曳中關掉 transition，否則把手會延遲追在手指後面 */}
        <div className={`absolute inset-y-0 left-0 bg-white rounded-full ${dragging ? '' : 'transition-all'}`}
          style={{ width: `${percent}%` }} />
        <div className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full bg-white shadow
                         ${dragging
                           ? 'w-4 h-4 opacity-100'
                           : 'w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity'}`}
          style={{ left: `${percent}%` }} />
        {/* 拖曳中把目標時間浮在把手上方，不然使用者不知道會跳到哪 */}
        {dragging && (
          <div className="absolute -top-7 -translate-x-1/2 px-2 py-0.5 rounded-md bg-[#1C1C1E]
                          border border-white/15 text-[11px] tabular-nums whitespace-nowrap"
            style={{ left: `${percent}%` }}>
            {formatTime(ratio * duration)}
          </div>
        )}
      </div>
    </div>
  )
}

export default function AppleUI({ app }: { app: MusicApp }) {
  // 訂閱語言：切語言時整棵樹重繪，所有 t() 重新取值
  const lang = useLang()
  const {
    albumDetail, albumLoading, albumTracks, applySyncCode, createSyncCode,
    currentTime, currentView, cyclePlayMode, downloads, downloadingKey, duration,
    exportDownload, exportFavorites, favorites,
    formatTime, goBackToSearch, handleDownload, handleItemClick, handleSearchSubmit,
    hasMore, importBusy, importFavorites, importProgress, importText, installPluginFromURL,
    isFavorite, isPlaying, keyword, loadMore, loading,
    loadingMore, lockedItem, notification, play, playMode, playNext, playPrev, playingItem,
    pluginError, pluginKey, pluginName, pluginToggles, pluginUrl, recommendCategory,
    recommendLoading, recommendSongs, recommendUnsupported, removePlugin,
    results, search,
    quality, recommendCaption, refreshRecommend, removeDownload, searchType, seekTo,
    serverVersion,
    setCurrentView, setQuality, setKeyword, setLockedItem, setPluginName, setPluginUrl,
    setImportText, setSearchPage, setSearchType, setSyncInput, switchRecommendCategory,
    syncAvailable, syncBusy,
    syncCode, syncInput, toggleFavorite, togglePlay, togglePlugin,
  } = app

  const tabs = [
    { key: 'recommend' as const, label: t('推薦') },
    { key: 'search' as const, label: t('搜尋') },
    { key: 'favorites' as const, label: t('收藏') },
    { key: 'plugins' as const, label: t('設置') },
  ]
  // 內建與第三方音源不再分開列 —— 安裝方式統一成貼網址，區分它們沒有意義了。
  // 依 pluginKey 重算（安裝／移除／啟用都會遞增它）。
  const installedPlugins = useMemo(() => pluginManager.getPlugins(), [pluginKey])
  /**
   * 設置頁裡的「已下載歌曲」子頁面。純畫面導覽，所以留在這一層而不是進狀態層。
   * 切到別的分頁再回來時要回到設置根頁 —— 不然使用者會納悶自己怎麼在子頁面裡。
   */
  const [showDownloads, setShowDownloads] = useState(false)
  useEffect(() => {
    if (currentView !== 'plugins') setShowDownloads(false)
  }, [currentView])

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
      {/*
        「這首沒有音源」的提示。刻意**不是**全螢幕遮罩對話框：它只是說明、不需要
        任何決定，3 秒就自己關（見 musicApp 的 showLocked）。原本的遮罩會在那 3 秒
        內擋住整個畫面，連想換下一首都點不到 —— 那才是真的影響使用。
        現在是浮動卡片，底下照樣可以操作、正在播的歌也不受影響。
      */}
      {lockedItem && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 w-[min(92vw,22rem)]
                        pointer-events-none">
          <div className="pointer-events-auto bg-[#1C1C1E]/95 backdrop-blur-xl rounded-[14px]
                          px-4 py-3 border border-white/10 shadow-2xl flex items-start gap-3"
            onClick={() => setLockedItem(null)}>
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none"
              className="text-[#FF9F0A] flex-shrink-0 mt-0.5">
              <path d="M8 5.5v3.2M8 11h.01M8 1.8 1.6 13.2h12.8L8 1.8z" stroke="currentColor"
                strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div className="min-w-0">
              <div className="text-[14px] font-medium">{t('此曲目無可用音源')}</div>
              <div className="text-[13px] text-white/50 mt-0.5 leading-snug">
                {t('「{title}」在所有子音源都取不到播放位址，換一首試試。', { title: lockedItem.title })}
              </div>
            </div>
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
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h1 className="text-[34px] font-bold tracking-tight leading-tight">{t('推薦')}</h1>
                    {/*
                      副標是**音源回報**的來源說明，不是 app 寫死的 —— app 不知道
                      任何音源用了什麼榜單。音源沒給說明就不顯示這一行。
                    */}
                    {recommendCaption && (
                      <p className="text-[15px] text-white/45 mt-0.5">{recommendCaption}</p>
                    )}
                  </div>
                  {/*
                    重新整理。有了快取之後這個按鈕才有存在必要 —— 清單可能是幾小時前
                    存下來的，使用者想看最新的得有辦法強制重抓。
                  */}
                  <button onClick={refreshRecommend} disabled={recommendLoading}
                    title={t('重新整理')} aria-label={t('重新整理')}
                    className="mt-2 w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0
                               text-white/45 hover:text-white hover:bg-white/10 active:opacity-60
                               disabled:opacity-30 transition">
                    <svg width="17" height="17" viewBox="0 0 16 16" fill="none"
                      className={recommendLoading ? 'animate-spin' : ''}>
                      <path d="M14 8a6 6 0 1 1-1.76-4.24M14 2v4h-4" stroke="currentColor"
                        strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>
                {/*
                  一排五個標籤，一個分類一份榜單。沒有第二個軸。
                  overflow-x-auto 是保險：標籤文字依語言長短不一（各語言已用縮寫），
                  萬一仍放不下，只在這一列內部滾動，絕不把整頁撐寬。
                */}
                <div className="mt-4 overflow-x-auto">
                  <Segmented
                    value={recommendCategory}
                    onChange={c => switchRecommendCategory(c)}
                    options={RECOMMEND_CATEGORIES.map(c => ({ value: c.value, label: t(c.label) }))}
                  />
                </div>
              </div>
              {recommendLoading && recommendSongs.length === 0 && <EmptyState text={t('載入中…')} />}
              {!recommendLoading && recommendSongs.length === 0 && (
                <EmptyState text={recommendUnsupported
                  ? t('推薦需要音源，請到「設置」頁安裝。')
                  : t('尚無推薦曲目。')} />
              )}
              <div className="divide-y divide-white/[0.06]">
                {recommendSongs.map(item => (
                  <Row
                    key={`${item.platform}-${item.id}`}
                    item={item}
                    active={playingItem?.id === item.id}
                    onClick={() => handleItemClick(item)}
                    onDownload={() => handleDownload(item)}
                    downloading={downloadingKey === `${item.platform || ''}::${item.id}`}
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
                <h1 className="text-[34px] font-bold tracking-tight leading-tight">{t('收藏')}</h1>
                <p className="text-[15px] text-white/45 mt-0.5">
                  {favorites.length > 0 ? t('{n} 首 · 依序播放', { n: favorites.length }) : t('存在這台裝置上')}
                </p>
              </div>
              {favorites.length === 0 && (
                <EmptyState text={t('還沒有收藏。點曲目右邊的心心加進來，或到「設置」頁匯入歌單。')} />
              )}
              <div className="divide-y divide-white/[0.06]">
                {favorites.map(item => (
                  <Row
                    key={`${item.platform}-${item.id}`}
                    item={item}
                    active={playingItem?.id === item.id}
                    onClick={() => handleItemClick(item)}
                    onDownload={() => handleDownload(item)}
                    downloading={downloadingKey === `${item.platform || ''}::${item.id}`}
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
                <h1 className="text-[34px] font-bold tracking-tight leading-tight">{t('搜尋')}</h1>
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
                      placeholder={t('歌曲、歌手或專輯')}
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
                    {t('搜尋')}
                  </button>
                </div>

              </div>
              {loading && <EmptyState text={t('搜尋中…')} />}
              {!loading && results.length === 0 && (
                <EmptyState text={pluginManager.getEnabledPlugins().length === 0
                  ? t('搜尋需要音源，請到「設置」頁安裝。')
                  : keyword.trim() ? t('找不到符合的結果。') : t('輸入關鍵字開始搜尋。')} />
              )}
              <div className="divide-y divide-white/[0.06]">
                {results.map(item => (
                  <Row
                    key={`${item.platform}-${item.id}`}
                    item={item}
                    active={playingItem?.id === item.id}
                    onClick={() => handleItemClick(item)}
                    onDownload={() => handleDownload(item)}
                    downloading={downloadingKey === `${item.platform || ''}::${item.id}`}
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
                    {loadingMore ? t('載入中…') : t('載入更多')}
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
                  {t('返回')}
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
                      {albumDetail.title || t('未知專輯')}
                    </h1>
                    <p className="text-[15px] text-white/45 truncate mt-0.5">{albumDetail.artist}</p>
                    <p className="text-[13px] text-white/30 mt-1">{t('{n} 首', { n: albumTracks.length })}</p>
                  </div>
                </div>
              </div>
              {albumLoading && <EmptyState text={t('載入中…')} />}
              {!albumLoading && albumTracks.length === 0 && <EmptyState text={t('此專輯沒有曲目。')} />}
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
                    downloading={downloadingKey === `${track.platform || ''}::${track.id}`}
                    favorite={isFavorite(track)}
                    onToggleFavorite={() => toggleFavorite(track)}
                  />
                ))}
              </div>
            </>
          )}

          {/* ── 設置 › 已下載歌曲 ── */}
          {currentView === 'plugins' && showDownloads && (
            <div className="px-4 pt-6 pb-4">
              <button onClick={() => setShowDownloads(false)}
                className="flex items-center gap-1 text-[15px] text-[#0A84FF] active:opacity-60 mb-5">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.8"
                    strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {t('設置')}
              </button>
              <h1 className="text-[34px] font-bold tracking-tight leading-tight">{t('已下載歌曲')}</h1>
              <p className="text-[15px] text-white/45 mt-0.5">
                {t('{n} 首 · 存在 App 的儲存空間', { n: downloads.length })}
              </p>

              {downloads.length === 0 ? (
                <EmptyState text={t('還沒有下載的歌曲。點曲目右邊的下載鈕存到裝置。')} />
              ) : (
                <>
                  <div className="mt-6 rounded-[14px] bg-white/[0.07] overflow-hidden
                                  divide-y divide-white/[0.06]">
                    {downloads.map(d => (
                      <div key={d.key} className="p-4 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-[15px] truncate">{d.title}</div>
                          <div className="text-[13px] text-white/45 truncate mt-0.5">
                            {d.artist || t('未知歌手')}
                          </div>
                          <div className="flex items-center gap-2 mt-1.5">
                            {/* 顯示**實際**存下來的音質 —— 音源沒有高音質版本時會降級，
                                寫「你選的那檔」會是騙人的 */}
                            {d.bitrate && (
                              <span className="px-1.5 py-0.5 rounded-md bg-[#0A84FF]/20 text-[#0A84FF]
                                               text-[11px] font-medium tabular-nums">
                                {d.bitrate} kbps
                              </span>
                            )}
                            <span className="text-[11px] text-white/30 tabular-nums">
                              {formatSize(d.size)}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button onClick={() => exportDownload(d)}
                            title={t('匯出')} aria-label={t('匯出')}
                            className="px-3.5 py-1.5 rounded-full bg-white/15 text-[13px] font-medium
                                       active:opacity-70 transition">
                            {t('匯出')}
                          </button>
                          <button onClick={() => removeDownload(d)}
                            title={t('刪除')} aria-label={t('刪除')}
                            className="px-3.5 py-1.5 rounded-full bg-[#FF453A]/20 text-[#FF453A]
                                       text-[13px] font-medium active:opacity-70 transition">
                            {t('刪除')}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="text-[12px] text-white/30 mt-2 px-1 leading-relaxed">
                    {t('「匯出」會開啟系統分享面板，可以存到「檔案」、雲端硬碟或傳給別人。')}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── 設置 ── */}
          {currentView === 'plugins' && !showDownloads && (
            <div className="px-4 pt-8 pb-4">
              <h1 className="text-[34px] font-bold tracking-tight leading-tight">{t('設置')}</h1>
              <p className="text-[15px] text-white/45 mt-0.5">{t('音質、音源、歌單與同步')}</p>

              {/*
                音質。播放與下載共用同一個設定 —— 選了 999，下載也是 999。
                五檔是上游實際支援的階梯（見 musicApp 的 QUALITIES）。

                用原生 <select> 而不是自己做選單：收起來只佔一行（原本五列把整個
                設置頁的第一屏都吃掉了），而且系統選單在手機上的可用性本來就比
                自製的好 —— 有原生滾輪、鍵盤操作、無障礙支援。
              */}
              <div className="mt-6">
                <div className="text-[13px] font-medium text-white/45 uppercase tracking-wide px-1 mb-2">
                  {t('音質')}
                </div>
                <div className="rounded-[14px] bg-white/[0.07] px-4 py-3
                                flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[15px]">{t('播放與下載')}</div>
                    <div className="text-[13px] text-white/40 mt-0.5">
                      {t(QUALITIES.find(q => q.value === quality)?.hint || '')}
                    </div>
                  </div>
                  <div className="relative flex-shrink-0">
                    <select
                      value={quality}
                      onChange={e => setQuality(e.currentTarget.value as typeof quality)}
                      aria-label={t('音質')}
                      className="appearance-none bg-white/15 rounded-[10px] pl-3 pr-8 py-2
                                 text-[15px] tabular-nums outline-none active:opacity-70
                                 focus:bg-white/20 transition cursor-pointer"
                    >
                      {QUALITIES.map(q => (
                        // 深色底下原生選單的選項由系統算繪，明確給底色才不會白底白字
                        <option key={q.value} value={q.value} className="bg-[#1C1C1E] text-white">
                          {q.label}
                        </option>
                      ))}
                    </select>
                    {/* 自己畫箭頭：appearance-none 之後系統的箭頭就沒了 */}
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none
                                 text-white/50">
                      <path d="M2.5 4.5L6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.6"
                        strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                </div>
                <div className="text-[12px] text-white/30 mt-2 px-1 leading-relaxed">
                  {t('下載也用這個音質。不是每首歌都有高音質版本，取不到時音源會退到可用的。')}
                </div>
              </div>

              {/*
                語言。預設跟隨系統語言，手動選了就記住（localStorage）。
                用原生 <select>，理由同音質：一行收納，系統選單可用性最好。
                選項顯示各語言自己的名字 —— 找母語的人不用先看懂目前的語言。
              */}
              <div className="mt-6">
                <div className="text-[13px] font-medium text-white/45 uppercase tracking-wide px-1 mb-2">
                  {t('語言')}
                </div>
                <div className="rounded-[14px] bg-white/[0.07] px-4 py-3
                                flex items-center justify-between gap-3">
                  <div className="text-[15px]">{t('語言')}</div>
                  <div className="relative flex-shrink-0">
                    <select
                      value={isAutoLang() ? 'auto' : lang}
                      onChange={e => setLang(e.currentTarget.value as Lang | 'auto')}
                      aria-label={t('語言')}
                      className="appearance-none bg-white/15 rounded-[10px] pl-3 pr-8 py-2
                                 text-[15px] outline-none active:opacity-70
                                 focus:bg-white/20 transition cursor-pointer"
                    >
                      <option value="auto" className="bg-[#1C1C1E] text-white">{t('跟隨系統')}</option>
                      {LANGS.map(l => (
                        <option key={l.value} value={l.value} className="bg-[#1C1C1E] text-white">
                          {l.label}
                        </option>
                      ))}
                    </select>
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none
                                 text-white/50">
                      <path d="M2.5 4.5L6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.6"
                        strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                </div>
              </div>

              {pluginError && (
                <div className="mt-5 p-3.5 rounded-[12px] bg-[#FF453A]/15 border border-[#FF453A]/30">
                  <div className="text-[14px] text-[#FF453A]">{pluginError}</div>
                </div>
              )}
              {installedPlugins.length === 0 && !pluginError && (
                <div className="mt-5 p-3.5 rounded-[12px] bg-[#0A84FF]/15 border border-[#0A84FF]/25">
                  <div className="text-[14px] font-medium text-[#0A84FF]">{t('尚未安裝音源')}</div>
                  <div className="text-[13px] text-white/55 mt-0.5 leading-relaxed">
                    {t('在下方貼上音源網址並安裝，之後即可搜尋與播放。')}
                  </div>
                </div>
              )}

              {/* 從網址安裝 —— 唯一的安裝方式 */}
              <div className="mt-5">
                <div className="text-[13px] font-medium text-white/45 uppercase tracking-wide px-1 mb-2">
                  {t('從網址安裝')}
                </div>
                <div className="rounded-[14px] bg-white/[0.07] p-4 space-y-2.5">
                  <input value={pluginUrl} onChange={e => setPluginUrl(e.currentTarget.value)}
                    placeholder={t('音源網址')}
                    className="w-full px-3 py-2.5 bg-black/30 rounded-[10px] text-[15px]
                               placeholder:text-white/30 outline-none focus:bg-black/50 transition" />
                  <input value={pluginName} onChange={e => setPluginName(e.currentTarget.value)}
                    placeholder={t('名稱（選填，留空則用音源自報的名稱）')}
                    className="w-full px-3 py-2.5 bg-black/30 rounded-[10px] text-[15px]
                               placeholder:text-white/30 outline-none focus:bg-black/50 transition" />
                  <button onClick={installPluginFromURL} disabled={loading || !pluginUrl.trim()}
                    className="w-full py-2.5 rounded-[10px] bg-[#0A84FF] text-[15px] font-medium
                               disabled:opacity-40 active:opacity-70 transition">
                    {loading ? t('安裝中…') : t('安裝')}
                  </button>
                  {/*
                    這裡刻意**不**提供任何音源網址。這個 app 不隨附音源、產物裡
                    沒有任何音源檔，也不預設任何來源 —— 音源要用哪一個由使用者
                    自己決定並提供。播放器只認插件介面，不認任何特定音源。
                  */}
                  <div className="text-[12px] text-white/30 leading-relaxed">
                    {pluginUrl.trim()
                      ? t('安裝後即可搜尋與播放。')
                      : t('本 App 不附帶音源。請貼上你自己的音源網址。')}
                  </div>
                </div>
              </div>

              {/* 已安裝的音源 */}
              <div className="mt-6">
                <div className="text-[13px] font-medium text-white/45 uppercase tracking-wide px-1 mb-2">
                  {t('已安裝')}
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
                          {pluginToggles[p.name] !== false ? t('已啟用') : t('已停用')}
                        </button>
                        <button onClick={() => removePlugin(p.name)}
                          className="px-3.5 py-1.5 rounded-full bg-[#FF453A]/20 text-[#FF453A]
                                     text-[13px] font-medium active:opacity-70 transition">
                          {t('移除')}
                        </button>
                      </div>
                    </div>
                  ))}
                  {installedPlugins.length === 0 && (
                    <div className="px-4 py-6 text-center text-[14px] text-white/30">{t('尚無音源')}</div>
                  )}
                </div>
              </div>

              {/*
                歌單匯出／匯入。匯出成 Markdown：任何文字編輯器、筆記軟體、聊天
                視窗都能直接看，這是「越通用越好」的意思。檔尾另藏一段 HTML 註解
                裡的 JSON，Markdown 算繪時看不到，但匯入本站時能精確還原、不必
                逐首重新搜尋 —— 給人看的通用格式與給程式看的精確還原不必二選一。
                匯入也吃任何純文字清單（「歌名 - 歌手」一行一首），那才是別人給
                你一串歌時真正用得到的路徑。
              */}
              {/*
                已下載歌曲的入口。清單放在子頁面而不是攤在這裡 —— 下載多了以後
                這一頁會被它整個佔滿，而設置頁的主體是設定，不是資料。
                只有 App 版有清單（網頁版的下載交給瀏覽器另存，存到哪裡我們無從得知）。
              */}
              {downloads.length > 0 && (
                <div className="mt-6">
                  <button onClick={() => setShowDownloads(true)}
                    className="w-full rounded-[14px] bg-white/[0.07] px-4 py-3.5 flex items-center
                               justify-between gap-3 active:bg-white/10 md:hover:bg-white/[0.1]
                               transition-colors text-left">
                    <div className="min-w-0">
                      <div className="text-[15px]">{t('已下載歌曲')}</div>
                      <div className="text-[13px] text-white/40 mt-0.5">{t('{n} 首', { n: downloads.length })}</div>
                    </div>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
                      className="text-white/30 flex-shrink-0">
                      <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.8"
                        strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>
              )}

              <div className="mt-6">
                <div className="text-[13px] font-medium text-white/45 uppercase tracking-wide px-1 mb-2">
                  {t('歌單')}
                </div>
                <div className="rounded-[14px] bg-white/[0.07] p-4 space-y-4">
                  <div>
                    <button onClick={exportFavorites} disabled={favorites.length === 0}
                      className="w-full py-3 rounded-[11px] bg-white/15 text-[15px] font-medium
                                 active:opacity-70 disabled:opacity-40 transition">
                      {t('匯出收藏（.md）')}
                    </button>
                    <div className="text-[12px] text-white/40 mt-2 px-1">
                      {favorites.length > 0
                        ? t('目前 {n} 首。純文字格式，任何地方都打得開。', { n: favorites.length })
                        : t('還沒有收藏可以匯出。')}
                    </div>
                  </div>

                  <div className="h-px bg-white/[0.08]" />

                  <div className="space-y-2">
                    <textarea value={importText} onChange={e => setImportText(e.target.value)}
                      rows={4} spellCheck={false}
                      placeholder={t('貼上歌單，一行一首：\n月亮代表我 — moon tang\n或直接選擇匯出的 .md 檔')}
                      className="w-full px-4 py-3 rounded-[11px] bg-white/[0.07] text-[14px]
                                 placeholder:text-white/30 outline-none focus:bg-white/10 transition
                                 resize-none leading-relaxed" />
                    <div className="flex gap-2">
                      <label className="flex-1 py-3 rounded-[11px] bg-white/15 text-[15px] font-medium
                                        text-center cursor-pointer active:opacity-70 transition">
                        {t('選擇檔案')}
                        <input type="file" accept=".md,.txt,text/*" className="hidden"
                          onChange={async e => {
                            const file = e.target.files?.[0]
                            if (!file) return
                            setImportText(await file.text())
                            // 清掉 value，選同一個檔案第二次才會再觸發 change
                            e.target.value = ''
                          }} />
                      </label>
                      <button onClick={() => importFavorites(importText)}
                        disabled={importBusy || !importText.trim()}
                        className="flex-1 py-3 rounded-[11px] bg-[#0A84FF] text-[15px] font-medium
                                   active:opacity-70 disabled:opacity-40 transition">
                        {importBusy ? t('比對中 {progress}', { progress: importProgress }) : t('匯入收藏')}
                      </button>
                    </div>
                    <div className="text-[12px] text-white/40 px-1">
                      {t('純文字清單會逐首用音源搜尋比對，找不到的會列出來。')}
                    </div>
                  </div>
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
                    {t('換裝置')}
                  </div>
                  <div className="rounded-[14px] bg-white/[0.07] p-4 space-y-4">
                    <div>
                      <button onClick={createSyncCode} disabled={syncBusy}
                        className="w-full py-3 rounded-[11px] bg-white/15 text-[15px] font-medium
                                   active:opacity-70 disabled:opacity-40 transition">
                        {t('產生同步碼')}
                      </button>
                      {syncCode && (
                        <div className="mt-3 text-center">
                          <div className="text-[26px] font-semibold tracking-[0.2em] tabular-nums">
                            {syncCode.slice(0, 4)}-{syncCode.slice(4)}
                          </div>
                          <div className="text-[12px] text-white/40 mt-1">
                            {t('在另一台裝置輸入這組碼。24 小時後失效。')}
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="h-px bg-white/[0.08]" />
                    <div className="space-y-2">
                      <input value={syncInput} onChange={e => setSyncInput(e.target.value)}
                        placeholder={t('輸入另一台裝置的同步碼')}
                        autoCapitalize="characters" autoCorrect="off" spellCheck={false}
                        className="w-full px-4 py-3 rounded-[11px] bg-white/[0.07] text-[15px]
                                   tracking-[0.15em] placeholder:tracking-normal
                                   placeholder:text-white/30 outline-none focus:bg-white/10 transition" />
                      <button onClick={applySyncCode} disabled={syncBusy || !syncInput.trim()}
                        className="w-full py-3 rounded-[11px] bg-[#0A84FF] text-[15px] font-medium
                                   active:opacity-70 disabled:opacity-40 transition">
                        {t('套用')}
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
                  {t('版本')}
                </div>
                <div className="rounded-[14px] bg-white/[0.07] overflow-hidden divide-y divide-white/[0.06]">
                  <div className="px-4 py-3 flex items-center justify-between gap-3">
                    <span className="text-[14px] text-white/70">{t('前端')}</span>
                    <span className="text-[13px] tabular-nums text-white/45">{APP_VERSION}</span>
                  </div>
                  <div className="px-4 py-3 flex items-center justify-between gap-3">
                    <span className="text-[14px] text-white/70">{t('後端')}</span>
                    <span className="text-[13px] tabular-nums text-white/45">
                      {serverVersion === null ? t('無法取得') : serverVersion}
                    </span>
                  </div>
                  {serverVersion && serverVersion !== APP_VERSION && (
                    <div className="px-4 py-3 text-[12px] text-[#FFD60A] leading-relaxed">
                      {t('前後端戳記不一致 —— 可能只部署了一半，或瀏覽器還留著舊的前端。')}
                      {' '}{t('硬重載一次；若仍不同，重新部署。')}
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
              <div className="text-[14px] font-medium truncate">{playingItem?.title || t('未在播放')}</div>
              <div className="text-[12px] text-white/45 truncate">
                {playingItem?.artist || t('選擇曲目開始播放')}
              </div>
            </div>
          </div>

          <ProgressBar
            currentTime={currentTime}
            duration={duration}
            onSeek={seekTo}
            formatTime={formatTime}
          />

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
            <button onClick={playPrev} aria-label={t('上一首')}
              className="absolute left-1/2 -translate-x-[calc(50%+44px)] w-9 h-9 rounded-full
                         flex items-center justify-center text-white/70 active:bg-white/10 transition">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                <path d="M11 2v10L4.5 7 11 2z" /><rect x="2" y="2" width="1.8" height="10" rx="0.9" />
              </svg>
            </button>
            <button onClick={togglePlay}
              aria-label={isPlaying ? t('暫停') : t('播放')}
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
            <button onClick={playNext} aria-label={t('下一首')}
              className="absolute left-1/2 translate-x-[calc(-50%+44px)] w-9 h-9 rounded-full
                         flex items-center justify-center text-white/70 active:bg-white/10 transition">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                <path d="M3 2v10l6.5-5L3 2z" /><rect x="10.2" y="2" width="1.8" height="10" rx="0.9" />
              </svg>
            </button>
            <div className="ml-auto flex items-center gap-2.5">
              <span className="text-[11px] tabular-nums text-white/45">{formatTime(duration)}</span>
              <button onClick={cyclePlayMode} title={t(PLAY_MODE_LABEL[playMode])}
                aria-label={t(PLAY_MODE_LABEL[playMode])}
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
          {tabs.map(tab => (
            <button key={tab.key}
              onClick={() => setCurrentView(tab.key)}
              className={`flex-1 py-2.5 text-[11px] font-medium transition-colors ${
                currentView === tab.key ? 'text-[#0A84FF]' : 'text-white/40'
              }`}>
              {tab.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
