/**
 * @vitest-environment happy-dom
 *
 * 复审 A5 的引擎级用例：单曲循环第 2 遍起，收听统计必须按「新的一条」
 * 重新起算。走真实的引擎事件流（play → timeupdate… → ended → 倒带 →
 * 再来一遍），不是单测某个纯函数。
 *
 * 抓的原问题：
 *  - listenedSec/listenedPrevT 不清 → 第 2 遍落盘时长 = 两遍累计；
 *  - scrobbleAttempts/scrobbleRetryAt 不清 → 上一遍的退避/尝试次数
 *    带进下一遍，循环若干遍后 scrobble 永久停摆。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

/* ── 引擎依赖全部换成可控桩（vi.hoisted：mock 工厂在 import 前执行） ── */
const { scrobble, upsertListeningEvent, fakeAdapter } = vi.hoisted(() => {
  const scrobble = vi.fn(async () => undefined)
  const upsertListeningEvent = vi.fn(async (_event: unknown) => 0)
  const fakeAdapter = {
    type: 'plugin' as const,
    resolveStreamUrl: async () => ({ url: 'https://cdn.test/a.mp3', expiresAt: Date.now() + 60_000 }),
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

import { QueryClientProvider } from '@tanstack/react-query'
import { QueryClient } from '@tanstack/react-query'
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
/* 引擎的 timeupdate 处理有 5fps 节流（performance.now 差值 <200ms 直接丢）：
   同步灌事件几乎全被丢掉。给 performance.now 一个可手动推进的假实现。 */
let fakeNow = 1_000_000
let nowSpy: ReturnType<typeof vi.spyOn> | null = null

beforeEach(() => {
  nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => fakeNow)
  // 捕获模块级 audioEl：引擎 play() 时记录 this
  const realPlay = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function (this: HTMLAudioElement) {
    audio = this
    return Promise.resolve()
  }
  HTMLMediaElement.prototype.pause = function () { /* noop */ }
  HTMLMediaElement.prototype.load = function () { /* noop */ }

  usePlayerStore.setState({
    currentSong: { id: 's1', title: '循环之歌', artist: 'A', album: 'AL', duration: 120, serverId: 'srv' },
    queue: [{ id: 's1', title: '循环之歌', artist: 'A', album: 'AL', duration: 120, serverId: 'srv' }],
    queueIndex: 0,
    isPlaying: true,
    playVersion: 1,
    repeatMode: 'one',
    repeatSeekToken: 0,
    currentTime: 0,
    duration: 120,
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
  document.body.innerHTML = ''
  vi.clearAllMocks()
})
const realPlayRef = HTMLMediaElement.prototype.play

/** 等到引擎把流挂上（捕获 audioEl） */
async function untilAudioAttached() {
  for (let i = 0; i < 100 && !audio; i++) await Promise.resolve()
  if (!audio) throw new Error('引擎没有触发 audio.play()')
  return audio
}

/** 模拟听 n 秒：推进假时钟越过节流窗，逐秒派发 timeupdate（累计真实收听秒数） */
function listenSeconds(el: HTMLAudioElement, seconds: number) {
  act(() => {
    for (let s = 1; s <= seconds; s++) {
      fakeNow += 250
      el.currentTime = s
      el.dispatchEvent(new Event('timeupdate'))
    }
  })
}

function fireEnded(el: HTMLAudioElement) {
  act(() => { el.dispatchEvent(new Event('ended')) })
}

describe('单曲循环第 2 遍重算（复审 A5，引擎级）', () => {
  it('两遍各 118 秒：每遍独立落盘 ~118s（不累计成 236s），scrobble 每遍都报', async () => {
    act(() => { root!.render(<ProbeTree />) })
    const el = await untilAudioAttached()
    // doLoad 的取流是异步的：把微任务队列跑空，确保 ended/timeupdate 监听已挂上
    await act(async () => { for (let i = 0; i < 50; i++) await Promise.resolve() })

    // 第一遍：play 开会话 → 听 118s → 自然 ended（别踩「提前结束」判定）
    act(() => { el.dispatchEvent(new Event('play')) })
    listenSeconds(el, 118)
    fireEnded(el)
    await act(async () => { await Promise.resolve() })

    // ended（repeat=one）应 bump repeatSeekToken → 引擎倒带并开新会话
    expect(usePlayerStore.getState().repeatSeekToken).toBe(1)
    // 第一遍的 scrobble 已提交（maybeSubmitPlay 在 ended 时跑）
    expect(scrobble.mock.calls.length).toBeGreaterThanOrEqual(1)

    // 第二遍：再听 118s → ended
    listenSeconds(el, 118)
    fireEnded(el)
    await act(async () => { await Promise.resolve() })

    const durations = upsertListeningEvent.mock.calls.map(call => (call[0] as { listenedSeconds: number }).listenedSeconds)
    expect(durations.length).toBeGreaterThanOrEqual(2)
    // A5 的核心断言：第二遍的时长 ≈ 30s，而不是 60s（累计）
    expect(Math.abs(durations[durations.length - 1] - 118)).toBeLessThanOrEqual(1)
    // scrobble 两遍都报了（playSubmitted 已复位）
    expect(scrobble.mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})
