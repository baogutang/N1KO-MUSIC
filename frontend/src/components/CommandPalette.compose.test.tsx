/**
 * @vitest-environment happy-dom
 *
 * 阶段 2.5 回归（F22 补）：⌘K 面板的 Enter 要判输入法组词状态。
 * 用户路径：中文输入法打拼音 → 候选窗里按 Enter 选词（isComposing）→
 * 面板不应执行跳转；真正敲下 Enter（非组词）才执行当前高亮命令。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@/api', () => ({
  createAdapter: vi.fn(), getAdapter: vi.fn(), getAdapterFor: vi.fn(() => ({})),
  hasAdapter: vi.fn(() => true), hasAdapterFor: vi.fn(() => true),
  findAdapterFor: vi.fn(() => null), adapterForSource: vi.fn(),
  setPrimary: vi.fn(), listAdapters: vi.fn(() => []),
}))
vi.mock('@/hooks/useSourceQueries', async importOriginal => ({
  ...(await importOriginal<typeof import('@/hooks/useSourceQueries')>()),
  useSourceSearch: vi.fn(() => []),
}))

import { CommandPalette } from './CommandPalette'
import { usePlayerStore } from '@/store/playerStore'
import { useServerStore } from '@/store/serverStore'

let root: Root | null = null
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
})

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  useServerStore.setState({
    activeServerId: 'nas', connectedServerIds: ['nas'], isConnected: true,
    servers: [{ id: 'nas', name: 'NAS', type: 'subsonic' }],
  } as never)
  usePlayerStore.setState({ sleepTimerAt: null } as never)
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => {
    root!.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter><CommandPalette /></MemoryRouter>
      </QueryClientProvider>
    )
  })
  // ⌘K 打开面板（用户入口）
  act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true })) })
})
afterEach(() => {
  act(() => { root?.unmount() })
  root = null
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

async function flush(times = 4) {
  for (let i = 0; i < times; i++) {
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  }
}

function typeQuery(text: string) {
  const input = document.querySelector('input[aria-label]') as HTMLInputElement
  expect(input, '面板输入框').toBeTruthy()
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, text)
  act(() => { input.dispatchEvent(new Event('input', { bubbles: true }) as never) })
  return input
}

describe('⌘K 面板 Enter 与输入法组词（2.5 / F22）', () => {
  it('组词中的 Enter 只选词，不执行命令；松开后的 Enter 才执行', async () => {
    await flush()
    const input = typeQuery('sleep')

    // 组词中的 Enter（拼音候选窗确认）：不执行
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true } as never))
    })
    await flush()
    expect(usePlayerStore.getState().sleepTimerAt, '组词 Enter 不执行命令').toBe(null)

    // 真正的 Enter：执行高亮命令（sleep 30 分钟）
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: false } as never))
    })
    await flush()
    expect(usePlayerStore.getState().sleepTimerAt, '真 Enter 执行了命令').not.toBe(null)
  })
})
