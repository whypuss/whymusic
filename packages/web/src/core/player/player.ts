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
    this.listeners = new Map()

    // 自動通知外部
    this.audio.addEventListener('play', () => this.emit('play'))
    this.audio.addEventListener('pause', () => this.emit('pause'))
    this.audio.addEventListener('ended', () => this.emit('ended'))
    this.audio.addEventListener('timeupdate', () => this.emit('timeupdate', this.audio.currentTime, this.audio.duration))
    this.audio.addEventListener('error', (e) => this.emit('error', e))
    this.audio.addEventListener('canplay', () => this.emit('canplay', this.audio.duration))
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
      // 普通音頻（mp3/aac 等）— 一律走代理繞過 CORS
      const proxiedUrl = `/api/proxy?url=${encodeURIComponent(url)}&method=GET`
      this.audio.src = proxiedUrl
      return this.audio.play()
    }
  }

  /** 暫停 */
  pause(): void {
    this.audio.pause()
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
