/**
 * @vitest-environment happy-dom
 *
 * 单音源搜索的「加载更多」回归：适配器写死 20 首 / 10 张 / 10 位，没有后文，
 * 用户搜「周杰伦」只看得到前 20 首。期望歌曲 / 专辑 / 歌手各有自己的按钮，
 * 按适配器的 offset 分页接着取；适配器说没有后文，或根本不支持分页，就不画按钮。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Album, Artist, Song } from '@/api/types'

const { searchAll, searchSection } = vi.hoisted(() => ({
  searchAll: vi.fn(),
  searchSection: vi.fn(),
}))
/** 适配器是否支持分页：每条用例各自切换 */
const { caps } = vi.hoisted(() => ({ caps: { paged: true } }))

vi.mock('@/api', () => {
  const adapter = () => ({
    searchAll,
    ...(caps.paged ? { searchSection } : {}),
    getCoverUrl: vi.fn(() => 'x'),
  })
  return {
    createAdapter: vi.fn(),
    getAdapter: vi.fn(adapter),
    getAdapterFor: vi.fn(adapter),
    hasAdapter: vi.fn(() => true),
    hasAdapterFor: vi.fn(() => true),
    findAdapterFor: vi.fn(() => ({ getCoverUrl: vi.fn(() => 'x') })),
    adapterForSource: vi.fn(adapter),
    setPrimary: vi.fn(),
    listAdapters: vi.fn(() => []),
  }
})
// 列表是虚拟化的、卡片带封面请求：这里只数条目
vi.mock('@/components/music/SongList', () => ({
  SongList: ({ songs }: { songs: Song[] }) => (
    <ul data-testid="songs">{songs.map(s => <li key={s.id}>{s.title}</li>)}</ul>
  ),
}))
vi.mock('@/components/music/AlbumCard', () => ({
  AlbumCard: ({ album }: { album: Album }) => <div data-testid="album">{album.name}</div>,
}))
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }))

import SearchPage from './Search'
import { useServerStore } from '@/store/serverStore'
import { toast } from '@/components/ui/use-toast'

const song = (i: number): Song => ({ id: `s${i}`, title: `歌${i}`, artist: 'A', album: 'AL', serverId: 'nas', duration: 100 })
const album = (i: number): Album => ({ id: `a${i}`, name: `专辑${i}`, artist: 'A', serverId: 'nas' } as Album)
const artist = (i: number): Artist => ({ id: `r${i}`, name: `歌手${i}`, serverId: 'nas' } as Artist)
const many = <T,>(from: number, n: number, make: (i: number) => T) => Array.from({ length: n }, (_, k) => make(from + k))

let root: Root | null = null
function mount() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  root = createRoot(host)
  act(() => {
    root!.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/search?q=hello']}>
          <SearchPage />
        </MemoryRouter>
      </QueryClientProvider>
    )
  })
}

async function flush(times = 8) {
  for (let i = 0; i < times; i++) {
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  }
}

const section = (name: 'songs' | 'albums' | 'artists') =>
  document.querySelector(`section[aria-labelledby="search-${name}"]`) as HTMLElement | null
const moreButton = (name: 'songs' | 'albums' | 'artists') =>
  [...(section(name)?.querySelectorAll('button') ?? [])].find(b => /加载更多|Load more/i.test(b.textContent ?? '')) as HTMLButtonElement | undefined

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  caps.paged = true
  useServerStore.setState({
    activeServerId: 'nas', connectedServerIds: ['nas'], isConnected: true,
    servers: [{ id: 'nas', name: 'NAS', type: 'subsonic' }],
  } as never)
  searchAll.mockResolvedValue({
    songs: many(0, 20, song),
    albums: many(0, 10, album),
    artists: many(0, 10, artist),
    sectionHasMore: { songs: true, albums: true, artists: true },
  })
  searchSection.mockImplementation(async (_q: string, sec: 'songs' | 'albums' | 'artists', offset: number) => {
    // 歌曲只剩 5 首（到尾），专辑与歌手还满一页
    if (sec === 'songs') return { items: many(offset, 5, song), hasMore: false }
    if (sec === 'albums') return { items: many(offset, 10, album), hasMore: true }
    return { items: many(offset, 10, artist), hasMore: true }
  })
})
afterEach(() => {
  act(() => { root?.unmount() })
  root = null
  document.body.innerHTML = ''
  window.history.replaceState(null, '')
  vi.clearAllMocks()
})

describe('单音源搜索：各分区加载更多', () => {
  it('歌曲 / 专辑 / 歌手各有一枚按钮；点歌曲那枚按 offset=20 接着取，只动歌曲分区', async () => {
    mount()
    await flush()
    expect(document.querySelectorAll('[data-testid="songs"] li')).toHaveLength(20)
    expect(moreButton('songs'), '歌曲区有按钮').toBeTruthy()
    expect(moreButton('albums'), '专辑区有按钮').toBeTruthy()
    expect(moreButton('artists'), '歌手区有按钮').toBeTruthy()

    await act(async () => { moreButton('songs')!.click() })
    await flush()

    expect(searchSection).toHaveBeenCalledWith('hello', 'songs', 20)
    expect(document.querySelectorAll('[data-testid="songs"] li'), '歌曲 20 + 5').toHaveLength(25)
    expect(document.querySelectorAll('[data-testid="album"]'), '专辑没被动').toHaveLength(10)
    expect(moreButton('songs'), '适配器说到尾了：按钮消失').toBeFalsy()
    expect(moreButton('albums'), '专辑区的按钮还在').toBeTruthy()
  })

  it('专辑、歌手也各自分页（offset 是当前已有条数）', async () => {
    mount()
    await flush()

    await act(async () => { moreButton('albums')!.click() })
    await flush()
    expect(searchSection).toHaveBeenCalledWith('hello', 'albums', 10)
    expect(document.querySelectorAll('[data-testid="album"]')).toHaveLength(20)

    await act(async () => { moreButton('artists')!.click() })
    await flush()
    expect(searchSection).toHaveBeenCalledWith('hello', 'artists', 10)
    expect(section('artists')!.querySelectorAll('button')).toHaveLength(20 + 1) // 20 位 + 一枚「加载更多」
  })

  it('取的过程中按钮禁用，连点只发一次请求', async () => {
    mount()
    await flush()
    let release!: () => void
    searchSection.mockImplementationOnce(() => new Promise(r => {
      release = () => r({ items: many(20, 5, song), hasMore: false })
    }))

    await act(async () => { moreButton('songs')!.click() })
    const busy = [...section('songs')!.querySelectorAll('button')].find(b => b.disabled)
    expect(busy, '取页中按钮禁用').toBeTruthy()
    await act(async () => { busy!.click(); busy!.click() })
    expect(searchSection).toHaveBeenCalledTimes(1)

    await act(async () => { release() })
    await flush()
    expect(document.querySelectorAll('[data-testid="songs"] li')).toHaveLength(25)
  })

  it('取失败：提示一下，列表原样保留，按钮还在可以再点', async () => {
    mount()
    await flush()
    searchSection.mockRejectedValueOnce(new Error('boom'))

    await act(async () => { moreButton('songs')!.click() })
    await flush()

    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }))
    expect(document.querySelectorAll('[data-testid="songs"] li')).toHaveLength(20)
    expect(moreButton('songs')).toBeTruthy()
    expect(moreButton('songs')!.disabled).toBe(false)
  })

  it('首批就没有后文（适配器标了 false）：不画按钮', async () => {
    searchAll.mockResolvedValue({
      songs: many(0, 3, song), albums: many(0, 2, album), artists: many(0, 1, artist),
      sectionHasMore: { songs: false, albums: false, artists: false },
    })
    mount()
    await flush()
    expect(document.querySelectorAll('[data-testid="songs"] li')).toHaveLength(3)
    expect(moreButton('songs')).toBeFalsy()
    expect(moreButton('albums')).toBeFalsy()
    expect(moreButton('artists')).toBeFalsy()
  })

  it('适配器不支持分页（没有 searchSection）：即使有 sectionHasMore 也不画按钮', async () => {
    caps.paged = false
    mount()
    await flush()
    expect(document.querySelectorAll('[data-testid="songs"] li')).toHaveLength(20)
    expect(moreButton('songs')).toBeFalsy()
    expect(moreButton('albums')).toBeFalsy()
    expect(moreButton('artists')).toBeFalsy()
  })
})
