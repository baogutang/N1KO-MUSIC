/**
 * @vitest-environment happy-dom
 *
 * 沉浸样式（设置「播放详情页封面样式 › 沉浸」）：
 *   - 有封面时正在播放页换成大封面铺开的排法，色场抬亮一档（.stage-mid）；
 *   - 封面全部加载失败、或这首根本没有封面：退回方形；
 *   - 横屏卡片叠的「自动」让位给沉浸，「总是」照旧是卡片叠。
 * happy-dom 默认窗口 1024×768：横屏、够高，主指针不是粗的。
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

import { FullscreenPlayer } from './FullscreenPlayer'
import { TooltipProvider } from '@/components/ui/tooltip'
import { usePlayerStore } from '@/store/playerStore'
import { useServerStore } from '@/store/serverStore'
import { useSettingsStore } from '@/store/settingsStore'
import type { Song } from '@/api/types'

const song = (id: string, coverArt?: string): Song => ({
  id, title: `歌${id}`, artist: 'A', album: 'AL', serverId: 'nas', duration: 200, coverArt,
})

let root: Root | null = null
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
})
const realMatchMedia = window.matchMedia

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  window.HTMLElement.prototype.hasPointerCapture = () => false
  window.HTMLElement.prototype.setPointerCapture = () => undefined
  window.HTMLElement.prototype.releasePointerCapture = () => undefined
  useServerStore.setState({
    activeServerId: 'nas', connectedServerIds: ['nas'], isConnected: true,
    servers: [{ id: 'nas', name: 'NAS', type: 'subsonic' }],
  } as never)
  useSettingsStore.setState({ coverShape: 'immersive', playerCardMode: 'auto', coverRemoteTemplate: '' } as never)
})
afterEach(() => {
  act(() => { root?.unmount() })
  root = null
  document.body.innerHTML = ''
  window.matchMedia = realMatchMedia
  vi.clearAllMocks()
})

/** 让「主指针是粗的」成立（iPad / 手机浏览器），其余查询照旧 */
function coarsePointer() {
  window.matchMedia = ((query: string) => {
    const mql = realMatchMedia.call(window, query)
    if (query !== '(pointer: coarse)') return mql
    return {
      matches: true,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    } as MediaQueryList
  }) as typeof window.matchMedia
}

function mountWith(playing: Song) {
  usePlayerStore.setState({
    currentSong: playing, isPlaying: true, isFullscreen: true,
    queue: [playing], queueIndex: 0, currentTime: 10, duration: 200,
    streamBuffering: false,
  } as never)
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => {
    root!.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter><TooltipProvider><FullscreenPlayer /></TooltipProvider></MemoryRouter>
      </QueryClientProvider>
    )
  })
}

async function flush(times = 4) {
  for (let i = 0; i < times; i++) {
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  }
}

const stage = () => document.querySelector<HTMLElement>('.stage')
const artImg = () => document.querySelector<HTMLImageElement>('.immersive-art img')

describe('沉浸样式', () => {
  it('有封面：横屏是贴左的大封面，色场抬亮一档，封面按大图来要', async () => {
    mountWith(song('s1', 'c1'))
    await flush()
    expect(stage()?.dataset.immersive).toBe('side')
    expect(stage()?.classList.contains('stage-mid')).toBe(true)
    expect(artImg()?.getAttribute('src')).toBe('https://nas.test/cover/c1?size=1200')
    // 加载中不铺灰底音符：底下是色场
    expect(document.querySelector('.immersive-art .animate-pulse')).toBeNull()
  })

  it('封面加载失败：这首退回方形', async () => {
    mountWith(song('s1', 'c1'))
    await flush()
    act(() => { artImg()!.dispatchEvent(new Event('error')) })
    await flush()
    expect(stage()?.dataset.immersive).toBeUndefined()
    expect(stage()?.classList.contains('stage-mid')).toBe(false)
    expect(document.querySelector('.immersive-art')).toBeNull()
  })

  it('这首没有封面：直接是方形，不先闪一下沉浸', () => {
    mountWith(song('s2'))
    expect(stage()?.dataset.immersive).toBeUndefined()
  })

  it('样式是方形：照旧', async () => {
    useSettingsStore.setState({ coverShape: 'square' } as never)
    mountWith(song('s1', 'c1'))
    await flush()
    expect(stage()?.dataset.immersive).toBeUndefined()
  })
})

describe('横屏卡片叠与沉浸谁优先', () => {
  it('卡片叠「自动」+ 触屏横屏：让给沉浸', async () => {
    coarsePointer()
    mountWith(song('s1', 'c1'))
    await flush()
    expect(stage()?.dataset.immersive).toBe('side')
  })

  it('卡片叠「自动」+ 触屏横屏 + 方形：还是卡片叠', async () => {
    coarsePointer()
    useSettingsStore.setState({ coverShape: 'square' } as never)
    mountWith(song('s1', 'c1'))
    await flush()
    expect(document.querySelector('.card-stack')).not.toBeNull()
  })

  it('卡片叠「总是」：卡片叠照旧，不走沉浸', async () => {
    useSettingsStore.setState({ playerCardMode: 'always' } as never)
    mountWith(song('s1', 'c1'))
    await flush()
    expect(stage()?.dataset.immersive).toBeUndefined()
    expect(document.querySelector('.card-stack')).not.toBeNull()
  })
})
