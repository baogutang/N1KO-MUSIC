/**
 * @vitest-environment happy-dom
 *
 * 换来源的安装确认（2026-11-12 加固）。
 * 用户路径：已从 A 装了网易云并登录 → 在「从 URL 安装」里填了 B 的同 id 插件 →
 * 不能一步装完：网易云那一行出现醒目的「来源变了」提示，写明原来来自 A、这次来自 B →
 * 确认「替换并重新登录」后才换代码，且这个插件音源保存的登录被清掉。
 *
 * pluginStore 与 serverStore 都是真的（IndexedDB 走 fake-indexeddb，网络走桩 fetch）：
 * 钉的是界面 → prepareInstall → commitInstall → serverStore 的整条链路。
 */

import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('@/components/ui/use-toast', () => ({ toast }))

import { SourcesSettings } from './SourcesSettings'
import { usePluginStore } from '@/plugins/host/pluginStore'
import { resetPluginDbForTests } from '@/plugins/host/pluginStorage'
import { useServerStore } from '@/store/serverStore'

const A = 'https://a.example.test/netease/manifest.json'
const B = 'https://b.example.test/netease/manifest.json'

const manifest = (version: string) => ({
  id: 'netease', name: '网易云音乐', version, protocol: 1, platform: 'netease',
  entry: 'index.js', auth: { kind: 'qr' }, hosts: ['music.163.com'],
  capabilities: ['search'], disclaimer: '声明',
})

/**
 * 整个用例期间只有这一个 fetch 桩：路由表外的一律 404。
 * 不能在用例中途 restore——设置页挂载时的 load() 会去拉出厂目录（自动更新），
 * 桩一撤就成了真实请求。
 */
let routes: Record<string, unknown> = {}
function stubFetch(next: Record<string, unknown>) {
  routes = next
}

let root: Root | null = null
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

async function flush(times = 8) {
  for (let i = 0; i < times; i++) {
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  }
}

const buttonByText = (re: RegExp) =>
  [...document.querySelectorAll('button')].find(b => re.test(b.textContent ?? ''))

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  await resetPluginDbForTests()
  usePluginStore.setState({ plugins: [], catalogUrl: '', loaded: false, installing: null, heldUpdates: [] })
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (!(url in routes)) return new Response('not found', { status: 404 })
    const body = routes[url]
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200 })
  })
  // 先从 A 装好网易云
  stubFetch({ [A]: manifest('0.1.0'), 'https://a.example.test/netease/index.js': 'code-a' })
  expect((await usePluginStore.getState().install(A)).ok).toBe(true)
  stubFetch({})

  useServerStore.setState({
    servers: [{
      id: 'srv-ne', type: 'plugin', pluginId: 'netease', name: '网易云音乐',
      url: '', username: 'me', token: '', credentials: 'MUSIC_U=old', isActive: false, createdAt: 0,
    }],
    connectedServerIds: [], compromisedServerIds: [], activeServerId: null,
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
  await flush()
})

afterEach(() => {
  act(() => { root?.unmount() })
  root = null
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  toast.mockReset()
})

/** 在「从 URL 安装」里填地址并点安装 */
async function installFromUrl(url: string) {
  const input = document.querySelector('input[placeholder^="https://example.com/plugin"]') as HTMLInputElement
  expect(input, '有 URL 安装输入框').toBeTruthy()
  act(() => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setValue.call(input, url)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  // URL 那一行的「安装」按钮紧跟在输入框后面
  const button = input.parentElement!.querySelector('button') as HTMLButtonElement
  act(() => { button.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await flush()
}

describe('从 URL 装同 id、不同来源的插件', () => {
  it('停在确认：醒目提示原来来自 A、这次来自 B；未确认前代码与登录都不动', async () => {
    stubFetch({ [B]: manifest('0.2.0'), 'https://b.example.test/netease/index.js': 'code-b' })
    await installFromUrl(B)

    const warning = [...document.querySelectorAll('p.text-danger')].find(p => p.textContent?.includes(B))
    expect(warning, '有单独一行危险色的换来源提示').toBeTruthy()
    expect(warning!.textContent).toContain(A)
    expect(warning!.textContent).toContain('网易云音乐')
    expect(buttonByText(/替换并重新登录|Replace and sign out/)).toBeTruthy()

    expect((await usePluginStore.getState().getInstalled('netease'))?.code).toBe('code-a')
    expect(useServerStore.getState().servers[0].credentials).toBe('MUSIC_U=old')
  })

  it('确认替换：换成 B 的代码，清掉这个插件音源的登录，并提示重新登录', async () => {
    stubFetch({ [B]: manifest('0.2.0'), 'https://b.example.test/netease/index.js': 'code-b' })
    await installFromUrl(B)
    act(() => { buttonByText(/替换并重新登录|Replace and sign out/)!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await flush()

    const installed = await usePluginStore.getState().getInstalled('netease')
    expect(installed?.code).toBe('code-b')
    expect(installed?.sourceUrl).toBe(B)
    expect(useServerStore.getState().servers[0].credentials).toBeUndefined()
    const descriptions = toast.mock.calls.map(c => (c[0] as { description?: string }).description)
    expect(descriptions.some(d => /重新登录|sign in again/.test(d ?? ''))).toBe(true)
    // 确认块收起
    expect(document.querySelector('p.text-danger')).toBeNull()
  })

  it('取消：什么都不换', async () => {
    stubFetch({ [B]: manifest('0.2.0'), 'https://b.example.test/netease/index.js': 'code-b' })
    await installFromUrl(B)
    act(() => { buttonByText(/取消|Cancel/)!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await flush()
    expect(document.querySelector('p.text-danger')).toBeNull()
    expect((await usePluginStore.getState().getInstalled('netease'))?.code).toBe('code-a')
    expect(useServerStore.getState().servers[0].credentials).toBe('MUSIC_U=old')
  })

  it('同一来源的新版：不弹换来源确认，直接装上，登录保留', async () => {
    stubFetch({ [A]: manifest('0.2.0'), 'https://a.example.test/netease/index.js': 'code-a2' })
    await installFromUrl(A)
    expect(document.querySelector('p.text-danger')).toBeNull()
    expect((await usePluginStore.getState().getInstalled('netease'))?.code).toBe('code-a2')
    expect(useServerStore.getState().servers[0].credentials).toBe('MUSIC_U=old')
  })
})
