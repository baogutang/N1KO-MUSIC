/**
 * @vitest-environment happy-dom
 *
 * 复核 F5 的引擎级用例：断网期间暂停等网，联网后**自动续播**。
 * 用户路径：正在听歌 → 进隧道（audio error code 2/4 + navigator.onLine=false）
 * → 引擎暂停 → 出隧道（online 事件）→ 不用碰播放键，歌从原位置接着放。
 * 附带两条边界：用户离线期间动过播放键就不抢方向盘；超 5 分钟窗口
 * 把「点播放=重载」的通路修好。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

const { scrobble, upsertListeningEvent, reloadCurrent, fakeAdapter } = vi.hoisted(() => {
  const scrobble = vi.fn(async () => undefined)
  const upsertListeningEvent = vi.fn(async (_event: unknown) => 0)
  const reloadCurrent = vi.fn()
  const fakeAdapter = {
    type: 'plugin' as const,
    resolveStreamUrl: async () => ({ url: 'https://cdn.test/a.mp3', expiresAt: Date.now() + 60_000 }),
    scrobble,
    ping: async () => true,
    searchAll: async () => ({ songs: [], albums: [], artists: [] }),
    getStarred: async () => ({ songs: [], albums: [], artists: [] }),
  }
  return { scrobble, upsertListeningEvent, reloadCurrent, fakeAdapter }
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

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
})

function Probe() {
  useAudioEngine()
  return null
}
function ProbeTree() {
  return (
    <QueryClientProvider client={queryClient}>
      <Probe />
    </QueryClientProvider>
  )
}

let root: Root | null = null
let audio: HTMLAudioElement | null = null
let fakeNow = 1_000_000
let nowSpy: ReturnType<typeof vi.spyOn> | null = null
let onLineValue = true
const realPlayRef = HTMLMediaElement.prototype.play

function setOnLine(v: boolean) {
  onLineValue = v
  act(() => { window.dispatchEvent(new Event(v ? 'online' : 'offline')) })
}

function fireAudioError(el: HTMLAudioElement, code: number) {
  Object.defineProperty(el, 'error', {
    value: { code, message: `mock code ${code}` }, configurable: true,
  })
  act(() => { el.dispatchEvent(new Event('error')) })
}

async function untilAudioAttached() {
  for (let i = 0; i < 100 && !audio; i++) await Promise.resolve()
  if (!audio) throw new Error('引擎没有触发 audio.play()')
  return audio
}

beforeEach(() => {
  nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => fakeNow)
  const realPlay = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function (this: HTMLAudioElement) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- 测试要捕获引擎内部的模块级元素
    audio = this
    return Promise.resolve()
  }
  HTMLMediaElement.prototype.pause = function () { /* noop */ }
  HTMLMediaElement.prototype.load = function () { /* noop */ }
  Object.defineProperty(navigator, 'onLine', { get: () => onLineValue, configurable: true })

  usePlayerStore.setState({
    currentSong: { id: 's1', title: '隧道之歌', artist: 'A', album: 'AL', duration: 300, serverId: 'srv' },
    queue: [{ id: 's1', title: '隧道之歌', artist: 'A', album: 'AL', duration: 300, serverId: 'srv' }],
    queueIndex: 0,
    isPlaying: true,
    playVersion: 1,
    currentTime: 42,
    duration: 300,
    reloadCurrent,
  } as never)
  useServerStore.setState({
    isConnected: true,
    activeServerId: 'srv',
    connectedServerIds: ['srv'],
    startupConnectSettled: true,
    servers: [{ id: 'srv', name: 'srv', type: 'plugin', pluginId: 'p' } as never],
  } as never)

  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  nowSpy?.mockRestore()
  HTMLMediaElement.prototype.play = realPlayRef
  act(() => { root?.unmount() })
  root = null
  document.body.innerHTML = ''
  onLineValue = true
  vi.clearAllMocks()
})

async function bootAndPlay() {
  act(() => { root!.render(<ProbeTree />) })
  const el = await untilAudioAttached()
  await act(async () => { for (let i = 0; i < 50; i++) await Promise.resolve() })
  act(() => { el.dispatchEvent(new Event('play')) })
  return el
}

describe('断网暂停、联网续播（F5，引擎级）', () => {
  it('code 2 离线暂停 → online → 自动 resume（不用手动点播放）', { timeout: 20_000 }, async () => {
    const el = await bootAndPlay()
    setOnLine(false)
    fireAudioError(el, 2)
    await act(async () => { await Promise.resolve() })
    expect(usePlayerStore.getState().isPlaying, '离线时引擎暂停').toBe(false)

    setOnLine(true)
    // reloadForRecovery 有 400ms 延迟
    await act(async () => { await new Promise(r => setTimeout(r, 550)) })
    expect(usePlayerStore.getState().isPlaying, '联网后自动续播').toBe(true)
  })

  it('code 4（开播前取流失败常见码）离线同样不烧恢复次数、联网续播', { timeout: 20_000 }, async () => {
    const el = await bootAndPlay()
    setOnLine(false)
    fireAudioError(el, 4)
    await act(async () => { await Promise.resolve() })
    expect(usePlayerStore.getState().isPlaying).toBe(false)

    setOnLine(true)
    await act(async () => { await new Promise(r => setTimeout(r, 550)) })
    expect(usePlayerStore.getState().isPlaying, 'code 4 离线路径也自动续播').toBe(true)
  })

  it('离线期间用户动过播放键：联网后不抢方向盘', { timeout: 20_000 }, async () => {
    const el = await bootAndPlay()
    setOnLine(false)
    fireAudioError(el, 2)
    await act(async () => { await Promise.resolve() })
    expect(usePlayerStore.getState().isPlaying).toBe(false)

    // 用户按了播放又按了暂停（两次翻转都非引擎发起 → 令牌作废）
    act(() => { usePlayerStore.getState().resume() })
    await act(async () => { await Promise.resolve() })
    act(() => { usePlayerStore.getState().pause() })
    await act(async () => { await Promise.resolve() })

    setOnLine(true)
    await act(async () => { await new Promise(r => setTimeout(r, 550)) })
    expect(usePlayerStore.getState().isPlaying, '用户停过就不自动续播').toBe(false)
  })

  it('超 5 分钟窗口：联网后不自动续播，但点播放走重载', { timeout: 20_000 }, async () => {
    const el = await bootAndPlay()
    setOnLine(false)
    fireAudioError(el, 2)
    await act(async () => { await Promise.resolve() })

    fakeNow += 6 * 60 * 1000 // 假时钟推进 6 分钟
    setOnLine(true)
    await act(async () => { await new Promise(r => setTimeout(r, 550)) })
    expect(usePlayerStore.getState().isPlaying, '超窗不自动续播').toBe(false)

    // 用户点播放：needsReloadOnPlay 已置位 → reloadCurrent 被调（而不是干瞪眼）
    act(() => { usePlayerStore.getState().resume() })
    await act(async () => { await Promise.resolve() })
    expect(reloadCurrent).toHaveBeenCalled()
  })

  it('切歌（effect cleanup）后 online 不再触发旧监听', { timeout: 20_000 }, async () => {
    const el = await bootAndPlay()
    setOnLine(false)
    fireAudioError(el, 2)
    await act(async () => { await Promise.resolve() })

    // 切歌：store 换 currentSong → load effect 重跑，旧 cleanup 摘掉 online 监听
    act(() => {
      usePlayerStore.setState({
        currentSong: { id: 's2', title: '下一首', artist: 'B', album: 'AL', duration: 200, serverId: 'srv' },
        queue: [
          { id: 's1', title: '隧道之歌', artist: 'A', album: 'AL', duration: 300, serverId: 'srv' },
          { id: 's2', title: '下一首', artist: 'B', album: 'AL', duration: 200, serverId: 'srv' },
        ],
        queueIndex: 1,
        playVersion: 2,
        isPlaying: false,
      } as never)
    })
    await act(async () => { for (let i = 0; i < 50; i++) await Promise.resolve() })

    setOnLine(true)
    await act(async () => { await new Promise(r => setTimeout(r, 550)) })
    expect(usePlayerStore.getState().isPlaying, '旧监听不复活播放').toBe(false)
    void el
  })
})
