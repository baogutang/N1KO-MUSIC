/**
 * @vitest-environment happy-dom
 *
 * 引擎自动跳歌的两条路，走真实的加载 effect：
 *  - 混源队列里连着几首都来自已断开的源：每一首都要跳过去。原来第二次跳歌离第一次
 *    不到 50ms，被切歌防抖吞掉，停在一首放不了的歌上、按钮还显示「播放中」。
 *  - 单曲循环时这首取不到流：要跳到下一首。原来走 advanceOnEnded 只是「倒带」，
 *    元素里还握着上一首的流，于是界面是这首、喇叭里是上一首。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

const { resolveStreamUrl } = vi.hoisted(() => ({
  resolveStreamUrl: vi.fn(async (_id: string) => ({ url: 'https://cdn.test/a.mp3', expiresAt: Date.now() + 60_000 })),
}))
const { fakeAdapter } = vi.hoisted(() => ({
  fakeAdapter: {
    type: 'plugin' as const,
    resolveStreamUrl,
    scrobble: vi.fn(async () => undefined),
    ping: async () => true,
    searchAll: async () => ({ songs: [], albums: [], artists: [] }),
    getStarred: async () => ({ songs: [], albums: [], artists: [] }),
  },
}))
/** 'gone' 这个源断开了 */
vi.mock('@/api', () => ({
  getAdapterFor: () => fakeAdapter,
  hasAdapterFor: (id: string) => id !== 'gone',
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
import type { Song } from '@/api/types'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
})

function Probe() {
  useAudioEngine()
  return null
}
function ProbeTree() {
  return <QueryClientProvider client={queryClient}><Probe /></QueryClientProvider>
}

const song = (id: string, serverId = 'srv'): Song => ({ id, title: `歌${id}`, artist: 'A', album: 'AL', duration: 200, serverId })

let root: Root | null = null
const realPlayRef = HTMLMediaElement.prototype.play

beforeEach(() => {
  HTMLMediaElement.prototype.play = function () { return Promise.resolve() }
  HTMLMediaElement.prototype.pause = function () { /* noop */ }
  HTMLMediaElement.prototype.load = function () { /* noop */ }
  useServerStore.setState({
    isConnected: true,
    activeServerId: 'srv',
    connectedServerIds: ['srv'],
    startupConnectSettled: true,
    servers: [
      { id: 'srv', name: 'srv', type: 'plugin', pluginId: 'p' } as never,
      { id: 'gone', name: 'gone', type: 'plugin', pluginId: 'q' } as never,
    ],
  } as never)
})
afterEach(() => {
  HTMLMediaElement.prototype.play = realPlayRef
  act(() => { root?.unmount() })
  root = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.clearAllMocks()
})

function mount() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root!.render(<ProbeTree />) })
}

describe('连着几首都来自断开的源', () => {
  it('一路跳到能放的那首（不被切歌防抖吞掉第二次跳歌）', async () => {
    const queue = [song('g1', 'gone'), song('g2', 'gone'), song('g3', 'gone'), song('s4')]
    usePlayerStore.setState({
      currentSong: queue[0], queue, queueIndex: 0, isPlaying: true,
      playVersion: 1, repeatMode: 'off', shuffle: false, currentTime: 0, duration: 200,
    } as never)
    mount()
    await act(async () => { for (let i = 0; i < 50; i++) await Promise.resolve() })

    expect(usePlayerStore.getState().currentSong?.id).toBe('s4')
    expect(usePlayerStore.getState().isPlaying).toBe(true)
  })
})

describe('单曲循环 + 这首取不到流', () => {
  it('跳到下一首，而不是倒带重放元素里的旧流', async () => {
    vi.useFakeTimers()
    resolveStreamUrl.mockImplementation(async (id: string) => {
      if (id === 'bad') throw new Error('Not Found')
      return { url: `https://cdn.test/${id}.mp3`, expiresAt: Date.now() + 60_000 }
    })
    const queue = [song('bad'), song('s2')]
    usePlayerStore.setState({
      currentSong: queue[0], queue, queueIndex: 0, isPlaying: true,
      playVersion: 1, repeatMode: 'one', repeatSeekToken: 0, shuffle: false, currentTime: 0, duration: 200,
    } as never)
    mount()
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })

    expect(usePlayerStore.getState().repeatSeekToken).toBe(0)
    expect(usePlayerStore.getState().currentSong?.id).toBe('s2')
  })
})

describe('解码失败、恢复次数用完后按播放', () => {
  it('重新取流（原来元素错死、按钮翻成播放中却没声音）', async () => {
    vi.useFakeTimers()
    let el: HTMLAudioElement | null = null
    HTMLMediaElement.prototype.play = function (this: HTMLAudioElement) {
      // eslint-disable-next-line @typescript-eslint/no-this-alias -- 测试要捕获引擎内部的模块级元素
      el = this
      return Promise.resolve()
    }
    const queue = [song('s1'), song('s2')]
    usePlayerStore.setState({
      currentSong: queue[0], queue, queueIndex: 0, isPlaying: true,
      playVersion: 1, repeatMode: 'off', shuffle: false, currentTime: 0, duration: 200,
    } as never)
    mount()
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    if (!el) throw new Error('引擎没有触发 audio.play()')
    const audio: HTMLAudioElement = el
    Object.defineProperty(audio, 'error', { configurable: true, get: () => ({ code: 3, message: 'decode' }) })
    Object.defineProperty(audio, 'readyState', { configurable: true, get: () => 0 })

    // 每次恢复重载后又是解码失败，直到次数用完、停下
    for (let i = 0; i < 4 && usePlayerStore.getState().isPlaying; i++) {
      act(() => { audio.dispatchEvent(new Event('error')) })
      await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    }
    expect(usePlayerStore.getState().isPlaying).toBe(false)
    const versionWhenHalted = usePlayerStore.getState().playVersion

    act(() => { usePlayerStore.getState().resume() })

    expect(usePlayerStore.getState().playVersion).toBe(versionWhenHalted + 1)
  })
})
