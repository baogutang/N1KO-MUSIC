/**
 * @vitest-environment happy-dom
 *
 * 队列最后一首自然播完（repeat=none）→ 停下 → 用户再按播放：元素从头重放、不走 doLoad。
 * 这一遍必须是一条全新的收听。走真实的引擎事件流（play → timeupdate… → ended →
 * 按播放 → play → timeupdate… → 切走）。
 *
 * 抓的原问题：onEnded 只清了 playEvent*，没清 listenedSec / nowPlayingSent / playSubmitted
 * 这些计数——重放这一遍继承了上一遍整首的时长，听 4 秒就切走也落成「完整听完」，
 * 而且 now-playing 不再发。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

const { scrobble, upsertListeningEvent, fakeAdapter } = vi.hoisted(() => {
  const scrobble = vi.fn(async (_songId: string, _submission: boolean) => undefined)
  const upsertListeningEvent = vi.fn(async (_event: unknown) => 0)
  const fakeAdapter = {
    type: 'plugin' as const,
    resolveStreamUrl: async (id: string) => ({ url: `https://cdn.test/${id}.mp3`, expiresAt: Date.now() + 600_000 }),
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

const song = (id: string): Song => ({ id, title: `歌${id}`, artist: 'A', album: 'AL', duration: 120, serverId: 'srv' })

let root: Root | null = null
let audio: HTMLAudioElement | null = null
const realPlayRef = HTMLMediaElement.prototype.play
const realLoadRef = HTMLMediaElement.prototype.load
/* timeupdate 有 5fps 节流（performance.now 差值 <200ms 直接丢）：给它一个手动推进的假时钟 */
let fakeNow = 1_000_000
let nowSpy: ReturnType<typeof vi.spyOn> | null = null

beforeEach(() => {
  nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => fakeNow)
  HTMLMediaElement.prototype.play = function () { return Promise.resolve() }
  HTMLMediaElement.prototype.pause = function () { /* noop */ }
  // 引擎加载时 audio.load()：借此拿到模块级的 audioEl
  HTMLMediaElement.prototype.load = function (this: HTMLAudioElement) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- 测试要捕获引擎内部的模块级元素
    audio = this
  }
  useServerStore.setState({
    isConnected: true,
    activeServerId: 'srv',
    connectedServerIds: ['srv'],
    startupConnectSettled: true,
    servers: [{ id: 'srv', name: 'srv', type: 'plugin', pluginId: 'p' } as never],
  } as never)
  const queue = [song('s1')]
  usePlayerStore.setState({
    currentSong: queue[0], queue, queueIndex: 0, isPlaying: true,
    playVersion: 1, repeatMode: 'none', repeatSeekToken: 0, shuffle: false,
    shuffledIndexes: [0], shuffleCursor: -1, currentTime: 0, duration: 120,
  } as never)
})
afterEach(() => {
  nowSpy?.mockRestore()
  HTMLMediaElement.prototype.play = realPlayRef
  HTMLMediaElement.prototype.load = realLoadRef
  act(() => { root?.unmount() })
  root = null
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

async function flush() {
  await act(async () => { for (let i = 0; i < 50; i++) await Promise.resolve() })
}

/** 模拟听到第 from..to 秒：推进假时钟越过节流窗，逐秒派发 timeupdate */
function playThrough(el: HTMLAudioElement, from: number, to: number) {
  act(() => {
    for (let s = from; s <= to; s++) {
      fakeNow += 250
      el.currentTime = s
      el.dispatchEvent(new Event('timeupdate'))
    }
  })
}

const nowPlayingCalls = () => scrobble.mock.calls.filter(c => c[0] === 's1' && c[1] === false).length
const submissionCalls = () => scrobble.mock.calls.filter(c => c[0] === 's1' && c[1] === true).length

describe('最后一首自然播完后再按播放', () => {
  it('重放这一遍是全新的收听：时长从零算、now-playing 重新发', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => { root!.render(<ProbeTree />) })
    await flush()
    if (!audio) throw new Error('引擎没有加载音频')
    const el: HTMLAudioElement = audio

    // 第一遍：开播 → 听到 118 秒 → 自然结束（别踩「提前结束」判定）
    act(() => { el.dispatchEvent(new Event('play')) })
    playThrough(el, 1, 118)
    act(() => { el.dispatchEvent(new Event('ended')) })
    await flush()
    expect(usePlayerStore.getState().isPlaying).toBe(false)
    expect(usePlayerStore.getState().currentSong?.id).toBe('s1')
    expect(nowPlayingCalls()).toBe(1)
    expect(submissionCalls()).toBe(1)
    const firstEventId = (upsertListeningEvent.mock.calls.at(-1)![0] as { eventId: string }).eventId

    // 用户按播放：元素数据还在（readyState 4），从头重放，不走 doLoad
    Object.defineProperty(el, 'readyState', { configurable: true, get: () => 4 })
    act(() => { usePlayerStore.getState().resume() })
    el.currentTime = 0
    act(() => { el.dispatchEvent(new Event('play')) })
    playThrough(el, 1, 5)

    // 听了几秒就换歌：结算这一遍
    act(() => { usePlayerStore.getState().playSong(song('s2'), [song('s1'), song('s2')]) })
    await flush()

    const replay = upsertListeningEvent.mock.calls
      .map(c => c[0] as { eventId: string; song: Song; listenedSeconds: number; outcome: string })
      .filter(e => e.song.id === 's1' && e.eventId !== firstEventId)
    expect(replay.length).toBeGreaterThanOrEqual(1)
    const last = replay[replay.length - 1]
    // 原来是 118 + 4 = 122 秒、记成 completed
    expect(last.listenedSeconds).toBeLessThanOrEqual(6)
    expect(last.outcome).not.toBe('completed')
    // 这一遍重新报了 now-playing；没听够阈值，不提交 scrobble
    expect(nowPlayingCalls()).toBe(2)
    expect(submissionCalls()).toBe(1)
  })
})
