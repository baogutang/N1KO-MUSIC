/**
 * @vitest-environment happy-dom
 *
 * 复核 F4 回归：搜索页与历史页「返回保住翻页深度」。
 * 用户路径：搜索翻到第 3 页 / 历史点两次加载更多 → 点进别的页面 →
 * 浏览器返回 → 看到的仍是离开时的全部结果，不是被冲回第一页。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { Link, MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const { searchAll, searchSongsPage, readListeningEvents } = vi.hoisted(() => ({
  searchAll: vi.fn(),
  searchSongsPage: vi.fn(),
  readListeningEvents: vi.fn(),
}))

/** 按源区分的适配器：page 1 的 isEnd 看 searchAll.songsIsEnd（与真实适配器同语义） */
const { nasSearchAll, wySearchAll } = vi.hoisted(() => ({
  nasSearchAll: vi.fn(),
  wySearchAll: vi.fn(),
}))

vi.mock('@/api', () => ({
  createAdapter: vi.fn(),
  getAdapter: vi.fn(() => ({ searchAll, searchSongsPage, getCoverUrl: vi.fn(() => 'x') })),
  getAdapterFor: vi.fn((id: string) =>
    id === 'wy'
      ? { searchAll: wySearchAll, searchSongsPage, getCoverUrl: vi.fn(() => 'x') }
      : { searchAll: nasSearchAll, getCoverUrl: vi.fn(() => 'x') }
  ),
  hasAdapter: vi.fn(() => true), hasAdapterFor: vi.fn(() => true),
  findAdapterFor: vi.fn(() => ({ getCoverUrl: vi.fn(() => 'x') })),
  adapterForSource: vi.fn(), setPrimary: vi.fn(), listAdapters: vi.fn(() => []),
}))

vi.mock('@/services/listeningHistory', () => ({
  readListeningEvents,
  clearListeningEvents: vi.fn(),
  HISTORY_UPDATED_EVENT: 'n1ko-history-updated',
}))

import SearchPage from './Search'
import HistoryPage from './History'
import { useServerStore } from '@/store/serverStore'
import { usePlayerStore } from '@/store/playerStore'
import type { Song } from '@/api/types'

/** 离开本页的入口 + 浏览器返回键 */
function Nav() {
  const navigate = useNavigate()
  return (
    <div>
      <Link to="/other">leave</Link>
      <button onClick={() => navigate(-1)}>browser-back</button>
    </div>
  )
}

function App({ start }: { start: string }) {
  return (
    <MemoryRouter initialEntries={[start]}>
      <Nav />
      <Routes>
        <Route path="/search" element={<SearchPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/other" element={<div>other page</div>} />
      </Routes>
    </MemoryRouter>
  )
}

let root: Root | null = null
function mountApp(start: string) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  root = createRoot(host)
  act(() => {
    root!.render(
      <QueryClientProvider client={queryClient}>
        <App start={start} />
      </QueryClientProvider>
    )
  })
}

async function flush(times = 8) {
  for (let i = 0; i < times; i++) {
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  }
}

async function clickAwayAndBack() {
  const leave = [...document.querySelectorAll('a')].find(a => a.textContent === 'leave')!
  act(() => { leave.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush(3)
  const back = [...document.querySelectorAll('button')].find(b => b.textContent === 'browser-back')!
  act(() => { back.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
}

function clickButtonByText(re: RegExp) {
  const btn = [...document.querySelectorAll('button')].find(b => re.test(b.textContent ?? ''))
  expect(btn, `按钮 ${re} 存在`).toBeTruthy()
  act(() => { btn!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, value)
  act(() => { input.dispatchEvent(new Event('input', { bubbles: true }) as never) })
}

const song = (id: string, serverId: string): Song => ({
  id, title: `歌${id}`, artist: '歌手', serverId, duration: 100 + Number(id), album: '', albumId: '',
})

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
  usePlayerStore.setState({ currentSong: null, isPlaying: false } as never)
})
afterEach(() => {
  act(() => { root?.unmount() })
  root = null
  document.body.innerHTML = ''
  window.history.replaceState(null, '')
  vi.clearAllMocks()
})

describe('搜索页返回恢复（F4）', () => {
  it('翻到第 3 页后离开再返回：累积结果不被重置 effect 冲掉', { timeout: 30_000 }, async () => {
    // NAS 一页 20 首、一次性给完（songsIsEnd true）；网易云每页 20 首、永远还有
    nasSearchAll.mockImplementation(async () => ({
      songs: Array.from({ length: 20 }, (_, i) => song(`n1-${i}`, 'nas')),
      songsIsEnd: true,
    }))
    wySearchAll.mockImplementation(async () => ({
      songs: Array.from({ length: 20 }, (_, i) => song(`w1-${i}`, 'wy')),
      songsIsEnd: false,
    }))
    searchSongsPage.mockImplementation(async (_q: string, page: number) => ({
      songs: Array.from({ length: 20 }, (_, i) => song(`w${page}-${i}`, 'wy')),
      isEnd: false,
    }))

    mountApp('/search')
    await flush(2)
    const input = document.querySelector('input[aria-label], input') as HTMLInputElement
    setInputValue(input, 'hello')
    await act(async () => { await new Promise(r => setTimeout(r, 400)) })
    await flush()

    // 第 1 页：NAS 20 + 网易云 20 = 40
    clickButtonByText(/加载更早|Load earlier|加载更多|Load more/i)
    await flush()
    clickButtonByText(/加载更早|Load earlier|加载更多|Load more/i)
    await flush()
    // 第 3 页：NAS 不再给，网易云累计 60 → 共 80
    expect(document.body.textContent).toMatch(/80/)

    await clickAwayAndBack()
    await act(async () => { await new Promise(r => setTimeout(r, 50)) })
    await flush()

    // 返回后仍是 80 首（旧代码：重置 effect 当帧把 page 冲回 1）
    expect(document.body.textContent, '返回后仍显示全部 80 首').toMatch(/80/)
    // 还能继续翻
    clickButtonByText(/加载更早|Load earlier|加载更多|Load more/i)
    await flush()
    expect(document.body.textContent).toMatch(/100/)
  })
})

describe('历史页返回恢复（F4）', () => {
  it('点三次加载更多后离开再返回：visibleCount 不被冲回 150', { timeout: 30_000 }, async () => {
    readListeningEvents.mockReturnValue(
      Array.from({ length: 500 }, (_, i) => ({
        version: 2 as const,
        eventId: `e${i}`,
        serverId: 'nas',
        song: song(String(i), 'nas'),
        startedAt: Date.now() - 1000,
        endedAt: Date.now(),
        listenedSeconds: 60,
        completionRate: 1,
        outcome: 'completed' as const,
      }))
    )

    mountApp('/history')
    await flush()
    clickButtonByText(/加载更早|Load earlier|加载更多|Load more/i)
    await flush(2)
    clickButtonByText(/加载更早|Load earlier|加载更多|Load more/i)
    await flush(2)
    clickButtonByText(/加载更早|Load earlier|加载更多|Load more/i)
    await flush(2)
    // 600 ≥ 500：全部可见，加载更多消失
    expect([...document.querySelectorAll('button')].find(b => /加载更早|Load earlier|加载更多|Load more/i.test(b.textContent ?? ''))).toBeFalsy()

    await clickAwayAndBack()
    await flush()

    expect(
      [...document.querySelectorAll('button')].find(b => /加载更早|Load earlier|加载更多|Load more/i.test(b.textContent ?? '')),
      '返回后 500 条仍全部可见（旧代码被冲回 150）'
    ).toBeFalsy()
  })
})
