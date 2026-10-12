/**
 * @vitest-environment happy-dom
 *
 * 阶段 1.2 回归：插件扫码成功但 connectServer 失败时，登录页不能变成死局。
 * 用户真实路径：选插件 → 扫码 confirmed → 连接失败 →
 * 回到选择步（表单仍在），而不是只剩标题和一行红字。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

const { connectServer, openAuthHost, host, pluginStoreState, serverState } = vi.hoisted(() => {
  let qrChecked = false
  const host = {
    manifest: {
      id: 'netease', name: '网易云音乐', version: '0.1.14', protocol: 1,
      platform: 'netease', entry: 'index.js', auth: { kind: 'qr' },
      hosts: ['open.weixin.qq.com'], capabilities: [], disclaimer: 'x',
    },
    hasMethod: vi.fn(() => true),
    call: vi.fn(async (method: string) => {
      if (method === 'n1ko.auth.createQr') {
        return { key: 'k1', content: 'https://open.weixin.qq.com/x', expiresIn: 180, qrImage: 'data:image/png;base64,QUJD' }
      }
      if (method === 'n1ko.auth.checkQr') {
        if (!qrChecked) { qrChecked = true; return { status: 'waiting' } }
        return { status: 'confirmed', credentials: 'mock-cookie:user-1:1' }
      }
      if (method === 'n1ko.auth.getUser') {
        return { id: 'user-1', name: '测试用户' }
      }
      throw new Error(`unexpected ${method}`)
    }),
  }
  const installed = { manifest: host.manifest, codeHash: 'h1', installedAt: 0 }
  const pluginStoreState = {
    plugins: [{ id: 'netease', name: '网易云音乐', version: '0.1.14' }],
    loaded: true,
    getInstalled: vi.fn(async () => installed),
    load: vi.fn(async () => undefined),
  }
  const serverState = {
    activeServerId: 'srv-existing',
    connectedServerIds: ['srv-existing'],
    servers: [{ id: 'srv-existing', name: 'NAS', type: 'subsonic' }],
    isConnected: true,
    startupConnectSettled: true,
    addServer: vi.fn(() => 'srv-new-plugin'),
    updatePluginServer: vi.fn(),
    updateServerAuth: vi.fn(),
    removeServer: vi.fn(),
    activateServer: vi.fn(async () => true),
    setPrimaryServer: vi.fn(() => true),
    connectServer: (...args: unknown[]) => connectServer(...(args as [])),
  }
  return {
    connectServer: vi.fn(async () => false),
    openAuthHost: vi.fn(async () => host),
    host, pluginStoreState, serverState,
  }
})

vi.mock('@/api', () => ({
  createAdapter: vi.fn(), getAdapter: vi.fn(), getAdapterFor: vi.fn(),
  hasAdapter: vi.fn(() => true), hasAdapterFor: vi.fn(() => true),
  findAdapterFor: vi.fn(() => null), adapterForSource: vi.fn(),
  setPrimary: vi.fn(), listAdapters: vi.fn(() => []),
}))
vi.mock('@/store/serverStore', () => ({
  getServerTypeLabel: vi.fn(() => 'Subsonic'),
  useServerStore: Object.assign(
    vi.fn((selector?: (s: unknown) => unknown) => (selector ? selector(serverState) : serverState)),
    { getState: () => serverState, setState: vi.fn(), subscribe: vi.fn(() => () => undefined) }
  ),
  useHistoryScope: vi.fn(() => []),
}))
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: Object.assign(
    vi.fn((selector?: (s: unknown) => unknown) => (selector ? selector({}) : {})),
    { getState: () => ({}), setState: vi.fn(), subscribe: vi.fn(() => () => undefined) }
  ),
}))
vi.mock('@/plugins/host/pluginRuntime', () => ({
  connectServer,
  openAuthHost,
  closeAuthHost: vi.fn(),
  getPluginHost: vi.fn(() => null),
}))
vi.mock('@/plugins/host/pluginStore', () => ({
  usePluginStore: Object.assign(
    vi.fn((selector?: (s: unknown) => unknown) => (selector ? selector(pluginStoreState) : pluginStoreState)),
    { getState: () => pluginStoreState }
  ),
}))

import { MemoryRouter } from 'react-router-dom'
import LoginPage from './Login'

let root: Root | null = null
beforeEach(() => {
  // 声明确认清单里已有 netease（Login 内部读 localStorage）
  localStorage.setItem('n1ko-plugin-disclaimers-confirmed', JSON.stringify(['netease']))
  const el = document.createElement('div')
  document.body.appendChild(el)
  root = createRoot(el)
  act(() => { root!.render(<MemoryRouter><LoginPage /></MemoryRouter>) })
})
afterEach(() => {
  act(() => { root?.unmount() })
  root = null
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

async function flush(times = 40) {
  for (let i = 0; i < times; i++) await act(async () => { await Promise.resolve() })
}

describe('插件登录失败不再死局（阶段 1.2）', () => {
  it('扫码 confirmed → connectServer=false → 回到选择步，表单与错误提示同屏', { timeout: 20_000 }, async () => {
    await flush()
    const row = [...document.querySelectorAll('button, [role="button"]')]
      .find(b => b.textContent?.includes('网易云音乐'))
    expect(row, '能选到网易云插件行').toBeTruthy()
    act(() => { row!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await flush()
    expect(openAuthHost, '进入插件扫码步').toHaveBeenCalled()


    // 驱动扫码轮询到 confirmed（QrLogin 的轮询是真实 2s setTimeout 链）
    for (let i = 0; i < 3; i++) {
      await act(async () => { await new Promise(r => setTimeout(r, 2100)) })
      await flush(5)
    }
    expect(connectServer, 'confirmed 后尝试连接').toHaveBeenCalled()

    // 失败后：回到 type 步——小标题是「选择服务器类型…」，且有可点的控件
    await flush()
    // 回到 type 步：小标题重新出现（en: "Pick a server type"）
    expect(document.body.textContent).toMatch(/选择服务器类型|Pick a server type/)
    expect(document.querySelector('input, form, button')).toBeTruthy()
  })
})
