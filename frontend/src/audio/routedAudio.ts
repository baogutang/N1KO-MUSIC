/**
 * 引擎用的音频元素（安卓原生壳之外）：对引擎是一个 <audio>，里面按流选用两个元素之一。
 *
 * - plain：原来那个什么都不接的 <audio>。音效没开、或者这条流不能过处理链时用它，行为和从前完全一样。
 * - fx：接着音效处理链的 <audio>（crossOrigin=anonymous，见 effects/runtime）。只在音效开着、
 *   且这条流的服务器允许跨域读取时才用；从没开过音效的话它根本不会被创建。
 *
 * 为什么是两个元素而不是一个：<audio> 接进 Web Audio 之后摘不下来，而接着处理链的元素
 * 放不了不带 CORS 许可的流（会被换成静音）。队列里混着两种来源时，只能各走各的。
 *
 * 选哪个在设 src 的那一刻定（routeFx 是同步的，引擎在这之前已经 await 过 prepareFxRoute）。
 * 事件只转发当前元素的；换元素时把音量、倍速这些带过去。
 */
import { ensureFxElement, resumeFx, routeFx, setFxVolume } from './effects/runtime'

const FORWARDED_EVENTS = [
  'loadstart',
  'loadedmetadata',
  'loadeddata',
  'durationchange',
  'timeupdate',
  'progress',
  'canplay',
  'canplaythrough',
  'play',
  'playing',
  'pause',
  'ended',
  'error',
  'waiting',
  'stalled',
  'seeking',
  'seeked',
  'emptied',
  'suspend',
  'ratechange',
] as const

export class RoutedAudio extends EventTarget {
  private readonly plain: HTMLAudioElement
  private fx: HTMLAudioElement | null = null
  private cur: HTMLAudioElement
  /** 引擎要的音量。fx 元素自己保持满格，音量交给处理链尾的增益 */
  private level = 1

  constructor() {
    super()
    this.plain = new Audio()
    this.cur = this.plain
    this.forward(this.plain)
  }

  private forward(element: HTMLAudioElement): void {
    for (const type of FORWARDED_EVENTS) {
      element.addEventListener(type, () => {
        if (element === this.cur) this.dispatchEvent(new Event(type))
      })
    }
  }

  /** 这条流该用哪个元素 */
  private pick(url: string): HTMLAudioElement {
    if (!url || !routeFx(url)) return this.plain
    const ready = ensureFxElement()
    if (!ready) return this.plain
    if (this.fx !== ready.element) {
      this.fx = ready.element
      this.forward(ready.element)
    }
    return ready.element
  }

  private switchTo(next: HTMLAudioElement): void {
    const prev = this.cur
    // 旧元素放手：停下、清掉源（它排着的 pause / emptied 事件此后不再转发）
    prev.pause()
    if (prev.hasAttribute('src')) {
      prev.removeAttribute('src')
      prev.load()
    }
    this.cur = next
    next.preload = prev.preload
    next.defaultPlaybackRate = prev.defaultPlaybackRate
    next.playbackRate = prev.playbackRate
    next.preservesPitch = prev.preservesPitch
    next.muted = prev.muted
    this.applyVolume()
  }

  private applyVolume(): void {
    if (this.cur === this.fx) {
      if (this.cur.volume !== 1) this.cur.volume = 1
      setFxVolume(this.level)
    } else {
      this.plain.volume = this.level
    }
  }

  get src(): string {
    return this.cur.src
  }

  set src(value: string) {
    const next = this.pick(value)
    if (next !== this.cur) this.switchTo(next)
    this.cur.src = value
  }

  getAttribute(name: string): string | null {
    return this.cur.getAttribute(name)
  }

  hasAttribute(name: string): boolean {
    return this.cur.hasAttribute(name)
  }

  setAttribute(name: string, value: string): void {
    if (name === 'src') this.src = value
    else this.cur.setAttribute(name, value)
  }

  removeAttribute(name: string): void {
    this.cur.removeAttribute(name)
  }

  get currentSrc(): string {
    return this.cur.currentSrc
  }

  get currentTime(): number {
    return this.cur.currentTime
  }

  set currentTime(value: number) {
    this.cur.currentTime = value
  }

  get duration(): number {
    return this.cur.duration
  }

  get paused(): boolean {
    return this.cur.paused
  }

  get ended(): boolean {
    return this.cur.ended
  }

  get seeking(): boolean {
    return this.cur.seeking
  }

  /** plain 上原样读元素自己的值（iOS 上它恒为 1，引擎的渐弱一直是按这个算的） */
  get volume(): number {
    return this.cur === this.fx ? this.level : this.plain.volume
  }

  set volume(value: number) {
    this.level = value
    this.applyVolume()
  }

  get muted(): boolean {
    return this.cur.muted
  }

  set muted(value: boolean) {
    this.cur.muted = value
  }

  get playbackRate(): number {
    return this.cur.playbackRate
  }

  set playbackRate(value: number) {
    this.cur.playbackRate = value
  }

  get defaultPlaybackRate(): number {
    return this.cur.defaultPlaybackRate
  }

  set defaultPlaybackRate(value: number) {
    this.cur.defaultPlaybackRate = value
  }

  get preservesPitch(): boolean {
    return this.cur.preservesPitch
  }

  set preservesPitch(value: boolean) {
    this.cur.preservesPitch = value
  }

  get readyState(): number {
    return this.cur.readyState
  }

  get networkState(): number {
    return this.cur.networkState
  }

  get error(): MediaError | null {
    return this.cur.error
  }

  get buffered(): TimeRanges {
    return this.cur.buffered
  }

  get seekable(): TimeRanges {
    return this.cur.seekable
  }

  get preload(): 'none' | 'metadata' | 'auto' | '' {
    return this.cur.preload
  }

  set preload(value: 'none' | 'metadata' | 'auto' | '') {
    this.cur.preload = value
  }

  load(): void {
    this.cur.load()
  }

  play(): Promise<void> {
    if (this.cur === this.fx) resumeFx()
    return this.cur.play()
  }

  pause(): void {
    this.cur.pause()
  }
}
