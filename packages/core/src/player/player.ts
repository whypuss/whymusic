/**
 * 最小 HTML5 Audio Player
 * 不做 Zustand，直接 event emitter
 */
export class Player {
  private audio: HTMLAudioElement
  private listeners: Map<string, Array<(...args: any[]) => void>>

  constructor() {
    this.audio = new Audio()
    this.listeners = new Map()
    
    // 自動通知外部
    this.audio.addEventListener('play', () => this.emit('play'))
    this.audio.addEventListener('pause', () => this.emit('pause'))
    this.audio.addEventListener('ended', () => this.emit('ended'))
    this.audio.addEventListener('timeupdate', () => this.emit('timeupdate', this.audio.currentTime, this.audio.duration))
    this.audio.addEventListener('error', (e) => this.emit('error', e))
    this.audio.addEventListener('canplay', () => this.emit('canplay', this.audio.duration))
  }

  /** 播放指定 URL */
  async play(url: string): Promise<void> {
    this.audio.src = url
    return this.audio.play()
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
