/**
 * @vitest-environment happy-dom
 *
 * 同一首歌「重挂监听」（reattach）不该重新取流。
 * 用户路径：正在放插件源的歌，放了一阵子（缓存的流地址已过期），这时主库断开 / 重连
 * ——加载 effect 的依赖变了，走同 key 的重挂；恰好此刻插件取流失败（限频 / 网络抖动）。
 * 元素手里的流还在正常出声，原来 reattach 照样 resolveStream，失败分支直接把正在放的歌
 * 暂停（或降档从头重载 / 换源 / 跳歌）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

const { resolveStreamUrl, toast, fakeAdapter } = vi.hoisted(() => {
  const resolveStreamUrl = vi.fn(async (id: string) => ({ url: `https://cdn.test/${id}.mp3`, expiresAt: Date.now() + 60_000 }))
  const toast = vi.fn()
  const fakeAdapter = {
    type: 'plugin' as const,
    resolveStreamUrl,
    scrobble: vi.fn(async () => undefined),
    ping: async () => true,
    searchAll: async () => ({ songs: [], albums: [], artists: [] }),
    getStarred: async () => ({ songs: [], albums: [], artists: [] }),
  }
  return { resolveStreamUrl, toast, fakeAdapter }
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

const song = (id: string): Song => ({ id, title: `歌${id}`, artist: 'A', album: 'AL', duration: 3600, serverId: 'plug' })

let root: Root | null = null
let audio: HTMLAudioElement | null = null
const realPlayRef = HTMLMediaElement.prototype.play
const realLoadRef = HTMLMediaElement.prototype.load

beforeEach(() => {
  HTMLMediaElement.prototype.play = function () { return Promise.resolve() }
  HTMLMediaElement.prototype.pause = function () { /* noop */ }
  // 引擎加载时 audio.load()：借此拿到模块级的 audioEl
  HTMLMediaElement.prototype.load = function (this: HTMLAudioElement) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- 测试要捕获引擎内部的模块级元素
    audio = this
  }
  useServerStore.setState({
    isConnected: true,
    activeServerId: 'nas',
    connectedServerIds: ['nas', 'plug'],
    startupConnectSettled: true,
    servers: [
      { id: 'nas', name: 'nas', type: 'subsonic' } as never,
      { id: 'plug', name: 'plug', type: 'plugin', pluginId: 'p' } as never,
    ],
  } as never)
  const queue = [song('p1'), song('p2')]
  usePlayerStore.setState({
    currentSong: queue[0], queue, queueIndex: 0, isPlaying: true,
    playVersion: 1, repeatMode: 'none', shuffle: false, shuffledIndexes: [0, 1], shuffleCursor: -1,
    currentTime: 0, duration: 3600,
  } as never)
})
afterEach(() => {
  HTMLMediaElement.prototype.play = realPlayRef
  HTMLMediaElement.prototype.load = realLoadRef
  act(() => { root?.unmount() })
  root = null
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

async function flush() {
  await act(async () => { for (let i = 0; i < 50; i++) await Promise.resolve() })
}

describe('同一首歌重挂监听', () => {
  it('元素还活着：不重新取流，取流失败也打断不了正在放的歌', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => { root!.render(<ProbeTree />) })
    await flush()
    if (!audio) throw new Error('引擎没有加载音频')
    const el: HTMLAudioElement = audio
    expect(resolveStreamUrl).toHaveBeenCalledTimes(1)
    const srcBefore = el.getAttribute('src')

    // 放了半小时：缓存的地址早过期了；此刻插件取流失败（限频）
    const later = Date.now() + 30 * 60_000
    vi.spyOn(Date, 'now').mockImplementation(() => later)
    resolveStreamUrl.mockImplementation(async () => {
      throw Object.assign(new Error('rate limited'), { code: 'rate-limited' })
    })

    // 主库断开：加载 effect 的依赖变了，同 key 重挂监听
    act(() => { useServerStore.setState({ isConnected: false, activeServerId: null } as never) })
    await flush()
    await act(async () => { await new Promise(r => setTimeout(r, 1000)) })

    expect(resolveStreamUrl).toHaveBeenCalledTimes(1)
    expect(usePlayerStore.getState().isPlaying).toBe(true)
    expect(usePlayerStore.getState().currentSong?.id).toBe('p1')
    expect(el.getAttribute('src')).toBe(srcBefore)
    expect(toast).not.toHaveBeenCalled()

    // 监听真的重挂上了：时间推进照常同步进 store
    el.currentTime = 42
    act(() => { el.dispatchEvent(new Event('timeupdate')) })
    expect(usePlayerStore.getState().currentTime).toBe(42)
  })
})
