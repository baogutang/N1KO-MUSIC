/**
 * @vitest-environment happy-dom
 *
 * 复核 F12 回归：浏览页的加载态不许盖住已到的分节；出错时不撒「0」的谎。
 * - 歌单页多源：NAS 已回、网易云还在转 → NAS 的分节（含它的歌单）可见，
 *   骨架只出现在还在加载的那一节里（旧实现整页 12 格骨架盖掉一切）。
 * - 歌手页出错：页头不显示「0 位」，正文是带重试的错误态。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const { useArtists } = vi.hoisted(() => ({ useArtists: vi.fn() }))
const { sourcePlaylistsGroups } = vi.hoisted(() => ({ sourcePlaylistsGroups: [] as unknown[] }))

vi.mock('@/hooks/useServerQueries', () => ({
  useArtists,
  usePlaylists: vi.fn(() => ({})),
  useCreatePlaylist: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useAddToPlaylist: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useDeletePlaylist: vi.fn(() => ({ mutateAsync: vi.fn() })),
  queryKeys: { playlists: () => ['playlists'] },
}))
vi.mock('@/hooks/useSourceQueries', async importOriginal => ({
  ...(await importOriginal<typeof import('@/hooks/useSourceQueries')>()),
  useConnectedSources: vi.fn(() => [
    { serverId: 'nas', name: 'NAS' },
    { serverId: 'wy', pluginId: 'netease', name: '网易云' },
  ]),
  useSourceCapabilities: vi.fn(() => ({})),
  useSourcePlaylists: vi.fn(() => sourcePlaylistsGroups),
  useBrowseSource: vi.fn(() => ({
    available: [{ serverId: 'nas', name: 'NAS' }],
    current: { serverId: 'nas', name: 'NAS' },
  })),
}))
vi.mock('@/api', () => ({
  createAdapter: vi.fn(),
  getAdapter: vi.fn(() => ({ createPlaylist: vi.fn() })),
  getAdapterFor: vi.fn(() => ({ getCoverUrl: vi.fn(() => 'x') })),
  hasAdapter: vi.fn(() => true),
  hasAdapterFor: vi.fn(() => true),
  findAdapterFor: vi.fn(() => null),
  adapterForSource: vi.fn(),
  setPrimary: vi.fn(),
  listAdapters: vi.fn(() => []),
}))
vi.mock('@/store/localPlaylistStore', () => {
  const state = {
    playlists: [], loadError: null,
    load: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
  }
  return {
    useLocalPlaylistStore: Object.assign(
      vi.fn((selector?: (s: unknown) => unknown) => (selector ? selector(state) : state)),
      { getState: () => state }
    ),
  }
})

import PlaylistsPage from './Playlists'
import ArtistsPage from './Artists'
import { useServerStore } from '@/store/serverStore'

let root: Root | null = null
let queryClient: QueryClient

function mountAt(path: string, el: React.ReactElement) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  root = createRoot(host)
  act(() => {
    root!.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[path]}>
          <Routes><Route path={path} element={el} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )
  })
}

async function flush(times = 6) {
  for (let i = 0; i < times; i++) {
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  }
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  useServerStore.setState({
    activeServerId: 'nas',
    connectedServerIds: ['nas', 'wy'],
    isConnected: true,
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
  sourcePlaylistsGroups.length = 0
})

describe('歌单页：骨架只在分节内（F12）', () => {
  it('NAS 已回、网易云加载中：NAS 的歌单可见，骨架只占网易云那一节', async () => {
    sourcePlaylistsGroups.push(
      {
        serverId: 'nas', pluginId: undefined, name: 'NAS',
        status: 'success' as const,
        data: [{ id: 'pl1', name: '路上的歌单', songCount: 3, serverId: 'nas' }],
      },
      { serverId: 'wy', pluginId: 'netease', name: '网易云', status: 'loading' as const },
    )

    mountAt('/playlists', <PlaylistsPage />)
    await flush()

    expect(document.body.textContent, '已返回的分节不被整页骨架盖掉').toContain('路上的歌单')
    // 还在加载的那节摆骨架（v6 起是 .skeleton 的闪光块；旧的 animate-pulse 也算），而不是整页 12 格
    const skeletons = document.querySelectorAll('.skeleton, .animate-pulse')
    expect(skeletons.length, '骨架数量有限（分节内 6 格 ×2）').toBeLessThanOrEqual(14)
    expect(skeletons.length, '确实有骨架').toBeGreaterThanOrEqual(2)
  })

  it('歌单页 query error → 各分节给重试，不是「创建第一个歌单」', async () => {
    sourcePlaylistsGroups.push(
      { serverId: 'nas', name: 'NAS', status: 'error' as const, error: 'boom', errorCode: 'network' },
      { serverId: 'wy', pluginId: 'netease', name: '网易云', status: 'error' as const, error: 'boom', errorCode: 'network' },
    )

    mountAt('/playlists', <PlaylistsPage />)
    await flush()

    const retry = [...document.querySelectorAll('button')].find(b => /重试|Retry/i.test(b.textContent ?? ''))
    expect(retry, '有重试按钮').toBeTruthy()
    expect(document.body.textContent).not.toMatch(/创建第一个歌单|Create your first playlist/i)
  })
})

describe('歌手页：出错不撒「0」的谎（F12）', () => {
  it('query error → 带重试的错误态，页头不显示计数', async () => {
    useArtists.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: vi.fn() })

    mountAt('/artists', <ArtistsPage />)
    await flush()

    const retry = [...document.querySelectorAll('button')].find(b => /重试|Retry/i.test(b.textContent ?? ''))
    expect(retry, '有重试按钮').toBeTruthy()
    expect(document.body.textContent).not.toMatch(/0\s*位|0\s*artists/i)
  })
})
