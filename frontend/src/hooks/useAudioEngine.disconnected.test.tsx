/**
 * @vitest-environment happy-dom
 *
 * 「音源已断开」分支的跳歌，走真实的加载 effect：
 *  - 整条队列都来自断开的源 + 列表循环：next 绕回队首、effect 重跑又判断开，原来无限空转、
 *    每首弹一次提示。现在绕一圈就停（收回播放、提示只有一条）。
 *  - 连着很多首都断开：连跳满上限也停，不一路跳到底。
 *  - 暂停着（启动恢复了上次的队列、没点播放）：启动连接走完才发现当前曲的源没连上，
 *    跳到下一首但不自己开播。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

const { fakeAdapter, toast, toastUpdate, goneChecks } = vi.hoisted(() => {
  const toastUpdate = vi.fn()
  return {
    toastUpdate,
    toast: vi.fn((_props: unknown) => ({ id: 't1', dismiss: () => undefined, update: toastUpdate })),
    /** 防死循环的保险丝：修之前这里会无限空转，数到上限就抛错让用例红掉，而不是把进程卡死 */
    goneChecks: { count: 0 },
    fakeAdapter: {
      type: 'plugin' as const,
      resolveStreamUrl: vi.fn(async (id: string) => ({ url: `https://cdn.test/${id}.mp3`, expiresAt: Date.now() + 60_000 })),
      scrobble: vi.fn(async () => undefined),
      ping: async () => true,
      searchAll: async () => ({ songs: [], albums: [], artists: [] }),
      getStarred: async () => ({ songs: [], albums: [], artists: [] }),
    },
  }
})
/** 'gone' 这个源断开了 */
vi.mock('@/api', () => ({
  getAdapterFor: () => fakeAdapter,
  hasAdapterFor: (id: string) => {
    if (id !== 'gone') return true
    if (++goneChecks.count > 200) throw new Error('断开分支在空转：判了 200 次「音源已断开」')
    return false
  },
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
import { t } from '@/i18n'
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
let playCalls = 0
const realPlayRef = HTMLMediaElement.prototype.play

beforeEach(() => {
  playCalls = 0
  goneChecks.count = 0
  HTMLMediaElement.prototype.play = function () { playCalls += 1; return Promise.resolve() }
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
  vi.clearAllMocks()
})

function mount() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root!.render(<ProbeTree />) })
}

async function flush() {
  await act(async () => { for (let i = 0; i < 50; i++) await Promise.resolve() })
}

/*
 * 引擎的「这一轮」按 playVersion 认，模块状态跨用例保留：每条用例用各自的一段版本号，
 * 免得上一条停下时记的版本号恰好撞上下一条的起点。
 */
describe('整条队列都来自断开的源 + 列表循环', () => {
  it('绕一圈就停在原地：收回播放、只提示一次，无关依赖变化也不再空转', async () => {
    const queue = [song('g1', 'gone'), song('g2', 'gone'), song('g3', 'gone')]
    usePlayerStore.setState({
      currentSong: queue[0], queue, queueIndex: 0, isPlaying: true,
      playVersion: 100, repeatMode: 'all', shuffle: false, shuffledIndexes: [0, 1, 2], shuffleCursor: -1,
      currentTime: 0, duration: 200,
    } as never)
    mount()
    await flush()

    expect(usePlayerStore.getState().isPlaying).toBe(false)
    // 停在一首断开的歌上（绕回了队首），不是一直转
    expect(usePlayerStore.getState().currentSong?.id).toBe('g1')
    // 提示只有一条：开头那条「已断开」被原地改成「已停止自动跳歌」
    expect(toast).toHaveBeenCalledTimes(1)
    expect(toastUpdate).toHaveBeenCalledTimes(1)
    expect(toastUpdate.mock.calls[0][0]).toMatchObject({ title: t('player.queueHalted') })
    expect(fakeAdapter.resolveStreamUrl).not.toHaveBeenCalled()

    // 停下之后主库断开（加载 effect 的依赖变了）：这首已经处理过，不再跳、不再提示
    const versionWhenHalted = usePlayerStore.getState().playVersion
    act(() => { useServerStore.setState({ isConnected: false } as never) })
    await flush()
    expect(usePlayerStore.getState().playVersion).toBe(versionWhenHalted)
    expect(usePlayerStore.getState().currentSong?.id).toBe('g1')
    expect(toast).toHaveBeenCalledTimes(1)

    // 停下之后用户按播放：要有反应——重新试一轮（源还断着：再说一次、再停下），而不是按了没动静
    act(() => { usePlayerStore.getState().resume() })
    await flush()
    expect(usePlayerStore.getState().playVersion).toBeGreaterThan(versionWhenHalted)
    expect(toast).toHaveBeenCalledTimes(2)
    expect(usePlayerStore.getState().isPlaying).toBe(false)
  })
})

describe('连着很多首都来自断开的源', () => {
  it('连跳满上限就停下，不一路跳到底', async () => {
    const queue = [
      song('g1', 'gone'), song('g2', 'gone'), song('g3', 'gone'), song('g4', 'gone'),
      song('g5', 'gone'), song('g6', 'gone'), song('g7', 'gone'), song('s8'),
    ]
    usePlayerStore.setState({
      currentSong: queue[0], queue, queueIndex: 0, isPlaying: true,
      playVersion: 200, repeatMode: 'none', shuffle: false, shuffledIndexes: queue.map((_, i) => i), shuffleCursor: -1,
      currentTime: 0, duration: 200,
    } as never)
    mount()
    await flush()

    // 跳了 5 首（g1→g6）后停在 g6
    expect(usePlayerStore.getState().currentSong?.id).toBe('g6')
    expect(usePlayerStore.getState().isPlaying).toBe(false)
    expect(toast).toHaveBeenCalledTimes(1)
  })
})

describe('暂停着、启动连接走完才发现当前曲的源没连上', () => {
  it('跳到下一首，但不自己开播', async () => {
    useServerStore.setState({ startupConnectSettled: false } as never)
    const queue = [song('g1', 'gone'), song('s2')]
    usePlayerStore.setState({
      currentSong: queue[0], queue, queueIndex: 0, isPlaying: false,
      playVersion: 300, repeatMode: 'none', shuffle: false, shuffledIndexes: [0, 1], shuffleCursor: -1,
      currentTime: 0, duration: 200,
    } as never)
    mount()
    await flush()
    // 启动连接还没走完：「没适配器」只是「还没连上」，什么都不做
    expect(usePlayerStore.getState().currentSong?.id).toBe('g1')

    act(() => { useServerStore.setState({ startupConnectSettled: true } as never) })
    await flush()

    expect(usePlayerStore.getState().currentSong?.id).toBe('s2')
    expect(usePlayerStore.getState().isPlaying).toBe(false)
    expect(playCalls).toBe(0)
  })
})
