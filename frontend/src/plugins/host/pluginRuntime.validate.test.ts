/**
 * @vitest-environment happy-dom
 *
 * 装载沙箱之前复验盘上的 manifest（2026-11-12 加固）。
 *
 * IndexedDB 里读回来的 manifest 此前直接 `as unknown as PluginManifest` 强转着用，
 * 而它的 hosts 就是这个沙箱的出网白名单。这里钉住：不合格的不装载（一个 iframe
 * 都不建）、给出点名插件的错误；connectServer 按连接失败处理，不把应用拖垮。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const installed = vi.hoisted(() => ({ manifest: {} as Record<string, unknown> }))
vi.mock('./pluginStore', () => ({
  usePluginStore: {
    getState: () => ({
      getInstalled: async () => ({ manifest: installed.manifest, code: 'module.exports = {}', codeHash: 'h' }),
    }),
  },
}))

const { ensurePluginHost, getPluginHost, openAuthHost } = await import('./pluginRuntime')
const { useServerStore } = await import('@/store/serverStore')

const goodManifest = {
  id: 'mock', name: 'Mock', version: '0.1.0', protocol: 1, platform: 'mock',
  entry: 'index.js', auth: { kind: 'qr' }, hosts: ['music.163.com'],
  capabilities: ['search'], disclaimer: 'x',
}

let seq = 0
const configFor = () => ({
  id: `srv-validate-${++seq}`, type: 'plugin' as const, pluginId: 'mock', name: 'Mock',
  url: '', username: '', token: '', credentials: 'COOKIE', isActive: true, createdAt: 0,
})

beforeEach(() => {
  installed.manifest = { ...goodManifest }
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  document.querySelectorAll('iframe').forEach(f => f.remove())
  vi.restoreAllMocks()
})

describe('盘上 manifest 不合格就不装载', () => {
  it.each([
    ['hosts 过宽通配', { hosts: ['*.com'] }],
    ['hosts 不是数组', { hosts: 'music.163.com' }],
    ['hosts 带协议', { hosts: ['https://music.163.com'] }],
    ['id 不合法', { id: '../evil' }],
    ['protocol 不认识', { protocol: 2 }],
  ])('%s：ensurePluginHost 抛出点名插件的错，不建沙箱', async (_why, patch) => {
    installed.manifest = { ...goodManifest, ...patch }
    const config = configFor()
    await expect(ensurePluginHost(config)).rejects.toThrow(/插件 mock 的安装记录不合法/)
    expect(document.querySelector('iframe')).toBeNull()
    expect(getPluginHost(config.id)).toBeUndefined()
  })

  it('预登录沙箱（登录页扫码）同样先复验', async () => {
    installed.manifest = { ...goodManifest, hosts: ['*'] }
    await expect(openAuthHost('mock')).rejects.toThrow(/插件 mock 的安装记录不合法/)
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('connectServer 按连接失败处理：返回 false，不抛、不连上', async () => {
    installed.manifest = { ...goodManifest, hosts: ['*.com.cn'] }
    useServerStore.setState({ servers: [], connectedServerIds: [], compromisedServerIds: [], activeServerId: null })
    const id = useServerStore.getState().addServer({
      type: 'plugin', pluginId: 'mock', name: 'Mock 音源',
      url: '', username: '', token: '', credentials: 'COOKIE', isActive: true,
    })
    await expect(useServerStore.getState().connectServer(id)).resolves.toBe(false)
    expect(useServerStore.getState().connectedServerIds).not.toContain(id)
  })

  it('合格的（含旧版出厂插件的 MusicFree 能力名）照常装载', async () => {
    installed.manifest = { ...goodManifest, capabilities: ['search', 'lyric', 'musicUrl'] }
    const config = configFor()
    const booting = ensurePluginHost(config)
    for (let i = 0; i < 200 && !document.querySelector('iframe'); i++) {
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    const iframe = document.querySelector('iframe') as HTMLIFrameElement
    expect(iframe).not.toBeNull()
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'ready', methods: ['search'] }, source: iframe.contentWindow }))
    const host = await booting
    expect(host.manifest.hosts).toEqual(['music.163.com'])
    host.dispose()
  })
})
