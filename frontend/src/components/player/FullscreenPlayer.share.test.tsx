/**
 * @vitest-environment happy-dom
 *
 * 阶段 1.10 回归（F22 补）：全屏播放器的「分享链接」只对**主库自己的歌**出现。
 * 用户路径：正在播放网易云的歌 → 打开全屏 → 更多菜单 → 没有「分享链接」
 * （ShareDialog 只会写主库，给了入口只会建出指向别的曲子的分享）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@/api', () => ({
  createAdapter: vi.fn(),
  getAdapter: vi.fn(() => ({
    createShare: vi.fn(),
    getCoverUrl: vi.fn(() => 'x'),
  })),
  getAdapterFor: vi.fn(() => ({ getCoverUrl: vi.fn(() => 'x') })),
  hasAdapter: vi.fn(() => true),
  hasAdapterFor: vi.fn(() => true),
  findAdapterFor: vi.fn(() => null),
  adapterForSource: vi.fn(),
  setPrimary: vi.fn(),
  listAdapters: vi.fn(() => []),
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
import type { Song } from '@/api/types'

const song = (id: string, serverId: string): Song => ({
  id, title: `歌${id}`, artist: 'A', album: 'AL', serverId, duration: 200,
})

let root: Root | null = null
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
})

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  window.HTMLElement.prototype.hasPointerCapture = () => false
  window.HTMLElement.prototype.setPointerCapture = () => undefined
  window.HTMLElement.prototype.releasePointerCapture = () => undefined
  useServerStore.setState({
    activeServerId: 'nas', connectedServerIds: ['nas', 'wy'], isConnected: true,
    servers: [
      { id: 'nas', name: 'NAS', type: 'subsonic' },
      { id: 'wy', name: '网易云', type: 'plugin', pluginId: 'netease' } as never,
    ],
  } as never)
})
afterEach(() => {
  act(() => { root?.unmount() })
  root = null
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

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

async function flush(times = 6) {
  for (let i = 0; i < times; i++) {
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  }
}

/** 打开右上「更多」菜单，返回菜单里的条目文本 */
async function openMoreMenu(): Promise<string[]> {
  const trigger = [...document.querySelectorAll('button')]
    .find(b => /更多|More/i.test(b.getAttribute('aria-label') ?? ''))
  expect(trigger, '有「更多」菜单').toBeTruthy()
  act(() => {
    trigger!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    trigger!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await flush(2)
  const menu = document.querySelector('[role="menu"]')
  expect(menu, '菜单已打开').toBeTruthy()
  return [...menu!.querySelectorAll('[role="menuitem"]')].map(i => i.textContent ?? '')
}

describe('分享入口只给主库自己的歌（1.10 / F22）', () => {
  it('正在播放插件源的歌：菜单里没有「分享链接」', async () => {
    mountWith(song('w1', 'wy'))
    await flush()
    const items = await openMoreMenu()
    expect(items.some(t => /分享链接|Share link/i.test(t)), '插件歌不给分享入口').toBe(false)
  })

  it('正在播放主库自己的歌：菜单里有「分享链接」', async () => {
    mountWith(song('n1', 'nas'))
    await flush()
    const items = await openMoreMenu()
    expect(items.some(t => /分享链接|Share link/i.test(t)), '主库歌保留分享入口').toBe(true)
  })
})
