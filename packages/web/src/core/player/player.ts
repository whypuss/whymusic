/**
 * 最小 HTML5 Audio Player
 * 支持 HLS (m3u8) 播放 — 用於猫耳FM 等返回 HLS 音源的插件
 */
import Hls from 'hls.js'

export class Player {
  private audio: HTMLAudioElement
  private listeners: Map<string, Array<(...args: any[]) => void>>
  private hls: Hls | null = null

  constructor() {
    this.audio = new Audio()
    this.audio.crossOrigin = 'anonymous'
    // iOS Safari：沒有 playsInline 會嘗試接管成全螢幕播放器，背景播放也更容易被中斷。
    // TS 的 HTMLAudioElement 型別沒有這個屬性（規格上屬 HTMLVideoElement），
    // 但 iOS 的 audio 元素確實會讀它，所以在執行時設。
    ;(this.audio as any).playsInline = true
    // 讓瀏覽器盡量預先緩衝。手機切到背景後 JS 會被凍結，緩衝越多越不容易斷
    this.audio.preload = 'auto'
    this.attachToDocument()
    this.listeners = new Map()

    // 自動通知外部
    this.audio.addEventListener('play', () => this.emit('play'))
    this.audio.addEventListener('pause', () => this.emit('pause'))
    this.audio.addEventListener('ended', () => this.emit('ended'))
    this.audio.addEventListener('timeupdate', () => this.emit('timeupdate', this.audio.currentTime, this.audio.duration))
    this.audio.addEventListener('error', (e) => this.emit('error', e))
    this.audio.addEventListener('canplay', () => this.emit('canplay', this.audio.duration))
  }

  /**
   * 把 audio 元素掛進文件裡（隱藏）。
   *
   * `new Audio()` 產生的元素從未進入 DOM 也「允許」繼續播放，但 Chrome 官方文件
   * 把掛進文件列為最可靠的配置 —— Android 的媒體通知需要 Android audio focus，
   * 而 detached 元素在這條路上是未定義行為。iOS Safari 對此寬鬆，所以會出現
   * 「iOS 有鎖屏播放介面、Android 沒有」這種只在單邊出現的症狀。
   *
   * 掛上去之後絕對不能再移除：規格規定元素一旦被移出文件，UA 必須暫停它。
   *
   * 不必也不該自己設 display:none —— Chrome 的 UA 樣式表本來就有
   * `audio:not([controls]) { display: none }`，實測掛上去之後 computed style 就是
   * none。（曾經懷疑「未被算繪」會讓 Android 忽略這個元素，這個猜測是錯的：若
   * 成立，全世界純音訊網站都不會有媒體通知。）
   */
  private attachToDocument(): void {
    if (typeof document === 'undefined') return
    const mount = () => {
      if (!this.audio.isConnected) document.body.appendChild(this.audio)
    }
    if (document.body) {
      mount()
    } else {
      // Player 可能在模組載入時就 new 出來，那時 body 還不存在
      document.addEventListener('DOMContentLoaded', mount, { once: true })
    }
  }

  /** 清理 HLS 實例 */
  private destroyHls(): void {
    if (this.hls) {
      this.hls.destroy()
      this.hls = null
    }
  }

  /** 播放指定 URL（支持 HLS m3u8） */
  async play(url: string): Promise<void> {
    // 清理舊的 HLS 實例
    this.destroyHls()

    // 判斷是否為 HLS (m3u8)
    const isHls = url.includes('.m3u8')

    if (isHls && Hls.isSupported()) {
      // HLS 播放：hls.js 需要直接訪問 m3u8 URL
      // 配置 xhrSetup 將所有 HLS 請求（m3u8 + segments）走後端代理
      // 注意：xhrSetup 如果 reject，hls.js 會 fallback 到原 URL（不走代理），所以必须成功
      this.hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        xhrSetup: (xhr, hlsUrl) => {
          const proxyUrl = `/api/proxy?url=${encodeURIComponent(hlsUrl)}&method=GET`
          xhr.open('GET', proxyUrl, true)
          xhr.setRequestHeader('Referer', 'https://www.missevan.com/')
          xhr.setRequestHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
          // 不要 return Promise — 讓 hls.js 的 xhrSetup promise 成功 resolve，不會 fallback
        },
      })
      this.hls.loadSource(url)
      this.hls.attachMedia(this.audio)

      return new Promise((resolve, reject) => {
        this.hls!.on(Hls.Events.MANIFEST_PARSED, () => {
          console.log('[player] HLS manifest parsed, duration:', this.audio.duration)
          this.audio.play().then(resolve).catch(reject)
        })
        this.hls!.on(Hls.Events.ERROR, (_, data) => {
          console.warn('[player] HLS error:', data.type, data.details, data.response?.url)
          if (data.fatal) {
            console.error('[player] HLS fatal error, destroying and trying fallback')
            this.destroyHls()
            reject(new Error(`HLS playback failed: ${data.details}`))
          }
        })
        // 10 秒超時保護
        setTimeout(() => {
          if (!this.audio.paused) return
          console.warn('[player] HLS play timeout')
          this.destroyHls()
          reject(new Error('HLS play timeout'))
        }, 10000)
      })
    } else if (isHls && this.audio.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari 原生支持 HLS
      this.audio.src = url
      return this.audio.play()
    } else {
      // 普通音頻（mp3/aac 等）— 跨域音源走代理繞過 CORS。
      // 同源 URL（後端 /api/play 等串流端點）不能再包一層代理：/api/proxy 會把
      // url 參數丟給 fetch，而相對路徑不是合法的 fetch 目標，會直接 Invalid URL。
      const isSameOrigin = url.startsWith('/') || url.startsWith(window.location.origin)
      this.audio.src = isSameOrigin
        ? url
        : `/api/proxy?url=${encodeURIComponent(url)}&method=GET`
      return this.audio.play()
    }
  }

  /** 暫停 */
  pause(): void {
    this.audio.pause()
  }

  /**
   * 續播目前這首（不重新載入音源）。
   * 給 MediaSession 的 play 動作用 —— 鎖定畫面按播放時不該重新解析音源，
   * 那會多一次網路往返，而背景中的網路請求正是最容易失敗的環節。
   */
  resume(): Promise<void> {
    return this.audio.play()
  }

  /** 切換播放/暫停 */
  toggle(): void {
    if (this.audio.paused) {
      this.audio.play()
    } else {
      this.audio.pause()
    }
  }

  /** 取得當前播放時間 */
  get currentTime(): number {
    return this.audio.currentTime
  }

  /** 取得總時長 */
  get duration(): number {
    return this.audio.duration
  }

  /** 取得是否正在播放 */
  get isPlaying(): boolean {
    return !this.audio.paused && !this.audio.ended && this.audio.readyState > 2
  }

  /** 取得音量 */
  get volume(): number {
    return this.audio.volume
  }

  /** 設置音量 */
  set volume(v: number) {
    this.audio.volume = v
  }

  /** 跳轉到指定時間 */
  seekTo(t: number): void {
    this.audio.currentTime = t
  }

  /**
   * 單曲循環。用 audio 原生 loop 而不是在 ended 事件裡重播，
   * 因為重播要重新解析音源 URL，會有可聽出來的空隙。
   * 注意：loop 為 true 時瀏覽器不會發 ended 事件。
   */
  setLoop(loop: boolean): void {
    this.audio.loop = loop
  }

  get loop(): boolean {
    return this.audio.loop
  }

  /** 訂閱事件 */
  on(event: string, cb: (...args: any[]) => void): () => void {
    this.listeners.set(event, [...(this.listeners.get(event) || []), cb])
    return () => this.off(event, cb)
  }

  /** 取消訂閱 */
  off(event: string, cb: (...args: any[]) => void): void {
    const list = this.listeners.get(event)
    if (list) {
      this.listeners.set(event, list.filter(f => f !== cb))
    }
  }

  private emit(event: string, ...args: any[]): void {
    this.listeners.get(event)?.forEach(cb => cb(...args))
  }
}
