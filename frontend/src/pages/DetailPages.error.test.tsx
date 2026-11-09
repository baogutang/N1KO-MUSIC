/**
 * @vitest-environment happy-dom
 *
 * 专辑页 / 歌单页回归：断网时专辑页写「专辑不存在」且没有重试，歌单页出错也没有重试。
 * 「出错」与「真的不存在」是两件事（同 SongDetail 的 F2）：
 * - 出错（断网、500、凭据过期……）：出错说明 + 「重试」按钮，点了重新请求；
 * - 服务端明确说没有（协议码 not-found / HTTP 404）：才显示「不存在」，重试没有意义。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const { getAlbumDetail, getPlaylistDetail } = vi.hoisted(() => ({
  getAlbumDetail: vi.fn(),
  getPlaylistDetail: vi.fn(),
}))

vi.mock('@/api', () => ({
  createAdapter: vi.fn(), getAdapter: vi.fn(),
  getAdapterFor: vi.fn(() => ({ getAlbumDetail, getPlaylistDetail, getCoverUrl: vi.fn(() => 'x') })),
  hasAdapter: vi.fn(() => false), hasAdapterFor: vi.fn(() => true),
  findAdapterFor: vi.fn(() => null),
  adapterForSource: vi.fn(() => ({ getAlbumDetail, getPlaylistDetail, getCoverUrl: vi.fn(() => 'x') })),
  setPrimary: vi.fn(), listAdapters: vi.fn(() => []),
}))
// 成功后的整页与本测试无关：头部（滚动联动 / 取色）、曲目列表、说明、边注
vi.mock('@/components/common/DetailHero', () => ({
  DetailHero: ({ title }: { title: React.ReactNode }) => <header><h1>{title}</h1></header>,
}))
vi.mock('@/components/music/SongList', () => ({ SongList: () => null }))
vi.mock('@/components/music/LinerNotes', () => ({ LinerNotes: () => null }))
vi.mock('@/components/music/MarginNote', () => ({ MarginNote: () => null }))

import AlbumDetailPage from './AlbumDetail'
import PlaylistDetail from './PlaylistDetail'
import { useServerStore } from '@/store/serverStore'

let root: Root | null = null
let queryClient: QueryClient

function mount(path: string, route: string, el: React.ReactElement) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => {
    root!.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[path]}>
          <Routes><Route path={route} element={el} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )
  })
}

async function flush(times = 6) {
  // react-query 的 notifyManager 用宏任务批量通知，只等微任务会读不到 error 态
  for (let i = 0; i < times; i++) {
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  }
}

const retryButton = () =>
  [...document.querySelectorAll('button')].find(b => /重试|Retry/i.test(b.textContent ?? ''))
const NOT_FOUND_ALBUM = /这张专辑不在了|album is gone/i
const NOT_FOUND_PLAYLIST = /这个歌单不在了|playlist is gone/i

function coded(code: string) {
  const err = new Error(code) as Error & { code: string }
  err.code = code
  return err
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  useServerStore.setState({
    activeServerId: 'nas', connectedServerIds: ['nas'], isConnected: true,
    servers: [{ id: 'nas', name: 'NAS', type: 'subsonic' }],
  } as never)
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
})
afterEach(() => {
  act(() => { root?.unmount() })
  root = null
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

const album = { id: 'al1', name: '专辑甲', artist: 'A', serverId: 'nas', songs: [] }
const playlist = { id: 'pl1', name: '歌单甲', serverId: 'nas', songs: [] }

describe('专辑页：出错 ≠ 不存在', () => {
  const open = () => mount('/albums/al1?src=nas', '/albums/:id', <AlbumDetailPage />)

  it('断网：出错说明 + 重试，不说「专辑不存在」；点重试重新请求并显示专辑', async () => {
    getAlbumDetail.mockRejectedValueOnce(new Error('Network Error'))
    open()
    await flush()

    expect(document.body.textContent).not.toMatch(NOT_FOUND_ALBUM)
    expect(retryButton(), '有重试按钮').toBeTruthy()

    getAlbumDetail.mockResolvedValueOnce(album)
    await act(async () => { retryButton()!.click() })
    await flush()

    expect(getAlbumDetail).toHaveBeenCalledTimes(2)
    expect(document.body.textContent).toContain('专辑甲')
    expect(retryButton()).toBeUndefined()
  })

  it('协议码 not-found（Subsonic 70）：才显示「不存在」，没有重试', async () => {
    getAlbumDetail.mockRejectedValueOnce(coded('not-found'))
    open()
    await flush()

    expect(document.body.textContent).toMatch(NOT_FOUND_ALBUM)
    expect(retryButton()).toBeUndefined()
  })

  it('HTTP 404（Jellyfin / Emby）同样是「不存在」', async () => {
    getAlbumDetail.mockRejectedValueOnce(Object.assign(new Error('404'), { response: { status: 404 } }))
    open()
    await flush()

    expect(document.body.textContent).toMatch(NOT_FOUND_ALBUM)
    expect(retryButton()).toBeUndefined()
  })

  it('服务器 500：是出错，给重试', async () => {
    getAlbumDetail.mockRejectedValueOnce(Object.assign(new Error('500'), { response: { status: 500 } }))
    open()
    await flush()

    expect(document.body.textContent).not.toMatch(NOT_FOUND_ALBUM)
    expect(retryButton()).toBeTruthy()
  })
})

describe('歌单页：出错 ≠ 不存在', () => {
  const open = () => mount('/playlists/pl1?src=nas', '/playlists/:id', <PlaylistDetail />)

  it('断网：出错说明 + 重试；点重试重新请求并显示歌单', async () => {
    getPlaylistDetail.mockRejectedValueOnce(new Error('Network Error'))
    open()
    await flush()

    expect(document.body.textContent).not.toMatch(NOT_FOUND_PLAYLIST)
    expect(retryButton(), '有重试按钮').toBeTruthy()

    getPlaylistDetail.mockResolvedValueOnce(playlist)
    await act(async () => { retryButton()!.click() })
    await flush()

    expect(getPlaylistDetail).toHaveBeenCalledTimes(2)
    expect(document.body.textContent).toContain('歌单甲')
    expect(retryButton()).toBeUndefined()
  })

  it('not-found：显示「不存在」和返回，没有重试', async () => {
    getPlaylistDetail.mockRejectedValueOnce(coded('not-found'))
    open()
    await flush()

    expect(document.body.textContent).toMatch(NOT_FOUND_PLAYLIST)
    expect(retryButton()).toBeUndefined()
    expect([...document.querySelectorAll('button')].some(b => /返回|Back/i.test(b.textContent ?? ''))).toBe(true)
  })
})
