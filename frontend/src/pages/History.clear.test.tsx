/**
 * @vitest-environment happy-dom
 *
 * 阶段 1.6 回归（复核 F20 重写：走真实页面，不再自证）：
 * 清空历史必须清**列表正在显示的全部源**。
 * 用户路径：连着 NAS + 网易云 → 历史页看到两源的记录 → 点「清空记录」→
 * 确认框 → 插件源的记录不再随下一首播完回来。
 * （旧测试自己重写了 scope 拼接与遍历循环再调 mock，完全没经过 History.tsx。）
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const { readListeningEvents, clearListeningEvents } = vi.hoisted(() => ({
  readListeningEvents: vi.fn(),
  clearListeningEvents: vi.fn(),
}))

vi.mock('@/services/listeningHistory', () => ({
  readListeningEvents,
  clearListeningEvents,
  HISTORY_UPDATED_EVENT: 'n1ko-history-updated',
}))

vi.mock('@/api', () => ({
  createAdapter: vi.fn(),
  getAdapter: vi.fn(),
  getAdapterFor: vi.fn(() => ({ getCoverUrl: vi.fn(() => 'x') })),
  hasAdapter: vi.fn(() => false),
  hasAdapterFor: vi.fn(() => true),
  findAdapterFor: vi.fn(() => null),
  adapterForSource: vi.fn(),
  setPrimary: vi.fn(),
  listAdapters: vi.fn(() => []),
}))

import HistoryPage from './History'
import { useServerStore } from '@/store/serverStore'
import type { Song } from '@/api/types'

const song = (id: string, serverId: string): Song => ({
  id, title: `歌${id}`, artist: '歌手', serverId, duration: 200, album: '', albumId: '',
})

let root: Root | null = null

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  // 两个源都在 scope 里：主库 NAS + 插件网易云
  useServerStore.setState({
    activeServerId: 'nas',
    connectedServerIds: ['nas', 'wy'],
    isConnected: true,
    servers: [
      { id: 'nas', name: 'NAS', type: 'subsonic' },
      { id: 'wy', name: '网易云', type: 'plugin', pluginId: 'netease' } as never,
    ],
  } as never)
  // 列表正显示两源各一条（History 挂载即读）
  readListeningEvents.mockReturnValue([
    { version: 2, eventId: 'e1', serverId: 'nas', song: song('a', 'nas'), startedAt: 0, endedAt: 1, listenedSeconds: 30, completionRate: 1, outcome: 'completed' },
    { version: 2, eventId: 'e2', serverId: 'wy', song: song('b', 'wy'), startedAt: 0, endedAt: 2, listenedSeconds: 30, completionRate: 1, outcome: 'completed' },
  ])
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  act(() => {
    root!.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/history']}>
          <Routes><Route path="/history" element={<HistoryPage />} /></Routes>
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

describe('清空历史按源遍历（1.6 / 复核 F20）', () => {
  it('点清空 → 确认 → historyScope 里的每个源都被清一次（不是只清主库）', async () => {
    await flush()
    // 页面真的渲染出了两源的记录（走过 History.tsx 的读取与分组）
    expect(document.body.textContent).toContain('歌a')
    expect(document.body.textContent).toContain('歌b')

    // 用户点「清空记录」→ 出确认框
    const clearEntry = [...document.querySelectorAll('button')]
      .find(b => /清空记录|Clear history/i.test(b.textContent ?? ''))
    expect(clearEntry, '有清空入口').toBeTruthy()
    act(() => { clearEntry!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await flush(2)

    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog, '先出确认框').toBeTruthy()

    // 确认（destructive 键文案「清除 / Clear」）
    const confirmBtn = [...dialog!.querySelectorAll('button')]
      .find(b => /^清除$|^Clear$/i.test((b.textContent ?? '').trim()))
    expect(confirmBtn, '确认键存在').toBeTruthy()
    act(() => { confirmBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await flush()

    const cleared = clearListeningEvents.mock.calls.map(c => c[0])
    // scope 顺序：主库在前，其余已连接源跟上（与 useHistoryScope 的真实语义一致）
    expect(cleared.sort()).toEqual(['nas', 'wy'])
    // 清空后列表为空态，不是还挂着旧记录
    expect(document.body.textContent).not.toContain('歌a')
  })

  it('取消不动数据', async () => {
    await flush()
    const clearEntry = [...document.querySelectorAll('button')]
      .find(b => /清空记录|Clear history/i.test(b.textContent ?? ''))
    act(() => { clearEntry!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await flush(2)
    const dialog = document.querySelector('[role="dialog"]')!
    const cancel = [...dialog.querySelectorAll('button')]
      .find(b => /取消|Cancel/i.test(b.textContent ?? ''))
    act(() => { cancel!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await flush()
    expect(clearListeningEvents).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('歌a')
  })
})
