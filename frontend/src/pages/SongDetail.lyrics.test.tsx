/**
 * @vitest-environment happy-dom
 *
 * 阶段 1.8 回归：详情页点「歌词」打开的是**本曲**的歌词预览，
 * 不再「后退一页再打开正在播放那首的全屏」。
 * 用户路径：正在听 A，从列表点进 B 的详情 → 点「歌词」行 →
 * 留在本页看到 B 的歌词（或加载/无歌词说明），地址没有后退。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const { getSong } = vi.hoisted(() => ({ getSong: vi.fn() }))

vi.mock('@/api', () => ({
  createAdapter: vi.fn(), getAdapter: vi.fn(), getAdapterFor: vi.fn(() => ({ getSong, getLyrics: vi.fn() })),
  hasAdapter: vi.fn(() => false), hasAdapterFor: vi.fn(() => true),
  findAdapterFor: vi.fn(() => null), adapterForSource: vi.fn(),
  setPrimary: vi.fn(), listAdapters: vi.fn(() => []),
}))

const { lyricsQueryState } = vi.hoisted(() => ({ lyricsQueryState: {} as Record<string, unknown> }))

vi.mock('@/hooks/useServerQueries', async importOriginal => ({
  ...(await importOriginal<typeof import('@/hooks/useServerQueries')>()),
  useLyricsQuery: vi.fn(() => lyricsQueryState),
}))

import SongDetailPage from './SongDetail'
import { useServerStore } from '@/store/serverStore'
import { usePlayerStore } from '@/store/playerStore'

/** 探针：记录当前路由位置（后退会被看见） */
let lastPath = ''
function LocationProbe() {
  lastPath = useLocation().pathname + useLocation().search
  return null
}

let root: Root | null = null
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
})

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  // 正在播放的是另一首（A）：详情页看的是 B
  usePlayerStore.setState({
    currentSong: { id: 'song-a', title: '正在听的歌', artist: 'X', serverId: 'nas', duration: 100, album: '', albumId: '' },
    isPlaying: true,
    isFullscreen: false,
  } as never)
  useServerStore.setState({
    activeServerId: 'nas',
    connectedServerIds: ['nas'],
    isConnected: true,
    servers: [{ id: 'nas', name: 'NAS', type: 'subsonic' }],
  } as never)
  getSong.mockResolvedValue({
    id: 'song-b', title: '详情页的歌', artist: 'Y', serverId: 'nas', duration: 180, album: '', albumId: '',
  })
  lyricsQueryState.data = {
    songId: 'song-b',
    lines: [{ time: 0, text: '这是B的歌词第一行' }],
    synced: false,
  }
  lyricsQueryState.isLoading = false
  lyricsQueryState.isError = false

  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => {
    root!.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/songs/song-b?src=nas']}>
          <LocationProbe />
          <Routes><Route path="/songs/:id" element={<SongDetailPage />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )
  })
})
afterEach(() => {
  act(() => { root?.unmount() })
  root = null
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

async function flush(times = 8) {
  for (let i = 0; i < times; i++) {
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  }
}

describe('详情页本曲歌词预览（阶段 1.8 / F22）', () => {
  it('点「歌词」→ 留在本页看 B 的歌词，不后退开正在播放那首的全屏', async () => {
    await flush()
    expect(document.body.textContent).toContain('详情页的歌')

    const lyricsRow = [...document.querySelectorAll('[role="button"], button, [class*="linkable"], div')]
      .find(el => el.textContent?.includes('歌') && el.textContent?.includes('本页') )
    // 用更直接的锚点：歌词行按钮（Row 组件 linkable）
    const row = [...document.querySelectorAll('*')].find(el =>
      el.children.length === 0 && /查看本曲歌词|View lyrics for this track/i.test(el.textContent ?? ''))
    expect(row, '非播放曲的歌词行写「在本页查看」').toBeTruthy()
    const clickable = row!.closest('[role="button"], button') ?? row!
    act(() => { clickable.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await flush()

    expect(lastPath, '地址没有后退').toContain('/songs/song-b')
    expect(usePlayerStore.getState().isFullscreen, '没有打开别人的全屏').toBe(false)
    expect(document.body.textContent, '本曲歌词就在页面上').toMatch(/B\s*的歌词第一行/)
  })
})
