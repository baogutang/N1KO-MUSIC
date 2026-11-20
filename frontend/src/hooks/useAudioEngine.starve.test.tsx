/**
 * @vitest-environment happy-dom
 *
 * 「供不上码率」的引擎级用例。
 * 实测 WebKit 在网速跟不上高码率 WAV 时不会停下等数据：时间照走、出来的是碎片和静音，
 * 而停滞看门狗只认「时间不动」。这里验证引擎自己停下攒缓冲、攒够再放，播放意图始终不变；
 * 连着两回之后临时降一档。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

const { toast, fakeAdapter } = vi.hoisted(() => {
  const toast = vi.fn()
  const fakeAdapter = {
    type: 'subsonic' as const,
    transcodes: true,
    getStreamUrl(id: string, maxBitrate: number) {
      return this.transcodes && maxBitrate > 0
        ? `https://nas.test/rest/stream?id=${id}&maxBitRate=${maxBitrate}&format=mp3`
        : `https://nas.test/rest/stream?id=${id}&maxBitRate=0`
    },
    scrobble: async () => undefined,
    ping: async () => true,
    searchAll: async () => ({ songs: [], albums: [], artists: [] }),
    getStarred: async () => ({ songs: [], albums: [], artists: [] }),
  }
  return { toast, fakeAdapter }
})
vi.mock('@/api', () => ({
  getAdapterFor: () => fakeAdapter,
  hasAdapterFor: () => true,
  adapterForSource: () => fakeAdapter,
  getAdapter: () => fakeAdapter,
  hasAdapter: () => true,
  findAdapterFor: () => fakeAdapter,
  listAdapters: () => [],
}))
vi.mock('@/services/listeningHistory', async importOriginal => {
  const real = await importOriginal<typeof import('@/services/listeningHistory')>()
  return { ...real, upsertListeningEvent: vi.fn(async () => 0), isQualifiedListeningEvent: () => true }
})
vi.mock('@/components/ui/use-toast', () => ({ toast }))
vi.mock('@/lib/network', () => ({
  isMeteredConnection: () => false,
  onConnectionChange: () => () => undefined,
}))
vi.mock('@/lib/queryClient', () => ({
  queryClient: { getQueryData: () => undefined, setQueryData: () => undefined, cancelQueries: async () => undefined },
}))

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAudioEngine } from './useAudioEngine'
import { usePlayerStore } from '@/store/playerStore'
import { useServerStore } from '@/store/serverStore'
import { useSettingsStore } from '@/store/settingsStore'
import { getPauseRecords, resetPauseTrailForTests } from '@/lib/playbackTrail'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
})

function Probe() {
  useAudioEngine()
  return null
}

let root: Root | null = null
let audio: HTMLAudioElement | null = null
let bufferedEnd = 102
let elementPaused = true
let pauseCalls = 0
let playCalls = 0
let loadedSrc: string[] = []
/** 引擎的流地址缓存是模块级的、按歌曲 id 记：每个用例用一首新歌，免得吃到上一个用例缓存的地址 */
let songSeq = 0
const realPlay = HTMLMediaElement.prototype.play
const realPause = HTMLMediaElement.prototype.pause
const realLoad = HTMLMediaElement.prototype.load

/** 元素停在 42 秒处、缓冲到 bufferedEnd；paused 跟着引擎的 play() / pause() 走 */
function fakeElement(el: HTMLAudioElement) {
  Object.defineProperty(el, 'paused', { get: () => elementPaused, configurable: true })
  Object.defineProperty(el, 'currentTime', { get: () => 42, set: () => undefined, configurable: true })
  Object.defineProperty(el, 'readyState', { get: () => 4, configurable: true })
  Object.defineProperty(el, 'buffered', {
    get: () => ({ length: 1, start: () => 0, end: () => bufferedEnd }) as unknown as TimeRanges,
    configurable: true,
  })
}

async function untilAudioAttached() {
  for (let i = 0; i < 100 && !audio; i++) await Promise.resolve()
  if (!audio) throw new Error('引擎没有触发 audio.play()')
  return audio
}

async function bootAndPlay() {
  act(() => {
    root!.render(
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>
    )
  })
  const el = await untilAudioAttached()
  await act(async () => { for (let i = 0; i < 50; i++) await Promise.resolve() })
  fakeElement(el)
  act(() => { el.dispatchEvent(new Event('play')) })
  pauseCalls = 0
  playCalls = 0
  return el
}

const wait = (ms: number) => act(async () => { await new Promise(r => setTimeout(r, ms)) })

/** 等到条件成立（看门狗 900ms 一轮，时序不卡死在某个毫秒数上） */
async function until(check: () => boolean, what: string, timeoutMs = 9000) {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error(`等不到：${what}`)
    await wait(150)
  }
}

beforeEach(() => {
  HTMLMediaElement.prototype.play = function (this: HTMLAudioElement) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- 测试要捕获引擎内部的模块级元素
    audio = this
    elementPaused = false
    playCalls += 1
    return Promise.resolve()
  }
  HTMLMediaElement.prototype.pause = function (this: HTMLAudioElement) {
    if (this !== audio) return
    elementPaused = true
    pauseCalls += 1
    // 真元素会排一个 pause 事件
    queueMicrotask(() => this.dispatchEvent(new Event('pause')))
  }
  HTMLMediaElement.prototype.load = function (this: HTMLAudioElement) {
    loadedSrc.push(this.getAttribute('src') ?? '')
  }
  bufferedEnd = 102
  elementPaused = true
  loadedSrc = []
  fakeAdapter.transcodes = true
  resetPauseTrailForTests()
  useSettingsStore.setState({ audioQuality: 'lossless', starveDowngrade: true, preloadNext: false, smoothTransitions: false })

  const song = { id: `s${++songSeq}`, title: '最长的电影', artist: 'A', album: 'AL', duration: 238, serverId: 'srv' }
  usePlayerStore.setState({
    currentSong: song,
    queue: [song],
    queueIndex: 0,
    isPlaying: true,
    playVersion: 1,
    currentTime: 42,
    duration: 238,
    streamBuffering: false,
  } as never)
  useServerStore.setState({
    isConnected: true,
    activeServerId: 'srv',
    connectedServerIds: ['srv'],
    startupConnectSettled: true,
    servers: [{ id: 'srv', name: 'srv', type: 'subsonic' } as never],
  } as never)

  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  HTMLMediaElement.prototype.play = realPlay
  HTMLMediaElement.prototype.pause = realPause
  HTMLMediaElement.prototype.load = realLoad
  act(() => { root?.unmount() })
  root = null
  if (audio) {
    for (const key of ['paused', 'currentTime', 'readyState', 'buffered', 'error']) delete (audio as unknown as Record<string, unknown>)[key]
  }
  audio = null
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('网速供不上码率', () => {
  it('往后没货还在「播」：停下攒缓冲，播放状态不变；攒够了自己接着放', { timeout: 30_000 }, async () => {
    await bootAndPlay()
    // 先见到健康的缓冲（引擎才信这条流的 buffered），然后数据断供
    await wait(1000)
    bufferedEnd = 42
    await until(() => pauseCalls > 0, '引擎把元素停下')
    await wait(50)

    expect(usePlayerStore.getState().isPlaying, '是引擎自己停下攒缓冲，不是暂停').toBe(true)
    expect(usePlayerStore.getState().streamBuffering, '亮出缓冲中').toBe(true)
    expect(getPauseRecords(), '不记成一次暂停').toHaveLength(0)

    // 攒缓冲期间来了 canplay：只有一点数据，不该放
    const playsBefore = playCalls
    act(() => { audio!.dispatchEvent(new Event('canplay')) })
    expect(playCalls, 'canplay 不放行').toBe(playsBefore)

    bufferedEnd = 51
    await until(() => !elementPaused, '攒够后接着放')
    expect(usePlayerStore.getState().streamBuffering).toBe(false)
    expect(usePlayerStore.getState().isPlaying).toBe(true)
    expect(loadedSrc, '没有重载').toHaveLength(1)
  })

  it('停着的时候用户按了暂停：听用户的，不再自己放', { timeout: 30_000 }, async () => {
    await bootAndPlay()
    await wait(1000)
    bufferedEnd = 42
    await until(() => pauseCalls > 0, '引擎把元素停下')

    act(() => { usePlayerStore.getState().pause() })
    await wait(1100)
    expect(usePlayerStore.getState().streamBuffering, '缓冲中的标记收掉').toBe(false)
    bufferedEnd = 80
    await wait(2000)
    expect(elementPaused, '用户暂停着，缓冲再多也不放').toBe(true)
    expect(usePlayerStore.getState().isPlaying).toBe(false)
  })

  it('同一首连着两回供不上：临时降一档，保位重载', { timeout: 40_000 }, async () => {
    await bootAndPlay()
    await wait(1000)
    bufferedEnd = 42
    await until(() => pauseCalls > 0, '第一回停下')
    bufferedEnd = 51
    await until(() => !elementPaused, '第一回放行')
    expect(toast, '只停一回不降档').not.toHaveBeenCalled()

    bufferedEnd = 42
    await until(() => loadedSrc.length > 1, '第二回停下后降档重载', 12_000)
    expect(loadedSrc.at(-1)).toContain('maxBitRate=320')
    expect(toast).toHaveBeenCalledTimes(1)
    expect(usePlayerStore.getState().isPlaying).toBe(true)
  })

  it('这个源不转码（低一档还是同一个地址）：不降档，继续攒缓冲', { timeout: 40_000 }, async () => {
    fakeAdapter.transcodes = false
    await bootAndPlay()
    await wait(1000)
    bufferedEnd = 42
    await until(() => pauseCalls > 0, '第一回停下')
    bufferedEnd = 51
    await until(() => !elementPaused, '第一回放行')
    bufferedEnd = 42
    await until(() => pauseCalls > 1, '第二回停下', 12_000)
    await wait(300)
    expect(toast).not.toHaveBeenCalled()
    expect(loadedSrc, '不重载').toHaveLength(1)
  })

  it('设置里关掉了临时降档：只攒缓冲', { timeout: 40_000 }, async () => {
    useSettingsStore.setState({ starveDowngrade: false })
    await bootAndPlay()
    await wait(1000)
    bufferedEnd = 42
    await until(() => pauseCalls > 0, '第一回停下')
    bufferedEnd = 51
    await until(() => !elementPaused, '第一回放行')
    bufferedEnd = 42
    await until(() => pauseCalls > 1, '第二回停下', 12_000)
    await wait(300)
    expect(toast).not.toHaveBeenCalled()
    expect(loadedSrc).toHaveLength(1)
  })
})
