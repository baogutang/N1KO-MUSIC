/**
 * @vitest-environment happy-dom
 *
 * 歌手页回归：
 * - 「热门歌曲」服务端没给就不显示这一节（此前拿全部歌曲的前 5 首顶上，和下面的列表一模一样）；
 * - 简介是 HTML（Subsonic / Last.fm 常带 `<a>Read more on Last.fm</a>`）：转成纯文本，不原样露标签；
 * - 「展开」只在文字真的被截断时出现。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ArtistDetail, Song } from '@/api/types'

const { useArtistDetail } = vi.hoisted(() => ({ useArtistDetail: vi.fn() }))

vi.mock('@/hooks/useServerQueries', () => ({ useArtistDetail }))
vi.mock('@/api', () => ({
  findAdapterFor: vi.fn(() => null),
  getAdapterFor: vi.fn(),
}))
// 与本测试无关的重部件：头部（滚动联动 / 取色）、书架、档案、边注
vi.mock('@/components/common/DetailHero', () => ({
  DetailHero: ({ title, actions }: { title: React.ReactNode; actions?: React.ReactNode }) => (
    <header><h1>{title}</h1>{actions}</header>
  ),
}))
vi.mock('@/components/music/DiscographyRail', () => ({ DiscographyRail: () => null }))
vi.mock('@/components/music/ArtistDossier', () => ({ ArtistDossier: () => null }))
vi.mock('@/components/music/MarginNote', () => ({ MarginNote: () => null }))
vi.mock('@/components/music/SongList', () => ({
  SongList: ({ songs }: { songs: Song[] }) => (
    <ul data-testid="songs">{songs.map(s => <li key={s.id}>{s.title}</li>)}</ul>
  ),
}))

import ArtistDetailPage from './ArtistDetail'
import { useServerStore } from '@/store/serverStore'

const song = (i: number): Song => ({ id: `s${i}`, title: `歌${i}`, artist: 'A', album: 'AL', serverId: 'nas', duration: 100 })
const artistWith = (extra: Partial<ArtistDetail>): ArtistDetail => ({
  id: 'ar1', name: '歌手甲', serverId: 'nas', albums: [], songs: [], ...extra,
} as ArtistDetail)

let root: Root | null = null
function mount() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => {
    root!.render(
      <MemoryRouter initialEntries={['/artists/ar1']}>
        <Routes><Route path="/artists/:id" element={<ArtistDetailPage />} /></Routes>
      </MemoryRouter>
    )
  })
}

const expandButton = () =>
  [...document.querySelectorAll('button')].find(b => /^(展开|Expand|收起|Collapse)$/.test((b.textContent ?? '').trim()))

/** happy-dom 不排版：scrollHeight / clientHeight 恒为 0。按需要伪造，模拟「文字被 3 行截断」与「一行就放得下」 */
function stubLayout(scrollHeight: number, clientHeight: number) {
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => scrollHeight })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => clientHeight })
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  useServerStore.setState({
    activeServerId: 'nas', connectedServerIds: ['nas'], isConnected: true,
    servers: [{ id: 'nas', name: 'NAS', type: 'subsonic' }],
  } as never)
})
afterEach(() => {
  act(() => { root?.unmount() })
  root = null
  document.body.innerHTML = ''
  // @ts-expect-error 还原为 happy-dom 自带的实现
  delete HTMLElement.prototype.scrollHeight
  // @ts-expect-error 同上，还原 happy-dom 自带的实现
  delete HTMLElement.prototype.clientHeight
  vi.clearAllMocks()
})

describe('歌手页：热门歌曲', () => {
  it('服务端没给热门歌曲：不显示这一节，也不拿全部歌曲的前几首顶上', () => {
    useArtistDetail.mockReturnValue({
      data: artistWith({ topSongs: [], songs: Array.from({ length: 30 }, (_, i) => song(i)) }),
      isLoading: false,
    })
    mount()
    expect(document.body.textContent).not.toMatch(/热门歌曲|Top songs/)
    // 全部歌曲那一节照常
    expect(document.body.textContent).toMatch(/全部歌曲|All songs/)
  })

  it('服务端给了：显示，且只列前 5 首', () => {
    useArtistDetail.mockReturnValue({
      data: artistWith({
        topSongs: Array.from({ length: 8 }, (_, i) => song(100 + i)),
        songs: Array.from({ length: 30 }, (_, i) => song(i)),
      }),
      isLoading: false,
    })
    mount()
    expect(document.body.textContent).toMatch(/热门歌曲|Top songs/)
    const lists = document.querySelectorAll('[data-testid="songs"]')
    expect(lists[0].querySelectorAll('li')).toHaveLength(5)
  })
})

describe('歌手页：简介', () => {
  const html = 'Foo is a band. Formed in &quot;1990&quot; &amp; still touring. <a target="_blank" rel="nofollow" href="https://www.last.fm/music/Foo">Read more on Last.fm</a>'

  it('HTML 转成纯文本：不露标签、实体已解码、Last.fm 的「Read more」尾巴去掉', () => {
    stubLayout(100, 60)
    useArtistDetail.mockReturnValue({ data: artistWith({ biography: html }), isLoading: false })
    mount()
    const text = document.body.textContent ?? ''
    expect(text).toContain('Foo is a band. Formed in "1990" & still touring.')
    expect(text).not.toMatch(/<a|href|<\/a>/)
    expect(text).not.toMatch(/Read more/i)
    // 没有把它当 HTML 渲染出一个链接
    expect(document.querySelector('a[href*="last.fm"]')).toBeNull()
  })

  it('被截断（内容比框高）：出现「展开」，点了变「收起」', () => {
    stubLayout(100, 60)
    useArtistDetail.mockReturnValue({ data: artistWith({ biography: html }), isLoading: false })
    mount()
    expect(expandButton()?.textContent).toMatch(/展开|Expand/)
    act(() => { expandButton()!.click() })
    expect(expandButton()?.textContent).toMatch(/收起|Collapse/)
  })

  it('短简介（一行就放得下）：没有「展开」', () => {
    stubLayout(24, 24)
    useArtistDetail.mockReturnValue({ data: artistWith({ biography: '一句话的简介。' }), isLoading: false })
    mount()
    expect(document.body.textContent).toContain('一句话的简介。')
    expect(expandButton()).toBeUndefined()
  })

  it('去掉标签后什么都不剩（只有一条 Read more 链接）：不显示简介区', () => {
    stubLayout(0, 0)
    useArtistDetail.mockReturnValue({
      data: artistWith({ biography: '<a href="https://www.last.fm/music/Foo">Read more on Last.fm</a>' }),
      isLoading: false,
    })
    mount()
    expect(document.body.textContent).not.toMatch(/Read more/i)
    expect(expandButton()).toBeUndefined()
  })
})
