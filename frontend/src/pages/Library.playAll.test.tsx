/**
 * @vitest-environment happy-dom
 *
 * 曲库页「播放全部」回归：页头写的是全库总数，点下去却只播已加载的前 100 首。
 * 期望：点击时把剩下的分页取完再播；取的过程中按钮忙碌、不会被连点重复触发；
 * 有一个上限（5000 首），免得几十万首的库把内存和请求都吃光。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Song } from '@/api/types'

const { adapter, playAllInOrder } = vi.hoisted(() => ({
  adapter: {
    getSongs: vi.fn(),
    getAlbums: vi.fn(),
    getArtists: vi.fn(),
  },
  playAllInOrder: vi.fn(),
}))

vi.mock('@/api', async importOriginal => ({
  ...(await importOriginal<typeof import('@/api')>()),
  getAdapter: vi.fn(() => adapter),
  adapterForSource: vi.fn(() => adapter),
  hasAdapter: vi.fn(() => true),
  hasAdapterFor: vi.fn(() => true),
}))
vi.mock('@/hooks/useSourceQueries', async importOriginal => ({
  ...(await importOriginal<typeof import('@/hooks/useSourceQueries')>()),
  useSourceCapabilities: vi.fn(() => ({})),
}))
// 列表本身与本测试无关（它是虚拟化的，happy-dom 里量不出高度）
vi.mock('@/components/music/SongList', () => ({ SongList: () => null }))
vi.mock('@/utils/playActions', () => ({
  playAllInOrder,
  shuffleWholeLibrary: vi.fn(),
}))

import Library from './Library'
import { useServerStore } from '@/store/serverStore'

const song = (i: number): Song => ({
  id: `s${i}`, title: `歌${i}`, artist: 'A', album: 'AL', serverId: 'nas', duration: 200,
})

/** 模拟 Subsonic 的分页：按 offset/size 切一个 total 首的库；total 为 undefined 时当作永远有下一页 */
function serveSongs(total: number | undefined, reportTotal = true) {
  adapter.getSongs.mockImplementation(async ({ offset = 0, size = 100 }: { offset?: number; size?: number }) => {
    const end = total == null ? offset + size : Math.min(offset + size, total)
    const items = Array.from({ length: Math.max(0, end - offset) }, (_, k) => song(offset + k))
    return { items, total: reportTotal ? total : undefined, offset, size }
  })
}

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
        <MemoryRouter initialEntries={['/library']}>
          <Library />
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

const playAllButton = () =>
  [...document.querySelectorAll('button')].find(b => /播放全部|载入中|Play all|Loading/i.test(b.textContent ?? '')) as HTMLButtonElement | undefined

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  useServerStore.setState({
    activeServerId: 'nas', connectedServerIds: ['nas'], isConnected: true,
    servers: [{ id: 'nas', name: 'NAS', type: 'subsonic' }],
  } as never)
  adapter.getAlbums.mockResolvedValue({ items: [], total: 0, offset: 0, size: 50 })
  adapter.getArtists.mockResolvedValue([])
})
afterEach(() => {
  act(() => { root?.unmount() })
  root = null
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('曲库页：播放全部要播全库', () => {
  it('250 首的库：点「播放全部」把后两页取完，播的是 250 首而不是前 100 首', async () => {
    serveSongs(250)
    mount()
    await flush()
    expect(adapter.getSongs).toHaveBeenCalledTimes(1)

    await act(async () => { playAllButton()!.click() })
    await flush()

    expect(playAllInOrder).toHaveBeenCalledTimes(1)
    const [list, start] = playAllInOrder.mock.calls[0]
    expect(list, '播的是全库').toHaveLength(250)
    expect(list.at(-1).id).toBe('s249')
    expect(start).toBe(0)
  })

  it('已经全部加载（只有一页）：不多取，直接播', async () => {
    serveSongs(60)
    mount()
    await flush()

    await act(async () => { playAllButton()!.click() })
    await flush()

    expect(adapter.getSongs).toHaveBeenCalledTimes(1)
    expect(playAllInOrder.mock.calls[0][0]).toHaveLength(60)
  })

  it('取页过程中按钮忙碌且被禁用，连点不会重复起播、也不会重复取页', async () => {
    serveSongs(250)
    mount()
    await flush()

    // 让第二页悬着，模拟慢网
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    const real = adapter.getSongs.getMockImplementation()!
    adapter.getSongs.mockImplementation(async (p: { offset?: number }) => {
      if ((p.offset ?? 0) === 100) await gate
      return real(p)
    })

    await act(async () => { playAllButton()!.click() })
    await flush(2)
    const busy = playAllButton()!
    expect(busy.disabled, '取页中按钮禁用').toBe(true)
    await act(async () => { busy.click(); busy.click() })

    release()
    await flush()

    expect(playAllInOrder).toHaveBeenCalledTimes(1)
    expect(playAllInOrder.mock.calls[0][0]).toHaveLength(250)
    // 第 2、3 页各取一次，连点没有多发
    expect(adapter.getSongs.mock.calls.filter(c => c[0].offset === 100)).toHaveLength(1)
    expect(playAllButton()!.disabled, '播完后恢复').toBe(false)
  })

  it('超大库（不报总数、永远有下一页）：封顶 5000 首', async () => {
    serveSongs(undefined, false)
    mount()
    await flush()

    await act(async () => { playAllButton()!.click() })
    await flush(80)

    expect(playAllInOrder).toHaveBeenCalledTimes(1)
    expect(playAllInOrder.mock.calls[0][0]).toHaveLength(5000)
    // 100 一页：首屏 1 次 + 补 49 页，到顶就停，没有无止境地翻
    expect(adapter.getSongs.mock.calls.length).toBeLessThanOrEqual(51)
  })

  it('中途某页取失败：用已取到的那部分开播，不是什么都不放', async () => {
    serveSongs(250)
    mount()
    await flush()
    const real = adapter.getSongs.getMockImplementation()!
    adapter.getSongs.mockImplementation(async (p: { offset?: number }) => {
      if ((p.offset ?? 0) === 200) throw new Error('boom')
      return real(p)
    })

    await act(async () => { playAllButton()!.click() })
    await flush()

    expect(playAllInOrder).toHaveBeenCalledTimes(1)
    expect(playAllInOrder.mock.calls[0][0]).toHaveLength(200)
  })
})
