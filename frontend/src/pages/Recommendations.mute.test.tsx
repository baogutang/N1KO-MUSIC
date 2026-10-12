/**
 * @vitest-environment happy-dom
 *
 * 复核 F1 回归：「查看全部」推荐页与首页同一条屏蔽过滤。
 * 用户路径：插件源每日推荐（10 分钟缓存，queryKey 不含屏蔽指纹）里有
 * 歌手 A 的歌 → 在这页看到它 → 屏蔽 A → 该页**立即**不再出现 A，
 * 不用等缓存过期。同时：失败的源要有一行「加载失败 · 重试」，
 * 而不是从页面上静默消失。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const { sourceGroups, librarySongs } = vi.hoisted(() => {
  const song = (id: string, title: string, artist: string, serverId: string) => ({
    id, title, artist, serverId, duration: 200, album: '同名专辑', albumId: 'a1', genre: '',
  })
  return {
    // 模拟 zipQueryResults 的产出：网易云成功、QQ 失败（非登录过期）
    sourceGroups: [
      {
        serverId: 'wy', pluginId: 'netease', name: '网易云',
        status: 'success' as const,
        data: [
          song('w1', '晴天旋律', '安静歌手', 'wy'),
          song('w2', '吵闹之歌', '吵闹乐队', 'wy'),
        ],
      },
      {
        serverId: 'qq', pluginId: 'qqmusic', name: 'QQ音乐',
        status: 'error' as const,
        error: 'network unreachable', errorCode: 'network',
      },
    ],
    librarySongs: [song('n1', 'NAS里的老歌', '本地歌手', 'nas')],
  }
})

vi.mock('@/hooks/useSourceQueries', async importOriginal => ({
  ...(await importOriginal<typeof import('@/hooks/useSourceQueries')>()),
  useConnectedSources: vi.fn(() => [
    { serverId: 'nas', name: 'NAS' },
    { serverId: 'wy', pluginId: 'netease', name: '网易云' },
    { serverId: 'qq', pluginId: 'qqmusic', name: 'QQ音乐' },
  ]),
  useSourceRecommendSongs: vi.fn(() => sourceGroups),
}))

vi.mock('@/hooks/usePersonalizedRecommendations', () => ({
  usePersonalizedRecommendations: vi.fn(() => ({
    data: librarySongs, isFetching: false, refresh: vi.fn(),
  })),
}))

vi.mock('@/api', () => ({
  createAdapter: vi.fn(), getAdapter: vi.fn(), getAdapterFor: vi.fn(),
  hasAdapter: vi.fn(() => false), hasAdapterFor: vi.fn(() => false),
  findAdapterFor: vi.fn(() => null), adapterForSource: vi.fn(),
  setPrimary: vi.fn(), listAdapters: vi.fn(() => []),
}))

import RecommendationsPage from './Recommendations'
import { useTasteStore } from '@/store/tasteStore'
import { useServerStore } from '@/store/serverStore'
import { usePlayerStore } from '@/store/playerStore'

let root: Root | null = null
beforeEach(() => {
  useTasteStore.setState({ mutedArtists: [], mutedGenres: [] })
  useServerStore.setState({
    activeServerId: 'nas',
    connectedServerIds: ['nas', 'wy', 'qq'],
    isConnected: true,
    servers: [
      { id: 'nas', name: 'NAS', type: 'subsonic' },
      { id: 'wy', name: '网易云', type: 'plugin', pluginId: 'netease' } as never,
      { id: 'qq', name: 'QQ音乐', type: 'plugin', pluginId: 'qqmusic' } as never,
    ],
  } as never)
  usePlayerStore.setState({ currentSong: null, isPlaying: false } as never)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  root = createRoot(host)
  act(() => {
    root!.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter><RecommendationsPage /></MemoryRouter>
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

async function flush(times = 10) {
  for (let i = 0; i < times; i++) await act(async () => { await Promise.resolve() })
}

describe('推荐页屏蔽过滤与失败源状态行（F1）', () => {
  it('屏蔽歌手后该页立即不含该歌手（不等 10 分钟缓存过期）', async () => {
    await flush()
    expect(document.body.textContent).toContain('吵闹之歌')

    // 用户屏蔽「吵闹乐队」——真实 store 动作，页面经 useRecommendationConstraints 响应
    act(() => { useTasteStore.getState().toggleArtist('吵闹乐队') })
    await flush()

    expect(document.body.textContent, '屏蔽后插件源缓存里的歌不再出现').not.toContain('吵闹之歌')
    expect(document.body.textContent, '其余推荐不受影响').toContain('晴天旋律')
    expect(document.body.textContent, '本地画像那份仍在').toContain('里的老歌')
  })

  it('失败的源占一行状态（带重试），不是静默消失', async () => {
    await flush()
    const retry = [...document.querySelectorAll('button')]
      .find(b => /重试|Retry/i.test(b.textContent ?? ''))
    expect(retry, 'QQ 源失败 → 有重试按钮').toBeTruthy()
    expect(document.body.textContent).toMatch(/加载失败|failed to load|Load error/i)
  })
})
