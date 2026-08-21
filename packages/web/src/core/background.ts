/**
 * App 版的背景播放橋。網頁版整個模組是 no-op —— 瀏覽器裡背景續播與鎖屏控制
 * 由 navigator.mediaSession 負責（musicApp 已經接了），這裡處理的是 WebView
 * 環境缺的那一塊：
 *
 *   - 關屏後歌與歌的交界：音訊一停 CPU 就能睡，「取下一首、play()」的 JS
 *     沒機會跑。原生前台服務 + wakelock 撐過去。
 *   - 國產 ROM（vivo／一加…）判定「音樂 App」看的是原生 MediaSession，
 *     WebView 內部的 navigator.mediaSession 它們看不見 —— 沒有它就沒有
 *     鎖屏控制、沒有媒體通知，還容易被系統殺掉。
 *
 * 介面對齊 musicApp 已有的 mediaActions（play/pause/next/prev/seek），
 * 原生按鍵事件直接轉發給同一組 handler，兩個宿主一份邏輯。
 */
import { registerPlugin } from '@capacitor/core'
import { isNative } from './native'

export type NativeMediaState = {
  title: string
  artist: string
  playing: boolean
  positionSec: number
  durationSec: number
}

export type NativeControlEvent = {
  action: 'play' | 'pause' | 'next' | 'previous' | 'seek'
  seekTime?: number
}

interface BackgroundPlaybackPlugin {
  update(state: NativeMediaState): Promise<void>
  stop(): Promise<void>
  addListener(event: 'control', cb: (e: NativeControlEvent) => void): Promise<{ remove: () => void }>
}

const plugin = isNative()
  ? registerPlugin<BackgroundPlaybackPlugin>('BackgroundPlayback')
  : null

/** 推送目前的播放狀態給原生側（換歌、播放、暫停、跳轉時呼叫） */
export function syncNativeMedia(state: NativeMediaState): void {
  plugin?.update(state).catch(e => console.warn('[background] update 失敗:', e))
}

/** 結束播放工作階段：服務、通知、wakelock 一起收掉 */
export function stopNativeMedia(): void {
  plugin?.stop().catch(e => console.warn('[background] stop 失敗:', e))
}

/** 訂閱鎖屏／通知欄的控制按鍵 */
export function onNativeControl(cb: (e: NativeControlEvent) => void): void {
  plugin?.addListener('control', cb)
    .catch(e => console.warn('[background] 監聽失敗:', e))
}
