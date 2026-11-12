/**
 * @vitest-environment happy-dom
 *
 * 收起动画途中又点开：不能被旧的收起动画卸掉，页面要回到完全打开的状态；
 * 之后再收起仍然有动画、能正常卸载。
 * motion 的 animate 换成按定时器收尾的替身（隐藏标签页里 rAF 不触发，别依赖它），
 * 收尾时把最后一帧写到 style 上，方便断言「是不是又透明 / 位移了」。时长按 0.2 倍缩短。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const adapter = { getCoverUrl: vi.fn((id: string, size?: number) => `https://nas.test/cover/${id}?size=${size}`) }
vi.mock('@/api', () => ({
  createAdapter: vi.fn(),
  getAdapter: vi.fn(() => adapter),
  getAdapterFor: vi.fn(() => adapter),
  hasAdapter: vi.fn(() => true),
  hasAdapterFor: vi.fn(() => true),
  findAdapterFor: vi.fn(() => adapter),
  adapterForSource: vi.fn(),
  setPrimary: vi.fn(),
  listAdapters: vi.fn(() => []),
  subscribeAdapterRegistry: () => () => undefined,
  getAdapterRegistryVersion: () => 0,
}))
vi.mock('@/hooks/useServerQueries', async importOriginal => ({
  ...(await importOriginal<typeof import('@/hooks/useServerQueries')>()),
  useLyricsQuery: vi.fn(() => ({ data: undefined, isLoading: false, isError: false })),
}))
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }))

const SCALE = 0.2
vi.mock('motion/react', async importOriginal => {
  const mod = await importOriginal<typeof import('motion/react')>()
  const fakeAnimate = (target: unknown, keyframes: Record<string, unknown>, opts: { type?: string; duration?: number; delay?: number } = {}) => {
    const ms = ((opts.delay ?? 0) + (opts.type === 'spring' ? 0.5 : opts.duration ?? 0.3)) * 1000 * SCALE
    let resolve!: () => void
    const finished = new Promise<void>(r => { resolve = r })
    const apply = () => {
      if (!(target instanceof HTMLElement)) return
      for (const [k, v] of Object.entries(keyframes)) {
        const last = Array.isArray(v) ? v[v.length - 1] : v
        target.style.setProperty(k, String(last))
      }
    }
    const timer = setTimeout(() => { apply(); resolve() }, ms)
    return { finished, stop: () => { clearTimeout(timer); resolve() }, cancel: () => { clearTimeout(timer); resolve() } }
  }
  return { ...mod, animate: fakeAnimate }
})

import { FullscreenPlayerOverlay } from './FullscreenPlayerOverlay'
import { TooltipProvider } from '@/components/ui/tooltip'
import { usePlayerStore } from '@/store/playerStore'
import { useServerStore } from '@/store/serverStore'
import type { Song } from '@/api/types'

const song: Song = { id: 's1', title: '歌1', artist: 'A', album: 'AL', serverId: 'nas', duration: 200 }

let root: Root | null = null
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  window.HTMLElement.prototype.hasPointerCapture = () => false
  window.HTMLElement.prototype.setPointerCapture = () => undefined
  window.HTMLElement.prototype.releasePointerCapture = () => undefined
  useServerStore.setState({
    activeServerId: 'nas', connectedServerIds: ['nas'], isConnected: true,
    servers: [{ id: 'nas', name: 'NAS', type: 'subsonic' }],
  } as never)
  usePlayerStore.setState({
    currentSong: song, isPlaying: false, isFullscreen: true, isCarMode: false,
    queue: [song], queueIndex: 0, currentTime: 10, duration: 200, streamBuffering: false,
  } as never)
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => {
    root!.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter><TooltipProvider><FullscreenPlayerOverlay /></TooltipProvider></MemoryRouter>
      </QueryClientProvider>
    )
  })
})
afterEach(() => {
  act(() => { root?.unmount() })
  root = null
  document.body.innerHTML = ''
  usePlayerStore.setState({ isFullscreen: false })
  vi.clearAllMocks()
})

/** 播放器本体是懒加载的：等它真的挂上（出现 data-fs-reveal 元素；Suspense 兜底也带 .stage，不能以它为准），再开始计时，否则测的是 Suspense 兜底 */
async function ready() {
  for (let i = 0; i < 100 && !document.querySelector('[data-fs-reveal]'); i++) await act(async () => { await new Promise(r => setTimeout(r, 50)) })
  expect(document.querySelector('[data-fs-reveal]')).not.toBeNull()
  await wait(EXIT_MS)
}
const wait = (ms: number) => act(async () => { await new Promise(r => setTimeout(r, ms)) })
const setOpen = (open: boolean) => act(() => { usePlayerStore.getState().setFullscreen(open) })
const player = () => document.querySelector<HTMLElement>('[data-fullscreen-player]')
const stage = () => document.querySelector<HTMLElement>('.stage')
/** 收起动画（0.3s 级别）按缩放后走完所需的时间，留足余量 */
const EXIT_MS = 500 * SCALE + 150

/** 页面处于完全打开状态：没有被收起动画留下的透明 / 位移 */
function expectFullyOpen() {
  expect(player()).not.toBeNull()
  const s = stage()!
  expect(s.style.opacity).not.toBe('0')
  for (const el of document.querySelectorAll<HTMLElement>('[data-fullscreen-player] [data-fs-reveal]')) {
    expect(el.style.opacity).not.toBe('0')
  }
}

describe('收起途中重新打开', () => {
  it('收起动画结束前再打开：不卸载，且是打开状态', async () => {
    await ready()
    await setOpen(false)
    await wait(30)
    await setOpen(true)
    await wait(EXIT_MS + 100)
    expect(usePlayerStore.getState().isFullscreen).toBe(true)
    expectFullyOpen()
    expect(player()!.getAttribute('data-state')).toBe('open')
  })

  it('收起 → 等动画结束 → 卸载；再打开 → 重新挂载', async () => {
    await ready()
    await setOpen(false)
    await wait(EXIT_MS)
    expect(player()).toBeNull()
    await setOpen(true)
    await wait(EXIT_MS)
    expectFullyOpen()
  })

  it('减少动效：收起途中再打开同样不卸载、不留透明', async () => {
    const real = window.matchMedia
    window.matchMedia = ((q: string) => ({
      matches: q.includes('prefers-reduced-motion'), media: q, onchange: null,
      addEventListener: () => undefined, removeEventListener: () => undefined,
      addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false,
    })) as typeof window.matchMedia
    try {
      await ready()
      await setOpen(false)
      await wait(10)
      await setOpen(true)
      await wait(EXIT_MS + 100)
      expectFullyOpen()
      await setOpen(false)
      await wait(EXIT_MS)
      expect(player()).toBeNull()
    } finally {
      window.matchMedia = real
    }
  })

  it('重新打开之后再收起，仍能正常卸载', async () => {
    await ready()
    await setOpen(false)
    await wait(30)
    await setOpen(true)
    await wait(EXIT_MS)
    expect(player()).not.toBeNull()
    await setOpen(false)
    await wait(EXIT_MS)
    expect(player()).toBeNull()
  })
})
