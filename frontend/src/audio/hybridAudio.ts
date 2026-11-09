import { WebDavNative, NATIVE_FLAC_PREFIX, type FlacEvent } from '@/api/adapters/webdavNative'
import { isNativePlatform, nativeOS } from '@/lib/platform'

/**
 * 安卓 WebView 的 audio 标签不解码 FLAC。
 * 地址以 webdav-native-flac: 开头时，改由系统解码器播放，其余地址仍走原来的 audio。
 */
type NativeKind = 'ready' | 'time' | 'ended' | 'paused' | 'error'

interface NativeEvent extends FlacEvent {
  kind: NativeKind
}

class HybridAudio extends EventTarget {
  private readonly inner = new Audio()
  private native = false
  private srcValue = ''
  private generation = 0
  private token = 0
  private awaiting = false
  private queue: NativeEvent[] = []
  private current = 0
  private length = Number.NaN
  private bufferedEnd = 0
  private isPaused = true
  private hasEnded = false
  private level = 1
  private speed = 1
  private defaultSpeed = 1
  private ready = 0
  private failure: MediaError | null = null

  constructor() {
    super()
    this.inner.preload = 'auto'
    const forward = (type: string) => {
      this.inner.addEventListener(type, () => {
        if (!this.native) this.dispatchEvent(new Event(type))
      })
    }
    for (const type of [
      'loadedmetadata',
      'durationchange',
      'timeupdate',
      'progress',
      'canplay',
      'canplaythrough',
      'play',
      'pause',
      'ended',
      'error',
      'waiting',
    ]) {
      forward(type)
    }
    const listen = (eventName: 'flacReady' | 'flacTime' | 'flacEnded' | 'flacPaused' | 'flacError', kind: NativeKind) => {
      void WebDavNative.addListener(eventName, event => this.onNative({ ...event, kind }))
    }
    listen('flacReady', 'ready')
    listen('flacTime', 'time')
    listen('flacEnded', 'ended')
    listen('flacPaused', 'paused')
    listen('flacError', 'error')
  }

  get src(): string {
    return this.native ? this.srcValue : this.inner.src
  }

  set src(value: string) {
    this.failure = null
    if (!value) {
      this.clearSource()
      return
    }
    if (value.startsWith(NATIVE_FLAC_PREFIX)) {
      this.native = true
      this.releaseInner()
      this.srcValue = value
      this.hasEnded = false
      this.isPaused = true
      this.ready = 0
      this.current = 0
      this.length = Number.NaN
      this.bufferedEnd = 0
      return
    }
    this.stopNative()
    this.native = false
    this.inner.src = value
  }

  /*
   * 引擎清空播放源用的是 removeAttribute('src') + load()（标准做法：src = '' 会被当成相对地址去请求页面本身）。
   * HybridAudio 不是真的元素，这几个要自己接住，否则清空时直接抛错。
   */
  getAttribute(name: string): string | null {
    if (name !== 'src') return this.inner.getAttribute(name)
    return this.native ? this.srcValue : this.inner.getAttribute('src')
  }

  hasAttribute(name: string): boolean {
    return this.getAttribute(name) !== null
  }

  setAttribute(name: string, value: string): void {
    if (name === 'src') this.src = value
    else this.inner.setAttribute(name, value)
  }

  removeAttribute(name: string): void {
    if (name === 'src') this.clearSource()
    else this.inner.removeAttribute(name)
  }

  get currentSrc(): string {
    return this.native ? this.srcValue : this.inner.currentSrc
  }

  get currentTime(): number {
    return this.native ? this.current : this.inner.currentTime
  }

  set currentTime(value: number) {
    if (!this.native) {
      this.inner.currentTime = value
      return
    }
    this.current = value
    this.hasEnded = false
    void WebDavNative.seekFlac({ seconds: value })
  }

  get duration(): number {
    return this.native ? this.length : this.inner.duration
  }

  get paused(): boolean {
    return this.native ? this.isPaused : this.inner.paused
  }

  get ended(): boolean {
    return this.native ? this.hasEnded : this.inner.ended
  }

  get volume(): number {
    return this.native ? this.level : this.inner.volume
  }

  set volume(value: number) {
    this.level = value
    if (this.native) void WebDavNative.volumeFlac({ volume: value })
    else this.inner.volume = value
  }

  get playbackRate(): number {
    return this.native ? this.speed : this.inner.playbackRate
  }

  set playbackRate(value: number) {
    this.speed = value
    if (this.native) void WebDavNative.rateFlac({ rate: value })
    else this.inner.playbackRate = value
  }

  get defaultPlaybackRate(): number {
    return this.native ? this.defaultSpeed : this.inner.defaultPlaybackRate
  }

  set defaultPlaybackRate(value: number) {
    this.defaultSpeed = value
    this.speed = value
    if (this.native) void WebDavNative.rateFlac({ rate: value })
    else this.inner.defaultPlaybackRate = value
  }

  get preservesPitch(): boolean {
    return this.native ? true : this.inner.preservesPitch
  }

  set preservesPitch(value: boolean) {
    if (!this.native) this.inner.preservesPitch = value
  }

  get readyState(): number {
    return this.native ? this.ready : this.inner.readyState
  }

  get error(): MediaError | null {
    return this.native ? this.failure : this.inner.error
  }

  get buffered(): TimeRanges {
    return this.native ? ranges(this.bufferedEnd) : this.inner.buffered
  }

  get seekable(): TimeRanges {
    return this.native ? ranges(this.length) : this.inner.seekable
  }

  get preload(): 'none' | 'metadata' | 'auto' | '' {
    return this.inner.preload
  }

  set preload(value: 'none' | 'metadata' | 'auto' | '') {
    this.inner.preload = value
  }

  get networkState(): number {
    return this.native ? (this.ready > 0 ? 1 : 2) : this.inner.networkState
  }

  load(): void {
    if (!this.native) {
      this.inner.load()
      return
    }
    const token = ++this.token
    this.awaiting = true
    this.queue = []
    this.ready = 0
    this.failure = null
    this.hasEnded = false
    this.isPaused = true
    const target = this.srcValue.slice(NATIVE_FLAC_PREFIX.length)
    void WebDavNative.openFlac({ target, volume: this.level, rate: this.speed })
      .then(result => {
        if (token !== this.token) return
        this.generation = result.generation
        this.awaiting = false
        const pending = this.queue.filter(event => event.generation === result.generation)
        this.queue = []
        for (const event of pending) this.apply(event)
      })
      .catch(error => {
        if (token !== this.token) return
        this.awaiting = false
        this.fail(2, error instanceof Error ? error.message : 'FLAC 打不开')
      })
  }

  play(): Promise<void> {
    if (!this.native) return this.inner.play()
    this.isPaused = false
    this.hasEnded = false
    return WebDavNative.resumeFlac().then(() => {
      this.dispatchEvent(new Event('play'))
    })
  }

  pause(): void {
    if (!this.native) {
      this.inner.pause()
      return
    }
    this.isPaused = true
    void WebDavNative.pauseFlac()
    this.dispatchEvent(new Event('pause'))
  }

  private clearSource(): void {
    this.failure = null
    this.stopNative()
    this.native = false
    this.srcValue = ''
    this.releaseInner()
  }

  /** 只 removeAttribute 不 load，旧的连接和解码器还挂着，下一首前会一直占着网络 */
  private releaseInner(): void {
    this.inner.pause()
    if (!this.inner.hasAttribute('src')) return
    this.inner.removeAttribute('src')
    this.inner.load()
  }

  private stopNative(): void {
    if (!this.native) return
    this.token += 1
    this.awaiting = false
    this.generation = 0
    void WebDavNative.stopFlac()
  }

  private onNative(event: NativeEvent): void {
    if (this.awaiting || event.generation !== this.generation) {
      if (this.awaiting) this.queue.push(event)
      return
    }
    this.apply(event)
  }

  private apply(event: NativeEvent): void {
    if (event.kind === 'ready') {
      this.length = event.duration ?? 0
      this.bufferedEnd = this.length
      this.ready = 4
      this.dispatchEvent(new Event('loadedmetadata'))
      this.dispatchEvent(new Event('durationchange'))
      this.dispatchEvent(new Event('progress'))
      this.dispatchEvent(new Event('canplay'))
      this.dispatchEvent(new Event('canplaythrough'))
      return
    }
    if (event.kind === 'time') {
      if (typeof event.position === 'number') this.current = event.position
      if (typeof event.duration === 'number' && event.duration > 0) this.length = event.duration
      if (typeof event.buffered === 'number') this.bufferedEnd = event.buffered
      this.dispatchEvent(new Event('timeupdate'))
      this.dispatchEvent(new Event('progress'))
      return
    }
    if (event.kind === 'ended') {
      this.hasEnded = true
      this.isPaused = true
      this.dispatchEvent(new Event('pause'))
      this.dispatchEvent(new Event('ended'))
      return
    }
    if (event.kind === 'paused') {
      if (this.isPaused) return
      this.isPaused = true
      this.dispatchEvent(new Event('pause'))
      return
    }
    this.fail(event.code || 4, event.message || 'FLAC 播放失败')
  }

  private fail(code: number, message: string): void {
    this.failure = { code, message } as MediaError
    this.ready = 0
    this.isPaused = true
    this.dispatchEvent(new Event('error'))
  }
}

function ranges(end: number): TimeRanges {
  if (!(end > 0)) {
    return { length: 0, start: () => 0, end: () => 0 }
  }
  return { length: 1, start: () => 0, end: () => end }
}

export function createEngineAudio(): HTMLAudioElement {
  if (!isNativePlatform || nativeOS !== 'android') return new Audio()
  return new HybridAudio() as unknown as HTMLAudioElement
}
