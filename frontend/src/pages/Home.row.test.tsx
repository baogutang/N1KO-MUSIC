/**
 * @vitest-environment happy-dom
 *
 * 阶段 1.12 回归（F22 补）：首页「最近添加」行的键盘语义。
 * 用户路径：键盘焦点在行卡片上按 Enter → 进专辑页；
 * 焦点在行内播放键上按 Enter → 不进专辑页（那是播放键自己的事）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const album = {
  id: 'alb-1', name: '最新专辑', artist: '歌手', serverId: 'nas',
  coverArt: 'ca-1', createdAt: Date.now(), songCount: 8,
}
const album2 = {
  id: 'alb-2', name: '次新专辑', artist: '歌手', serverId: 'nas',
  coverArt: 'ca-2', createdAt: Date.now() - 1000, songCount: 6,
}

vi.mock('@/hooks/useServerQueries', async importOriginal => ({
  ...(await importOriginal<typeof import('@/hooks/useServerQueries')>()),
  useRecentAlbums: vi.fn(() => ({ data: [album, album2], isLoading: false })),
  useArtists: vi.fn(() => ({ data: [], isLoading: false })),
}))
vi.mock('@/hooks/usePersonalizedRecommendations', () => ({
  usePersonalizedRecommendations: vi.fn(() => ({ profile: undefined, data: undefined, isFetching: false, refresh: vi.fn() })),
}))
vi.mock('@/components/sources/SourceShelves', () => ({
  MergedDailyRail: () => null,
  SourceCollections: () => null,
  SourceTopListsRail: () => null,
  SourceRecommendSheetsRail: () => null,
}))
vi.mock('@/api', () => ({
  createAdapter: vi.fn(), getAdapter: vi.fn(() => ({})),
  getAdapterFor: vi.fn(() => ({ getCoverUrl: vi.fn(() => 'x') })),
  hasAdapter: vi.fn(() => true), hasAdapterFor: vi.fn(() => true),
  findAdapterFor: vi.fn(() => ({ getCoverUrl: vi.fn(() => 'x') })),
  adapterForSource: vi.fn(), setPrimary: vi.fn(), listAdapters: vi.fn(() => []),
}))
vi.mock('@/utils/playActions', () => ({
  playAllInOrder: vi.fn(),
  playAllShuffled: vi.fn(),
  playListFrom: vi.fn(),
}))

import HomePage from './Home'
import { useServerStore } from '@/store/serverStore'
import { usePlayerStore } from '@/store/playerStore'

let lastPath = ''
function LocationProbe() {
  const location = useLocation()
  lastPath = location.pathname + location.search
  return null
}

let root: Root | null = null
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
})

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  useServerStore.setState({
    activeServerId: 'nas', connectedServerIds: ['nas'], isConnected: true,
    servers: [{ id: 'nas', name: 'NAS', type: 'subsonic' }],
  } as never)
  usePlayerStore.setState({ currentSong: null, isPlaying: false } as never)
  lastPath = '/'
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => {
    root!.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/']}>
          <LocationProbe />
          <HomePage />
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

async function flush(times = 6) {
  for (let i = 0; i < times; i++) {
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  }
}

/** 「最近添加」的行卡片：role=button 的那个容器 */
function findRecentRow(): HTMLElement {
    const row = [...document.querySelectorAll('[role="button"]')]
    .find(el => el.textContent?.includes('次新专辑'))
  expect(row, '最近添加里有这张专辑').toBeTruthy()
  return row as HTMLElement
}

describe('首页最近添加行的键盘语义（1.12 / F22）', () => {
  it('行卡片上的 Enter 进专辑页', async () => {
    await flush()
    const row = findRecentRow()
    act(() => {
      row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    await flush()
    expect(lastPath).toContain('/albums/alb-2')
  })

  it('行内按钮上的 Enter 不冒泡给卡片（不进专辑页）', async () => {
    await flush()
    const row = findRecentRow()
    const inner = row.querySelector('button') as HTMLButtonElement | null
    if (!inner) {
      // 行内没有按钮时（封面兜底），用子元素模拟 target !== currentTarget
      const child = row.firstElementChild as HTMLElement
      act(() => {
        child.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      })
    } else {
      act(() => {
        inner.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      })
    }
    await flush()
    expect(lastPath, '内层控件的按键不触发导航').toBe('/')
  })
})
