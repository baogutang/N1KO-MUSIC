/**
 * @vitest-environment happy-dom
 *
 * 阶段 2.3 回归（F22 补）：「检查更新」断网时说真话。
 * 用户路径：设置 → 音源 → 点某插件的「检查更新」→ 目录拉不下来 →
 * 看到的是「拉取目录失败」（带重试意味），不是伪装的「已是最新版本」。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const { checkUpdates, toast } = vi.hoisted(() => ({
  checkUpdates: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('@/plugins/host/pluginStore', () => {
  const state = {
    plugins: [{ id: 'netease', name: '网易云音乐', version: '0.1.14' }],
    heldUpdates: [],
    catalogUrl: 'https://catalog.test/plugins.json',
    loaded: true,
    load: vi.fn(async () => undefined),
    install: vi.fn(),
    prepareInstall: vi.fn(),
    commitInstall: vi.fn(),
    installFromCatalog: vi.fn(),
    installPasted: vi.fn(),
    uninstall: vi.fn(),
    checkUpdates,
    setCatalogUrl: vi.fn(),
    getInstalled: vi.fn(async () => null),
  }
  return {
    usePluginStore: Object.assign(
      vi.fn((selector?: (s: unknown) => unknown) => (selector ? selector(state) : state)),
      { getState: () => state }
    ),
  }
})
vi.mock('@/components/ui/use-toast', () => ({ toast }))
vi.mock('@/api', () => ({
  createAdapter: vi.fn(), getAdapter: vi.fn(), getAdapterFor: vi.fn(() => ({})),
  hasAdapter: vi.fn(() => false), hasAdapterFor: vi.fn(() => true),
  findAdapterFor: vi.fn(() => null), adapterForSource: vi.fn(),
  setPrimary: vi.fn(), listAdapters: vi.fn(() => []),
}))
vi.mock('@/plugins/host/PluginHost', () => ({
  diagnoseAll: vi.fn(async () => []),
  rateBackoffRemaining: vi.fn(() => 0),
}))

import { SourcesSettings } from './SourcesSettings'
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
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => {
    root!.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter><SourcesSettings /></MemoryRouter>
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

describe('检查更新断网说真话（2.3 / F22）', () => {
  it('目录拉取失败 → 提示「拉取目录失败」，不是「已是最新版本」', async () => {
    await flush()
    checkUpdates.mockRejectedValue(new Error('network down'))

    const btn = [...document.querySelectorAll('button')]
      .find(b => /检查更新|Check for updates/i.test(b.title || (b.getAttribute('aria-label') ?? '')))
    expect(btn, '插件行有「检查更新」').toBeTruthy()
    act(() => { btn!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await flush()

    const titles = toast.mock.calls.map(c => (c[0] as { title: string }).title)
    expect(titles.some(t => /拉取目录失败|Failed to fetch catalog/i.test(t)), '说真话：目录失败').toBe(true)
    expect(titles.some(t => /已是最新版本|Up to date/i.test(t)), '不伪装成已最新').toBe(false)
  })
})
