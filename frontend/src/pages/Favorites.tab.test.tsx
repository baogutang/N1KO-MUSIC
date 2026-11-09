/**
 * @vitest-environment happy-dom
 *
 * 收藏页回归：切到「专辑」标签 → 点进一张专辑 → 返回，被打回「歌曲」标签。
 * 标签只存在组件 state 里，页面卸载就丢。现在记在地址栏的 `?tab=` 里（replace，不在返回栈里留格），
 * 返回时由地址栏恢复；同时不能吞掉 `?src=` 这类别的参数。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { Link, MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Album, Song } from '@/api/types'

const starred = {
  songs: [{ id: 's1', title: '歌一', artist: 'A', album: 'AL', serverId: 'nas', duration: 100 }] as Song[],
  albums: [{ id: 'a1', name: '专辑一', artist: 'A', serverId: 'nas' }] as Album[],
}

vi.mock('@/hooks/useServerQueries', () => ({
  useStarred: vi.fn(() => ({ data: starred, isLoading: false, isError: false })),
}))
vi.mock('@/hooks/useSourceQueries', () => ({
  useConnectedSources: vi.fn(() => [{ serverId: 'nas', name: 'NAS', type: 'subsonic' }]),
  useSourceStarred: vi.fn(() => []),
}))
vi.mock('@/components/music/SongList', () => ({
  SongList: ({ songs }: { songs: Song[] }) => <ul data-testid="songs">{songs.map(s => <li key={s.id}>{s.title}</li>)}</ul>,
}))
vi.mock('@/components/music/AlbumCard', () => ({
  AlbumCard: ({ album }: { album: Album }) => <div data-testid="album">{album.name}</div>,
}))

import Favorites from './Favorites'

function Probe() {
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  return (
    <div>
      <output data-testid="loc">{pathname + search}</output>
      <Link to="/albums/a1">open-album</Link>
      <button onClick={() => navigate(-1)}>browser-back</button>
    </div>
  )
}

let root: Root | null = null
function mount(start: string) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  root = createRoot(host)
  act(() => {
    root!.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[start]}>
          <Probe />
          <Routes>
            <Route path="/favorites" element={<Favorites />} />
            <Route path="/albums/:id" element={<div>album page</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )
  })
}

async function flush(times = 4) {
  for (let i = 0; i < times; i++) {
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  }
}

const tabButton = (label: RegExp) =>
  [...document.querySelectorAll('button[aria-pressed]')].find(b => label.test(b.textContent ?? '')) as HTMLButtonElement
const pressed = () => document.querySelector('button[aria-pressed="true"]')?.textContent ?? ''
const loc = () => document.querySelector('[data-testid="loc"]')!.textContent

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterEach(() => {
  act(() => { root?.unmount() })
  root = null
  document.body.innerHTML = ''
})

describe('收藏页：标签记在地址栏', () => {
  it('默认是「歌曲」，地址栏干净', async () => {
    mount('/favorites')
    await flush()
    expect(pressed()).toMatch(/歌曲|Tracks/i)
    expect(document.querySelectorAll('[data-testid="songs"] li')).toHaveLength(1)
    expect(loc()).toBe('/favorites')
  })

  it('点「专辑」：写进 ?tab=albums；再点回「歌曲」：参数去掉', async () => {
    mount('/favorites')
    await flush()
    act(() => { tabButton(/专辑|Albums/i).click() })
    await flush()
    expect(pressed()).toMatch(/专辑|Albums/i)
    expect(loc()).toBe('/favorites?tab=albums')

    act(() => { tabButton(/歌曲|Tracks/i).click() })
    await flush()
    expect(loc()).toBe('/favorites')
  })

  it('进专辑再返回：仍停在「专辑」标签（旧实现被打回歌曲）', async () => {
    mount('/favorites')
    await flush()
    act(() => { tabButton(/专辑|Albums/i).click() })
    await flush()

    const open = [...document.querySelectorAll('a')].find(a => a.textContent === 'open-album')!
    act(() => { open.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })) })
    await flush()
    expect(document.body.textContent).toContain('album page')

    const back = [...document.querySelectorAll('button')].find(b => b.textContent === 'browser-back')!
    act(() => { back.click() })
    await flush()

    expect(loc()).toBe('/favorites?tab=albums')
    expect(pressed()).toMatch(/专辑|Albums/i)
    expect(document.querySelectorAll('[data-testid="album"]')).toHaveLength(1)
  })

  it('切标签是 replace：返回一次直接离开收藏页，不会在两个标签间来回', async () => {
    mount('/favorites')
    await flush()
    act(() => { tabButton(/专辑|Albums/i).click() })
    await flush()
    act(() => { tabButton(/歌曲|Tracks/i).click() })
    await flush()

    const back = [...document.querySelectorAll('button')].find(b => b.textContent === 'browser-back')!
    act(() => { back.click() })
    await flush()
    // 只有一格历史（initialEntries 的那一格）：返回无处可去，仍在原地，且没有多出 ?tab 的旧格
    expect(loc()).toBe('/favorites')
  })

  it('保留 ?src= 等其他参数；非法的 tab 值按「歌曲」处理', async () => {
    mount('/favorites?src=nas&tab=bogus')
    await flush()
    expect(pressed()).toMatch(/歌曲|Tracks/i)

    act(() => { tabButton(/专辑|Albums/i).click() })
    await flush()
    const params = new URLSearchParams(loc()!.split('?')[1])
    expect(params.get('src')).toBe('nas')
    expect(params.get('tab')).toBe('albums')
  })
})
