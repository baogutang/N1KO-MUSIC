/**
 * @vitest-environment happy-dom
 *
 * 复核 F2 回归：详情页的「查询出错」与「真的没有」必须分开设。
 * 用户路径：NAS 凭据过期后从歌单点进一首歌 → 适配器抛 unauthorized →
 * 页面给出「重新登录」说明，而不是「未找到歌曲信息」。
 * 断网 / 服务器 500 同理：ErrorState 带重试，不冒充「未找到」。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const { getSong } = vi.hoisted(() => ({ getSong: vi.fn() }))

vi.mock('@/api', () => ({
  createAdapter: vi.fn(), getAdapter: vi.fn(), getAdapterFor: vi.fn(() => ({ getSong })),
  hasAdapter: vi.fn(() => false), hasAdapterFor: vi.fn(() => true),
  findAdapterFor: vi.fn(() => null), adapterForSource: vi.fn(),
  setPrimary: vi.fn(), listAdapters: vi.fn(() => []),
}))

import SongDetailPage from './SongDetail'
import { useServerStore } from '@/store/serverStore'

let root: Root | null = null
let queryClient: QueryClient

function mount() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => {
    root!.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/songs/song-1?src=nas']}>
          <Routes><Route path="/songs/:id" element={<SongDetailPage />} /></Routes>
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

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  useServerStore.setState({
    activeServerId: 'nas',
    connectedServerIds: ['nas'],
    isConnected: true,
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

describe('歌曲详情页：出错不冒充「未找到」（F2）', () => {
  it('unauthorized → 提示重新登录，不是「未找到歌曲信息」', async () => {
    const authError = new Error('auth expired') as Error & { code: string }
    authError.code = 'unauthorized'
    getSong.mockRejectedValueOnce(authError)
    mount()
    await flush()

    expect(document.body.textContent).toMatch(/此音源需要重新登录|fresh sign-in/i)
    expect(document.body.textContent).not.toMatch(/未找到歌曲信息|No track information/i)
  })

  it('网络错误 → ErrorState 带重试，不是「未找到歌曲信息」', async () => {
    getSong.mockRejectedValueOnce(new Error('network down'))
    mount()
    await flush()

    const retry = [...document.querySelectorAll('button')]
      .find(b => /重试|Retry/i.test(b.textContent ?? ''))
    expect(retry, '有重试按钮').toBeTruthy()
    expect(document.body.textContent).not.toMatch(/未找到歌曲信息|No track information/i)
  })

  it('真的不存在（getSong 返回 null）才显示「未找到」', async () => {
    getSong.mockResolvedValueOnce(null)
    mount()
    await flush()

    expect(document.body.textContent).toMatch(/未找到歌曲信息|No track information/i)
  })
})
