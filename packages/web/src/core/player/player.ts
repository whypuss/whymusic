/**
 * 最小 HTML5 Audio Player（雙元素輪替）
 *
 * 為什麼要兩個 audio 元素而不是一個換 src：
 *   iOS 鎖屏時前一首播得好好的，一換下一首就沒聲音（鎖屏介面仍顯示播放中）。
 *   原因是在背景把新的 src 塞進 audio 元素會讓 iOS 的音訊工作階段失效，而背景中
 *   沒有使用者手勢能把它重新啟動。同一個機制也會讓 Android 「播幾首就停」。
 *
 *   所以下一首在前台就先載進另一個元素，換歌時只對一個「已經播過、已經載好」的
 *   元素呼叫 play()，完全不動 src、不需要網路 —— 這是背景續播唯一穩的做法。
 *
 */
import { viaProxy } from '../native'

/**
 * 0.05 秒的靜音 WAV（8kHz/8-bit/單聲道，自己產的，不依賴任何外部資源）。
 * 用途是「解鎖」第二個元素：iOS 要求每個 audio 元素的首次播放必須源於使用者手勢，
 * 沒播過的元素在背景 play() 會被拒。第一次點播放時順手拿這段靜音把它播一下再暫停，
 * 之後它就能在背景被程式喚起。
 */
const SILENT_WAV = 'data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YZABAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA'

export class Player {
  /** 兩個輪替使用的元素。哪一個是「當前」由 currentIndex 決定 */
  private elements: HTMLAudioElement[]
  private currentIndex = 0
  private listeners: Map<string, Array<(...args: any[]) => void>>
  /** 已預載到閒置元素上的下一首。url 是原始音源位址，比對用 */
  private preloaded: { url: string; el: HTMLAudioElement } | null = null
  private unlocked = false
  /** 單曲循環的狀態。換元素時要帶過去，否則切歌後循環就失效了 */
  private loopFlag = false

  constructor() {
    this.listeners = new Map()
    this.elements = [this.createElement(), this.createElement()]
  }

  /** 當前正在（或即將）發聲的元素 */
  private get audio(): HTMLAudioElement {
    return this.elements[this.currentIndex]
  }

  /** 閒置的那一個，用來預載下一首 */
  private get idleEl(): HTMLAudioElement {
    return this.elements[1 - this.currentIndex]
  }

  private createElement(): HTMLAudioElement {
    const el = new Audio()
    el.crossOrigin = 'anonymous'
    // iOS Safari：沒有 playsInline 會嘗試接管成全螢幕播放器，背景播放也更容易被中斷。
    // TS 的 HTMLAudioElement 型別沒有這個屬性（規格上屬 HTMLVideoElement），
    // 但 iOS 的 audio 元素確實會讀它，所以在執行時設。
    ;(el as any).playsInline = true
    // 讓瀏覽器盡量預先緩衝。手機切到背景後 JS 會被凍結，緩衝越多越不容易斷
    el.preload = 'auto'
    this.attachToDocument(el)

    // 事件只從「當前」元素往外發。閒置元素的解鎖、預載都會發事件，
    // 若不過濾會讓 app 以為使用者在播放或暫停。
    const forward = (event: string, args: () => any[] = () => []) => {
      el.addEventListener(event, () => {
        if (el !== this.audio) return
        this.emit(event, ...args())
      })
    }
    forward('play')
    forward('pause')
    forward('ended')
    forward('timeupdate', () => [el.currentTime, el.duration])
    forward('canplay', () => [el.duration])
    el.addEventListener('error', (e) => {
      if (el !== this.audio) return
      this.emit('error', e)
    })
    return el
  }

  /**
   * 把 audio 元素掛進文件裡。
   *
   * `new Audio()` 產生的元素從未進入 DOM 也「允許」繼續播放，但 Chrome 官方文件
   * 把掛進文件列為最可靠的配置 —— Android 的媒體通知需要 Android audio focus，
   * 而 detached 元素在這條路上是未定義行為。
   *
   * 掛上去之後絕對不能再移除：規格規定元素一旦被移出文件，UA 必須暫停它。
   *
   * 不必也不該自己設 display:none —— Chrome 的 UA 樣式表本來就有
   * `audio:not([controls]) { display: none }`，實測掛上去之後 computed style 就是
   * none。（曾經懷疑「未被算繪」會讓 Android 忽略這個元素，這個猜測是錯的：若
   * 成立，全世界純音訊網站都不會有媒體通知。）
   */
  private attachToDocument(el: HTMLAudioElement): void {
    if (typeof document === 'undefined') return
    const mount = () => {
      if (!el.isConnected) document.body.appendChild(el)
    }
    if (document.body) {
      mount()
    } else {
      // Player 可能在模組載入時就 new 出來，那時 body 還不存在
      document.addEventListener('DOMContentLoaded', mount, { once: true })
    }
  }

  /**
   * 解鎖閒置元素，讓它之後能在背景被程式喚起。
   *
   * **必須在使用者手勢的同步階段呼叫** —— 也就是點擊處理函式裡任何 await 之前。
   * 當前元素會因為真的播放而自然解鎖，所以只需要處理閒置的那一個，而且只做一次：
   * 換歌輪替之後，舊的當前元素本來就播過了。
   */
  unlock(): void {
    if (this.unlocked) return
    this.unlocked = true
    const el = this.idleEl
    el.src = SILENT_WAV
    const p = el.play()
    if (p) p.then(() => el.pause()).catch(() => { /* 解鎖失敗不影響當前播放 */ })
  }

  /**
   * 跨域音源要不要走代理。同源不能再包一層（代理只吃絕對 URL），
   * 原生 App 裡也不包 —— 那邊沒有後端，WebView 直接允許 cleartext。
   * 判斷邏輯集中在 core/native.ts，兩處行為才不會走鐘。
   */
  private resolveSrc(url: string): string {
    return viaProxy(url)
  }

  /**
   * 把下一首載進閒置元素。前台呼叫（配合 app 的預取），這樣鎖屏換歌時
   * 不需要任何網路動作，也不必動 src。
   */
  preload(url: string): void {
    if (!url) return
    if (this.preloaded?.url === url) return
    const el = this.idleEl
    // 閒置元素不該帶著循環旗標，否則輪替過去之後行為會不一致
    el.loop = false
    el.src = this.resolveSrc(url)
    el.load()
    this.preloaded = { url, el }
  }

  /** 輪替到已預載好的元素並播放。不動 src、不需要網路 */
  private async playPreloaded(el: HTMLAudioElement): Promise<void> {
    const prev = this.audio
    this.currentIndex = this.elements.indexOf(el)
    this.preloaded = null
    prev.pause()
    el.loop = this.loopFlag
    // 同一個元素可能上一輪播過，src 相同時 currentTime 不會自動歸零
    if (el.currentTime > 0.01) el.currentTime = 0
    await el.play()
  }

  /** 播放指定 URL */
  async play(url: string): Promise<void> {
    // 這首正是預載好的那一首 → 走輪替，這是背景續播唯一穩的路徑
    const ready = this.preloaded
    if (ready && ready.url === url && ready.el !== this.audio) {
      return await this.playPreloaded(ready.el)
    }
    // 換了別的歌（使用者手動點選、或換子源重試），預載的那份就作廢了
    this.preloaded = null

    this.audio.src = this.resolveSrc(url)
    return this.audio.play()
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

  /**
   * 是否正在播放。
   *
   * 刻意不看 readyState —— 「正在緩衝」仍然是正在播放。原本這裡要求
   * readyState > 2，於是剛換到還沒緩衝好的新音源時會回 false，UI 就顯示成暫停，
   * 明明聲音在放（實測在 Android 上重現：時間在跑但按鈕是播放三角）。
   */
  get isPlaying(): boolean {
    return !this.audio.paused && !this.audio.ended
  }

  /** 目前是否暫停。給呼叫端在 toggle 前判斷「這一下是要播還是要停」 */
  get paused(): boolean {
    return this.audio.paused
  }

  /** 取得音量。注意 iOS 上這個值改不動，Apple 規定只能用實體按鍵控制 */
  get volume(): number {
    return this.audio.volume
  }

  /** 設置音量 */
  set volume(v: number) {
    for (const el of this.elements) el.volume = v
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
    this.loopFlag = loop
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
