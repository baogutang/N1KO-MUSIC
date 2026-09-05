/**
 * @vitest-environment happy-dom
 *
 * 沙箱越界之后，界面必须知道这件事。
 *
 * PluginHost 侦测到 ready 之后的自导航时会自拆沙箱并回调 onCompromised——
 * 但那个回调此前没人传：登记处留着一个死 host，serverStore 还以为这个音源
 * 连着，横幅一个字也不说，用户看到的只是「这个源忽然什么都搜不到」。
 *
 * 这里钉住整条链路：越界 → serverStore 置「已停用」并断开 → 横幅选中
 * compromised 那一条。沙箱内部的真实行为由 PluginHost.test.ts 与浏览器
 * 走查覆盖，这里用 postMessage 扮演沙箱。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PluginManifest } from '../types'

const manifest: PluginManifest = {
  id: 'mock', name: 'Mock', version: '0.1.0', protocol: 1, platform: 'mock',
  entry: 'index.js', auth: { kind: 'qr' }, hosts: ['music.163.com'],
  capabilities: ['search'], disclaimer: 'x',
}

// pluginStore 是 IndexedDB 的门面；这条链路只需要它交出 manifest 与代码
vi.mock('./pluginStore', () => ({
  usePluginStore: {
    getState: () => ({
      getInstalled: async () => ({ id: 'mock', manifest, code: 'module.exports = {}' }),
    }),
  },
}))

const { ensurePluginHost, getPluginHost } = await import('./pluginRuntime')
const { useServerStore } = await import('@/store/serverStore')
const { pickBanner } = await import('@/components/layout/ConnectionBanner')

/** 沙箱在 happy-dom 里不会真的跑起来：等 iframe 出现后替它回一条 ready */
async function answerReady(): Promise<HTMLIFrameElement> {
  for (let i = 0; i < 200 && !document.querySelector('iframe'); i++) {
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  const iframe = document.querySelector('iframe') as HTMLIFrameElement
  window.dispatchEvent(new MessageEvent('message', {
    data: { type: 'ready', methods: ['search'] },
    source: iframe.contentWindow,
  }))
  return iframe
}

/** 加一个插件音源并连上（connectServer 对插件 = 装载沙箱 + 注册适配器） */
async function connectMockSource(): Promise<{ id: string; iframe: HTMLIFrameElement }> {
  const id = useServerStore.getState().addServer({
    type: 'plugin', pluginId: 'mock', name: 'Mock 音源',
    url: '', username: '', token: '', credentials: 'COOKIE', isActive: true,
  })
  const connecting = useServerStore.getState().connectServer(id)
  const iframe = await answerReady()
  expect(await connecting).toBe(true)
  return { id, iframe }
}

beforeEach(() => {
  useServerStore.setState({ servers: [], connectedServerIds: [], compromisedServerIds: [], activeServerId: null })
  // happy-dom 会真的去导航 iframe 的 blob: 地址并报「blob scheme 不支持」，
  // 加上越界那条 console.error 本身——与断言无关的噪音，静音
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  document.querySelectorAll('iframe').forEach(f => f.remove())
  vi.restoreAllMocks()
})

describe('沙箱越界 → 音源被停用', () => {
  it('ready 之后 iframe 再 load：serverStore 置 compromised 并断开该音源', async () => {
    const { id, iframe } = await connectMockSource()
    expect(useServerStore.getState().connectedServerIds).toContain(id)
    expect(getPluginHost(id)).toBeDefined()

    // 越界：沙箱自己导航走（那一跳的 URL 里可能带着凭据）
    iframe.dispatchEvent(new Event('load'))

    const state = useServerStore.getState()
    expect(state.compromisedServerIds).toContain(id)
    expect(state.connectedServerIds).not.toContain(id)
    // 登记处也不能再留着这个死沙箱
    expect(getPluginHost(id)).toBeUndefined()
  })

  it('横幅因此显示「插件异常」那一条——它排在离线之前，因为它不会自己好', () => {
    expect(pickBanner({ compromised: 1, offline: false, expired: 0 })).toBe('compromised')
    expect(pickBanner({ compromised: 1, offline: true, expired: 2 })).toBe('compromised')
    expect(pickBanner({ compromised: 0, offline: true, expired: 1 })).toBe('offline')
    expect(pickBanner({ compromised: 0, offline: false, expired: 1 })).toBe('sourceAuth')
    expect(pickBanner({ compromised: 0, offline: false, expired: 0 })).toBe(null)
  })

  it('重装插件后重新连上 = 判决作废，横幅不再挂着', async () => {
    const { id, iframe } = await connectMockSource()
    iframe.dispatchEvent(new Event('load'))
    expect(useServerStore.getState().compromisedServerIds).toContain(id)

    const reconnecting = useServerStore.getState().connectServer(id)
    await answerReady()
    expect(await reconnecting).toBe(true)
    expect(useServerStore.getState().compromisedServerIds).not.toContain(id)
  })

  it('沙箱在 ready 与登记之间越界：不把已经拆掉的 host 登记成好的', async () => {
    const server = {
      id: 'srv-race', name: 'Mock 音源', type: 'plugin' as const, pluginId: 'mock',
      url: '', username: '', token: '', credentials: 'COOKIE', isActive: true, createdAt: 0,
    }
    const booting = ensurePluginHost(server)
    const iframe = await answerReady()
    // ready 已回，但 ensurePluginHost 还没来得及登记就越界了
    iframe.dispatchEvent(new Event('load'))
    await expect(booting).rejects.toThrow()
    expect(getPluginHost('srv-race')).toBeUndefined()
  })
})

describe('同一个源并发装载', () => {
  it('两次 ensurePluginHost 同时进来只建一个沙箱，拿到同一个 host', async () => {
    const config = {
      id: 'srv-concurrent', type: 'plugin' as const, pluginId: 'mock', name: 'Mock',
      url: '', username: '', token: '', credentials: 'COOKIE', isActive: true, createdAt: Date.now(),
    }
    const first = ensurePluginHost(config)
    const second = ensurePluginHost(config)
    await answerReady()
    const [a, b] = await Promise.all([first, second])
    expect(a).toBe(b)
    expect(document.querySelectorAll('iframe')).toHaveLength(1)
    expect(getPluginHost('srv-concurrent')).toBe(a)
  })
})
