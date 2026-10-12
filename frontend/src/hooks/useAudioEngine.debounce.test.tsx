/**
 * @vitest-environment happy-dom
 *
 * 复核 F10 的引擎级用例：切歌连点不该把 debounce 退化成节流。
 * 用户路径：正在听歌 → 50ms 间隔连点 5 首不同的歌 → 只有最后一次
 * 真正取流加载（旧代码第 3 次连点就撞进「距上次加载 ≥120ms」的立即
 * 分支，5 次连点发 3 次取流）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

const { resolveStreamUrl, upsertListeningEvent } = vi.hoisted(() => ({
  resolveStreamUrl: vi.fn(async () => ({ url: 'https://cdn.test/a.mp3', expiresAt: Date.now() + 60_000 })),
  upsertListeningEvent: vi.fn(async (_event: unknown) => 0),
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

const song = (id: string): Song => ({ id, title: `歌${id}`, artist: 'A', album: 'AL', duration: 200, serverId: 'srv' })

let root: Root | null = null
let fakeNow = 1_000_000
let nowSpy: ReturnType<typeof vi.spyOn> | null = null
const realPlayRef = HTMLMediaElement.prototype.play

beforeEach(() => {
  nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => fakeNow)
  HTMLMediaElement.prototype.play = function () { return Promise.resolve() }
  HTMLMediaElement.prototype.pause = function () { /* noop */ }
  HTMLMediaElement.prototype.load = function () { /* noop */ }

  usePlayerStore.setState({
    currentSong: song('s1'),
    queue: [song('s1'), song('s2'), song('s3'), song('s4'), song('s5'), song('s6')],
    queueIndex: 0,
    isPlaying: true,
    playVersion: 1,
    currentTime: 0,
    duration: 200,
  } as never)
  useServerStore.setState({
    isConnected: true,
    activeServerId: 'srv',
    connectedServerIds: ['srv'],
    startupConnectSettled: true,
    servers: [{ id: 'srv', name: 'srv', type: 'plugin', pluginId: 'p' } as never],
  } as never)
})
afterEach(() => {
  nowSpy?.mockRestore()
  HTMLMediaElement.prototype.play = realPlayRef
  act(() => { root?.unmount() })
  root = null
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

function switchTo(id: string, version: number) {
  act(() => {
    usePlayerStore.setState({ currentSong: song(id), playVersion: version } as never)
  })
}

describe('切歌连点只取流一次（F10，引擎级）', () => {
  it('50ms 间隔连点 5 首：整个连击窗口只有最后一次真正取流', { timeout: 20_000 }, async () => {
    vi.useFakeTimers()
    try {
      const host = document.createElement('div')
      document.body.appendChild(host)
      root = createRoot(host)
      act(() => { root!.render(<ProbeTree />) })
      // 首播加载完成
      await act(async () => { for (let i = 0; i < 50; i++) await Promise.resolve() })
      expect(resolveStreamUrl.mock.calls.length).toBe(1)

      // 5 次连点，间隔 50ms（全部落在 120ms 窗口内）
      fakeNow += 50
      switchTo('s2', 2)
      fakeNow += 50
      switchTo('s3', 3)
      fakeNow += 50
      switchTo('s4', 4)
      fakeNow += 50
      switchTo('s5', 5)
      fakeNow += 50
      switchTo('s6', 6)

      // 连击期间没有一次额外取流（旧代码此刻已是 3 次）
      expect(resolveStreamUrl.mock.calls.length, '窗口内不取流').toBe(1)

      // 静默期过后：只有最后一次（s6）加载
      await act(async () => { await vi.advanceTimersByTimeAsync(200) })
      expect(resolveStreamUrl.mock.calls.length, '只有最后一次取流').toBe(2)
      expect(usePlayerStore.getState().currentSong?.id).toBe('s6')
    } finally {
      vi.useRealTimers()
    }
  })
})
