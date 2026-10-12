/**
 * @vitest-environment happy-dom
 *
 * 复核 F9 回归：删除/登出插件音源时，平台侧的 n1ko.auth.logout
 * 必须真正发出去——也就是必须**先 settle、后 dispose**。
 * 旧代码下一行就同步 disposePluginHost：iframe 拆掉、pendingCalls 全 reject，
 * 登出请求根本到不了平台，500ms race 等于不存在。
 * 同时钉住：disconnectServer（保凭据的断开）不调平台登出。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { pluginLogout, dispose, ensureHost } = vi.hoisted(() => ({
  pluginLogout: vi.fn(async () => undefined),
  dispose: vi.fn(),
  ensureHost: vi.fn(async () => { throw new Error('not needed') }),
}))

vi.mock('@/plugins/host/pluginRuntime', () => ({
  getPluginHost: vi.fn(() => ({
    hasMethod: (m: string) => m === 'n1ko.auth.logout',
    call: (m: string) => {
      if (m === 'n1ko.auth.logout') return pluginLogout()
      throw new Error(`unexpected ${m}`)
    },
    manifest: { id: 'netease', name: 'x', version: '0', protocol: 1, platform: 'netease', entry: 'i.js', capabilities: [], hosts: [], disclaimer: 'x' },
  })),
  disposePluginHost: dispose,
  ensurePluginHost: ensureHost,
  createPluginAdapterFor: vi.fn(() => ({})),
}))

vi.mock('@/api', async importOriginal => {
  const real = await importOriginal<typeof import('@/api')>()
  return { ...real, registerAdapter: vi.fn(), unregisterAdapter: vi.fn() }
})

import { useServerStore } from '@/store/serverStore'
import { usePlayerStore } from '@/store/playerStore'

const WY = 'wy'

beforeEach(() => {
  pluginLogout.mockClear()
  dispose.mockClear()
  useServerStore.setState({
    servers: [{ id: WY, name: '网易云', type: 'plugin', pluginId: 'netease', isActive: true, createdAt: 0 } as never],
    connectedServerIds: [WY],
    compromisedServerIds: [],
    activeServerId: WY,
    isConnected: true,
    username: 'u',
    avatarUrl: null,
  })
  usePlayerStore.setState({ queue: [], queueIndex: -1, currentSong: null, isPlaying: false } as never)
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('平台登出与拆沙箱的顺序（F9）', () => {
  it('removeServer：logout settle 之后才 dispose（登出请求能活着到平台）', async () => {
    const order: string[] = []
    pluginLogout.mockImplementationOnce(async () => {
      await new Promise(r => setTimeout(r, 30))
      order.push('logout-settled')
    })
    dispose.mockImplementationOnce(() => { order.push('dispose') })

    await useServerStore.getState().removeServer(WY)

    expect(pluginLogout).toHaveBeenCalledTimes(1)
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(order, '顺序：先登出 settle，后拆沙箱').toEqual(['logout-settled', 'dispose'])
    expect(useServerStore.getState().servers).toHaveLength(0)
  })

  it('logout 卡住不动：500ms 超时后照样拆，不会永远等下去', { timeout: 10_000 }, async () => {
    vi.useFakeTimers()
    try {
      pluginLogout.mockImplementationOnce(() => new Promise(() => { /* 永不 resolve */ }))
      const removing = useServerStore.getState().removeServer(WY)
      // 推进过 500ms 超时窗
      await vi.advanceTimersByTimeAsync(600)
      await removing
      expect(dispose).toHaveBeenCalledTimes(1)
      expect(useServerStore.getState().servers).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('disconnectServer 不调平台登出（盘上凭据要留给自动重连）', () => {
    useServerStore.getState().disconnectServer(WY)

    expect(pluginLogout, '断开≠登出').not.toHaveBeenCalled()
    expect(dispose, '沙箱照拆').toHaveBeenCalledTimes(1)
    expect(useServerStore.getState().connectedServerIds).toHaveLength(0)
  })

  it('disconnect（登出全部）：每个源都先登出再拆', async () => {
    const order: string[] = []
    pluginLogout.mockImplementation(async () => {
      await new Promise(r => setTimeout(r, 5))
      order.push('logout')
    })
    dispose.mockImplementation(() => { order.push('dispose') })

    await useServerStore.getState().disconnect()

    expect(pluginLogout).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['logout', 'dispose'])
  })
})
