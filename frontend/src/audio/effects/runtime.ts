/**
 * 音效的运行时：那一个接着处理链的 <audio>、哪些流能走它、当前状态给界面看。
 *
 * 处理链只能吃「允许跨域读取」的音频：<audio> 一旦接进 Web Audio，来源没有 CORS 许可的声音
 * 会被浏览器换成静音（防止页面偷读别的站的音频）。所以带处理链的元素一律 crossOrigin=anonymous，
 * 而服务器不发 CORS 头的流根本加载不了它——这种流照旧走原来那个不接处理链的元素，只是没有音效。
 * 每个源站问一次（probeCors），结果记在内存里。
 *
 * 引擎那边的用法：取到流地址后 `await prepareFxRoute(url)`，之后 RoutedAudio 设 src 时
 * 同步问 `routeFx(url)` 决定用哪个元素。音效没开时两者都立刻返回，不碰任何东西。
 */
import { useSettingsStore } from '@/store/settingsStore'
import { isNativePlatform, nativeOS } from '@/lib/platform'
import { log } from '@/lib/log'
import { FxGraph, webAudioAvailable, type FxOutput } from './graph'
import { deriveFx, normalizeFx, type FxSettings } from './model'

/** 界面上要解释的几种情况 */
export type FxStatus =
  /** 没开 */
  | 'off'
  /** 当前这首正经过处理链 */
  | 'active'
  /** 开着，但这首的服务器不允许跨域读取，原样播放 */
  | 'no-cors'
  /** 开着，但音频上下文还没被允许启动（浏览器要等一次点击） */
  | 'suspended'
  /** 这个环境做不了（没有 Web Audio，或者安卓原生壳） */
  | 'unsupported'

/** iPhone / iPad（含原生壳里伪装成桌面 UA 的 iPad）：出声要绕到第二个 <audio> */
function isAppleTouchDevice(): boolean {
  if (nativeOS === 'ios') return true
  if (typeof navigator === 'undefined') return false
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) return true
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
}

function outputKind(): FxOutput {
  return isAppleTouchDevice() ? 'stream' : 'destination'
}

/**
 * 这个环境能不能做音效。
 * 安卓原生壳暂不支持：那里的引擎元素是另一套（FLAC 走系统解码器，声音不经过 WebView）。
 */
export function fxPlatformSupported(): boolean {
  if (isNativePlatform && nativeOS === 'android') return false
  return webAudioAvailable(outputKind())
}

export function readFxSettings(): FxSettings {
  const s = useSettingsStore.getState()
  return normalizeFx({
    enabled: s.fxEnabled,
    preset: s.fxPreset,
    bands: s.fxBands,
    bass: s.fxBass,
    clarity: s.fxClarity,
    width: s.fxWidth,
    loudness: s.fxLoudness,
  })
}

/** 音效开着，而且这个环境做得了 */
export function fxWanted(): boolean {
  return useSettingsStore.getState().fxEnabled === true && fxPlatformSupported()
}

// ─── 状态（给设置页看）────────────────────────────────────────────────────────

let status: FxStatus = 'off'
const statusListeners = new Set<() => void>()

function setStatus(next: FxStatus): void {
  if (status === next) return
  status = next
  for (const listener of statusListeners) listener()
}

export function getFxStatus(): FxStatus {
  return status
}

export function subscribeFxStatus(listener: () => void): () => void {
  statusListeners.add(listener)
  return () => { statusListeners.delete(listener) }
}

// ─── 跨域许可 ─────────────────────────────────────────────────────────────────

/** 「不允许」记这么久再重问：服务器配置可能改了 */
const NEGATIVE_TTL_MS = 10 * 60 * 1000
const PROBE_TIMEOUT_MS = 6000
const verdicts = new Map<string, { ok: boolean; at: number }>()
const probing = new Map<string, Promise<boolean | null>>()

function originOf(url: string): string | null {
  try {
    const parsed = new URL(url, typeof location !== 'undefined' ? location.href : undefined)
    // blob: / data: 是页面自己造的，不存在跨域
    if (parsed.protocol === 'blob:' || parsed.protocol === 'data:') return ''
    if (typeof location !== 'undefined' && parsed.origin === location.origin) return ''
    return parsed.origin
  } catch {
    return null
  }
}

/** 这个地址所在的源站允不允许跨域读取：true / false，没问过是 null */
export function corsVerdict(url: string, now = Date.now()): boolean | null {
  const origin = originOf(url)
  if (origin === null) return false
  if (origin === '') return true
  const known = verdicts.get(origin)
  if (!known) return null
  if (!known.ok && now - known.at > NEGATIVE_TTL_MS) return null
  return known.ok
}

/**
 * 用一个临时的 <audio crossorigin> 去加载元数据：成了就是允许，报错就是不允许。
 * 用 <audio> 而不是 fetch：要问的正是「媒体元素这样加载行不行」，同一条网络栈、同一套规则，不会两头不一致。
 * 超时不下结论（返回 null，也不记）：可能只是网慢。
 */
export function probeCors(url: string): Promise<boolean | null> {
  const origin = originOf(url)
  if (origin === null) return Promise.resolve(false)
  if (origin === '') return Promise.resolve(true)
  const known = corsVerdict(url)
  if (known !== null) return Promise.resolve(known)
  const inflight = probing.get(origin)
  if (inflight) return inflight
  const task = new Promise<boolean | null>(resolve => {
    const probe = new Audio()
    probe.crossOrigin = 'anonymous'
    probe.preload = 'metadata'
    probe.muted = true
    let settled = false
    const finish = (result: boolean | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      probe.removeEventListener('loadedmetadata', onOk)
      probe.removeEventListener('error', onFail)
      // 放手：不清掉的话它会把整首拉下来
      probe.removeAttribute('src')
      probe.load()
      if (result !== null) verdicts.set(origin, { ok: result, at: Date.now() })
      resolve(result)
    }
    const onOk = () => finish(true)
    const onFail = () => finish(false)
    const timer = setTimeout(() => finish(null), PROBE_TIMEOUT_MS)
    probe.addEventListener('loadedmetadata', onOk)
    probe.addEventListener('error', onFail)
    probe.src = url
    probe.load()
  })
  probing.set(origin, task)
  void task.then(() => { if (probing.get(origin) === task) probing.delete(origin) })
  return task
}

// ─── 带处理链的元素 ───────────────────────────────────────────────────────────

let fxElement: HTMLAudioElement | null = null
let graph: FxGraph | null = null
let graphFailed = false

/** 出声元素（stream 路径）晚一点再停：切歌时源元素会先停再放，别跟着一停一放 */
const SINK_PAUSE_DELAY_MS = 600

function bindSink(element: HTMLAudioElement, sink: HTMLAudioElement): void {
  let pauseTimer: ReturnType<typeof setTimeout> | null = null
  const playSink = () => {
    if (pauseTimer !== null) {
      clearTimeout(pauseTimer)
      pauseTimer = null
    }
    graph?.resume()
    if (sink.paused) {
      void sink.play().catch(error => {
        log.warn('Effects', 'output element refused to play:', error instanceof Error ? error.message : error)
      })
    }
  }
  const pauseSinkSoon = () => {
    if (pauseTimer !== null) clearTimeout(pauseTimer)
    pauseTimer = setTimeout(() => {
      pauseTimer = null
      if (element.paused) sink.pause()
    }, SINK_PAUSE_DELAY_MS)
  }
  element.addEventListener('play', playSink)
  element.addEventListener('playing', playSink)
  element.addEventListener('pause', pauseSinkSoon)
  element.addEventListener('ended', pauseSinkSoon)
  element.addEventListener('emptied', pauseSinkSoon)
  /*
   * 只有出声的那个被停了、音源还在走：听的人那边是「在放但没声」。
   * 先把它叫起来；叫不动就把音源也停下，让界面说实话。
   */
  sink.addEventListener('pause', () => {
    if (element.paused || pauseTimer !== null) return
    setTimeout(() => {
      if (element.paused || !sink.paused) return
      void sink.play().catch(() => {
        if (!element.paused) element.pause()
      })
    }, 250)
  })
}

/**
 * 取（必要时创建）带处理链的元素。建不出来（没有 Web Audio、构造抛错）返回 null，之后不再试。
 */
export function ensureFxElement(): { element: HTMLAudioElement; graph: FxGraph } | null {
  if (fxElement && graph) return { element: fxElement, graph }
  if (graphFailed || !fxPlatformSupported()) return null
  try {
    const element = new Audio()
    element.crossOrigin = 'anonymous'
    element.preload = 'auto'
    const built = new FxGraph(element, outputKind())
    built.apply(deriveFx(readFxSettings()))
    fxElement = element
    graph = built
    if (built.sink) bindSink(element, built.sink)
    element.addEventListener('play', () => built.resume())
    built.ctx.addEventListener('statechange', () => {
      // 来电、Siri 之类把上下文打断之后，音源还在走就把它叫回来
      if (built.ctx.state !== 'running' && !element.paused) built.resume()
    })
    return { element, graph: built }
  } catch (error) {
    graphFailed = true
    log.warn('Effects', 'could not build the effects chain:', error instanceof Error ? error.message : error)
    return null
  }
}

/** 等上下文真的跑起来（刚建好时是 suspended，要过一小会儿）；等不到就算了 */
function whenRunning(target: FxGraph, timeoutMs: number): Promise<void> {
  if (target.running) return Promise.resolve()
  target.resume()
  return new Promise(resolve => {
    const done = () => {
      clearTimeout(timer)
      target.ctx.removeEventListener('statechange', onChange)
      resolve()
    }
    const onChange = () => { if (target.running) done() }
    const timer = setTimeout(done, timeoutMs)
    target.ctx.addEventListener('statechange', onChange)
  })
}

/**
 * 加载一条流之前调用：音效开着的话，把处理链备好、把这个源站允不允许跨域问清楚。
 * 不抛错；问不出来就当作不走处理链。音效没开时立刻返回。
 */
export async function prepareFxRoute(url: string): Promise<void> {
  if (!fxWanted()) return
  const fx = ensureFxElement()
  if (!fx) return
  await Promise.all([
    whenRunning(fx.graph, 800),
    corsVerdict(url) === null ? probeCors(url) : null,
  ])
}

/** 不改状态的判断：这条流现在会不会走处理链，不走的话是因为什么 */
function decide(url: string): { fx: boolean; status: FxStatus } {
  if (useSettingsStore.getState().fxEnabled !== true) return { fx: false, status: 'off' }
  if (!fxPlatformSupported()) return { fx: false, status: 'unsupported' }
  const ready = ensureFxElement()
  if (!ready) return { fx: false, status: 'unsupported' }
  if (corsVerdict(url) !== true) return { fx: false, status: 'no-cors' }
  if (!ready.graph.running) {
    ready.graph.resume()
    return { fx: false, status: 'suspended' }
  }
  return { fx: true, status: 'active' }
}

/** 预热下一首时用：只问会不会走处理链，不动界面状态 */
export function wouldRouteFx(url: string): boolean {
  return decide(url).fx
}

/** RoutedAudio 设 src 时用：决定这条流用哪个元素，并把结果记给界面 */
export function routeFx(url: string): boolean {
  const decision = decide(url)
  setStatus(decision.status)
  return decision.fx
}

/** 主音量：走处理链的增益（见 FxGraph.setVolume） */
export function setFxVolume(value: number): void {
  graph?.setVolume(value)
}

/** 在用户手势里调用（开关音效、按播放）：浏览器只在这时允许启动音频上下文 */
export function resumeFx(): void {
  graph?.resume()
}

/**
 * 用户打开音效开关时调用（就在那次点击里）：把处理链建好、上下文叫起来。
 * 等到下一次加载才建的话，浏览器里那已经不在手势内，上下文起不来。
 */
export function primeFx(): void {
  ensureFxElement()?.graph.resume()
}

// 设置一变，处理链跟着变；开关本身由引擎按「同曲换路」重载
useSettingsStore.subscribe((state, prev) => {
  if (!state.fxEnabled && status !== 'off') setStatus('off')
  if (!graph) return
  if (
    state.fxEnabled === prev.fxEnabled &&
    state.fxBands === prev.fxBands &&
    state.fxBass === prev.fxBass &&
    state.fxClarity === prev.fxClarity &&
    state.fxWidth === prev.fxWidth &&
    state.fxLoudness === prev.fxLoudness
  ) return
  graph.apply(deriveFx(readFxSettings()))
})

/** 测试用：把模块级状态清回初始 */
export function resetFxRuntimeForTests(): void {
  fxElement = null
  graph = null
  graphFailed = false
  verdicts.clear()
  probing.clear()
  status = 'off'
}
