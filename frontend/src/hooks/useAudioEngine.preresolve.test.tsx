/**
 * @vitest-environment happy-dom
 *
 * 复核 F11 的引擎级用例：下一首的预解析失败后不再每 8s 重打插件。
 * 用户路径：正在听一首长歌，下一首是插件源的会员曲（解析必失败）——
 * 整首歌期间预解析只试一次，而不是每 8s 撞一次限频、把整个源的
 * 频控额度吃光（rate-limited 退避 60s 会反过来挡住用户切歌）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

const { resolveStreamUrl, upsertListeningEvent } = vi.hoisted(() => ({
  resolveStreamUrl: vi.fn(async (_songId: string) => ({ url: 'https://cdn.test/a.mp3', expiresAt: Date.now() + 60_000 })),
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
import { useSettingsStore } from '@/store/settingsStore'
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

const song = (id: string): Song => ({ id, title: `歌${id}`, artist: 'A', album: 'AL', duration: 600, serverId: 'srv' })

let root: Root | null = null
const realPlayRef = HTMLMediaElement.prototype.play

beforeEach(() => {
  HTMLMediaElement.prototype.play = function () { return Promise.resolve() }
  HTMLMediaElement.prototype.pause = function () { /* noop */ }
  HTMLMediaElement.prototype.load = function () { /* noop */ }

  useSettingsStore.setState({ preloadNext: true } as never)
  usePlayerStore.setState({
    currentSong: song('s1'),
    queue: [song('s1'), song('s2')],
    queueIndex: 0,
    isPlaying: true,
    playVersion: 1,
    currentTime: 0,
    duration: 600,
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
  HTMLMediaElement.prototype.play = realPlayRef
  act(() => { root?.unmount() })
  root = null
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('预解析失败不重试（F11，引擎级）', () => {
  it('下一首解析失败后，跨多轮 8s 定时不再重打', { timeout: 20_000 }, async () => {
    // s1 正常出流；s2（下一首）解析永远失败（会员曲 denied）
    resolveStreamUrl.mockImplementation(async (_songId: string) => {
      if (_songId === 's2') {
        const err = new Error('vip only') as Error & { code: string }
        err.code = 'forbidden'
        throw err
      }
      return { url: 'https://cdn.test/a.mp3', expiresAt: Date.now() + 60_000 }
    })

    vi.useFakeTimers()
    try {
      const host = document.createElement('div')
      document.body.appendChild(host)
      root = createRoot(host)
      act(() => { root!.render(<ProbeTree />) })
      await act(async () => { for (let i = 0; i < 50; i++) await Promise.resolve() })

      // 预解析定时器 8s 一轮：推进 3 轮多
      await act(async () => { await vi.advanceTimersByTimeAsync(8_000 * 3 + 500) })

      const s2Calls = resolveStreamUrl.mock.calls.filter(c => c[0] === 's2')
      expect(s2Calls.length, 's2 的预解析只试过一次（首轮）').toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
