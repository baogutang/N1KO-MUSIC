/**
 * @vitest-environment happy-dom
 *
 * 「放完存货」（RIDE_OUT_MIN_SEC）的引擎级用例。
 * 用户报过：缓冲明明还有余量，播放却自己停了。网络错误（code 2）来的时候当前位置往后
 * 常常还缓冲着几十秒——这时不该马上暂停（断网）或马上重载（在线），先接着放，快放完了再恢复。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

const { scrobble, upsertListeningEvent, fakeAdapter } = vi.hoisted(() => {
  const scrobble = vi.fn(async () => undefined)
  const upsertListeningEvent = vi.fn(async (_event: unknown) => 0)
  const fakeAdapter = {
    type: 'subsonic' as const,
    getStreamUrl: () => 'https://nas.test/rest/stream?id=s1',
    scrobble,
    ping: async () => true,
    searchAll: async () => ({ songs: [], albums: [], artists: [] }),
    getStarred: async () => ({ songs: [], albums: [], artists: [] }),
  }
  return { scrobble, upsertListeningEvent, fakeAdapter }
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
  return { ...real, upsertListeningEvent, isQualifiedListeningEvent: () => true }
})
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }))
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
let onLineValue = true
let bufferedEnd = 102
const loadSpy = vi.fn()
const realPlay = HTMLMediaElement.prototype.play
const realPause = HTMLMediaElement.prototype.pause
const realLoad = HTMLMediaElement.prototype.load

function setOnLine(v: boolean) {
  onLineValue = v
  act(() => { window.dispatchEvent(new Event(v ? 'online' : 'offline')) })
}

/** 让元素看起来正在 42 秒处播放、缓冲到 bufferedEnd */
function fakePlaying(el: HTMLAudioElement) {
  Object.defineProperty(el, 'paused', { get: () => false, configurable: true })
  Object.defineProperty(el, 'currentTime', { get: () => 42, set: () => undefined, configurable: true })
  Object.defineProperty(el, 'buffered', {
    get: () => ({ length: 1, start: () => 0, end: () => bufferedEnd }) as unknown as TimeRanges,
    configurable: true,
  })
}

function fireAudioError(el: HTMLAudioElement, code: number) {
  Object.defineProperty(el, 'error', { value: { code, message: `mock code ${code}` }, configurable: true })
  act(() => { el.dispatchEvent(new Event('error')) })
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
  act(() => { el.dispatchEvent(new Event('play')) })
  fakePlaying(el)
  loadSpy.mockClear()
  return el
}

const wait = (ms: number) => act(async () => { await new Promise(r => setTimeout(r, ms)) })

beforeEach(() => {
  HTMLMediaElement.prototype.play = function (this: HTMLAudioElement) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- 测试要捕获引擎内部的模块级元素
    audio = this
    return Promise.resolve()
  }
  HTMLMediaElement.prototype.pause = function () { /* noop */ }
  HTMLMediaElement.prototype.load = function () { loadSpy() }
  Object.defineProperty(navigator, 'onLine', { get: () => onLineValue, configurable: true })
  bufferedEnd = 102
  resetPauseTrailForTests()

  const song = { id: 's1', title: '长隧道', artist: 'A', album: 'AL', duration: 300, serverId: 'srv' }
  usePlayerStore.setState({
    currentSong: song,
    queue: [song],
    queueIndex: 0,
    isPlaying: true,
    playVersion: 1,
    currentTime: 42,
    duration: 300,
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
  // 引擎的 <audio> 是模块级单例，跨用例复用：把这里加在实例上的假属性摘掉，下一个用例从原型重新读
  if (audio) {
    for (const key of ['paused', 'currentTime', 'buffered', 'error']) delete (audio as unknown as Record<string, unknown>)[key]
  }
  document.body.innerHTML = ''
  onLineValue = true
  vi.clearAllMocks()
})

describe('网络错误时先放完缓冲里的存货', () => {
  it('在线：还缓冲着 60 秒时不暂停、不马上重载；存货见底才保位重载', { timeout: 20_000 }, async () => {
    const el = await bootAndPlay()
    fireAudioError(el, 2)
    // 旧行为：1 秒后就重载
    await wait(1300)
    expect(usePlayerStore.getState().isPlaying, '存货还多，不该暂停').toBe(true)
    expect(loadSpy, '存货还多，不该重载').not.toHaveBeenCalled()

    // 放到只剩 1 秒的存货：看门狗（900ms 一轮）下一轮就恢复；恢复本身照旧隔 1 秒再重载，把最后那点存货放掉
    bufferedEnd = 43
    await wait(2200)
    expect(loadSpy, '存货见底，保位重载').toHaveBeenCalled()
    expect(usePlayerStore.getState().isPlaying).toBe(true)
  })

  it('断网：先放着；存货见底还没网才暂停（记成「断网」），网回来自动接着放', { timeout: 20_000 }, async () => {
    const el = await bootAndPlay()
    setOnLine(false)
    fireAudioError(el, 2)
    await wait(300)
    expect(usePlayerStore.getState().isPlaying, '断网但存货还多：接着放').toBe(true)

    bufferedEnd = 43
    await wait(1000)
    expect(usePlayerStore.getState().isPlaying, '存货见底、仍然没网：停下等网').toBe(false)
    expect(getPauseRecords().at(-1)?.reason).toBe('offline')

    setOnLine(true)
    await wait(600)
    expect(usePlayerStore.getState().isPlaying, '网回来了：自动续播').toBe(true)
  })

  it('存货不到 4 秒：照旧立刻恢复', { timeout: 20_000 }, async () => {
    bufferedEnd = 44
    const el = await bootAndPlay()
    fireAudioError(el, 2)
    await wait(1300)
    expect(loadSpy, '没多少存货，按原来的节奏 1 秒后重载').toHaveBeenCalled()
  })
})
