/**
 * pluginStore（PLAN 1.4 验收）：安装（URL / 粘贴 / 目录）、更新检查、卸载清理。
 * IndexedDB 走 fake-indexeddb；网络用 stub 的 fetch。
 */

import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isSameInstallSource, usePluginStore } from './pluginStore'
import { pluginStorageGet, pluginStorageSet, resetPluginDbForTests, writePlugin } from './pluginStorage'
import { useServerStore } from '@/store/serverStore'
import type { PluginManifest } from '../types'

function makeManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: 'mock', name: 'Mock 音源', version: '0.1.0', protocol: 1, platform: 'mock',
    entry: 'index.js', auth: { kind: 'qr' }, hosts: ['mock.test'],
    capabilities: ['search'], disclaimer: '测试声明',
    ...overrides,
  }
}

/** 按路径分发的假 fetch：同源安装地址与目录地址都走这里 */
function stubFetch(routes: Record<string, unknown>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (!(url in routes)) return new Response('not found', { status: 404 })
    const body = routes[url]
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })
}

const STORE = () => usePluginStore.getState()

beforeEach(async () => {
  await resetPluginDbForTests()
  usePluginStore.setState({ plugins: [], catalogUrl: '', loaded: false, installing: null })
  // location.href 在 node 环境下可能没有；install 源解析依赖它
  if (typeof location === 'undefined') {
    (globalThis as Record<string, unknown>).location = { href: 'http://localhost:5173/', origin: 'http://localhost:5173' }
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('从 URL 安装', () => {
  it('拉 manifest → 解析 entry 相对地址 → 拉代码 → 落 IndexedDB', async () => {
    const fetchSpy = stubFetch({
      'https://plugins.example.test/mock/manifest.json': makeManifest(),
      'https://plugins.example.test/mock/index.js': 'module.exports = { platform: "mock" }',
    })
    const result = await STORE().install('https://plugins.example.test/mock/manifest.json')
    expect(result.ok).toBe(true)
    expect(STORE().plugins).toHaveLength(1)
    expect(STORE().plugins[0]).toMatchObject({ id: 'mock', name: 'Mock 音源', version: '0.1.0' })
    // 代码与哈希落在 IndexedDB，不在 zustand 清单里
    const installed = await STORE().getInstalled('mock')
    expect(installed?.code).toContain('platform')
    expect(installed?.codeHash).toMatch(/^[0-9a-f]{64}$/)
    expect(installed?.sourceUrl).toBe('https://plugins.example.test/mock/manifest.json')
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('重复安装同一版本不报错；hosts 有新增时回 hostsAdded', async () => {
    stubFetch({
      'https://p.test/m/manifest.json': makeManifest(),
      'https://p.test/m/index.js': 'code-v1',
    })
    const first = await STORE().install('https://p.test/m/manifest.json')
    expect(first.ok && first.hostsAdded).toBe(false) // 首装没有上一版可比
    const again = await STORE().install('https://p.test/m/manifest.json')
    expect(again.ok && again.hostsAdded).toBe(false)
    /* 同一个来源发了新版、多要了域名。（此前这里用的是另一个地址 m2/——
       那是「换来源」，一步装完的 install 现在不再替换，见下面「换来源」一组） */
    vi.restoreAllMocks()
    stubFetch({
      'https://p.test/m/manifest.json': makeManifest({ version: '0.2.0', hosts: ['mock.test', 'extra.test'] }),
      'https://p.test/m/index.js': 'code-v2',
    })
    const second = await STORE().install('https://p.test/m/manifest.json')
    expect(second.ok && second.hostsAdded).toBe(true)
    // 清单里仍只有一条（同 id 覆盖）
    expect(STORE().plugins).toHaveLength(1)
  })

  it('manifest 不合法直接拒绝，不落任何记录', async () => {
    stubFetch({
      'https://p.test/bad/manifest.json': makeManifest({ protocol: 99 }),
    })
    const result = await STORE().install('https://p.test/bad/manifest.json')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('protocol')
    expect(STORE().plugins).toHaveLength(0)
  })

  it('安装源防线：http 非同源、内网、带 userinfo 的地址拒绝', async () => {
    const fetchSpy = stubFetch({})
    for (const url of [
      'http://plugins.example.test/m/manifest.json',
      'https://user:pw@plugins.example.test/m/manifest.json',
    ]) {
      const result = await STORE().install(url)
      expect(result.ok).toBe(false)
    }
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('从粘贴文本安装', () => {
  it('manifest JSON + 代码直接落库', async () => {
    const result = await STORE().installPasted(JSON.stringify(makeManifest()), 'module.exports = {}')
    expect(result.ok).toBe(true)
    expect(STORE().plugins[0].id).toBe('mock')
    expect((await STORE().getInstalled('mock'))?.code).toBe('module.exports = {}')
  })

  it('JSON 解析失败给可读错误', async () => {
    const result = await STORE().installPasted('not json', 'code')
    expect(result.ok).toBe(false)
  })
})

describe('从目录安装与更新检查', () => {
  const CATALOG = 'http://localhost:5173/__n1ko_plugins/catalog.json'

  it('目录条目 → 解析相对 manifest 地址 → 安装', async () => {
    stubFetch({
      [CATALOG]: [{ id: 'mock', name: 'Mock', version: '0.1.0', manifest: 'mock/manifest.json' }],
      'http://localhost:5173/__n1ko_plugins/mock/manifest.json': makeManifest(),
      'http://localhost:5173/__n1ko_plugins/mock/index.js': 'code',
    })
    await STORE().setCatalogUrl(CATALOG)
    const result = await STORE().installFromCatalog('mock')
    expect(result.ok).toBe(true)
    expect(STORE().plugins[0].id).toBe('mock')
  })

  it('目录里没有的 id 报错', async () => {
    stubFetch({ [CATALOG]: [] })
    await STORE().setCatalogUrl(CATALOG)
    const result = await STORE().installFromCatalog('nope')
    expect(result.ok).toBe(false)
  })

  it('checkUpdates 找出版本不同的条目', async () => {
    stubFetch({
      [CATALOG]: [{ id: 'mock', name: 'Mock', version: '0.2.0', manifest: 'mock/manifest.json' }],
    })
    await STORE().installPasted(JSON.stringify(makeManifest()), 'code')
    await STORE().setCatalogUrl(CATALOG)
    const updates = await STORE().checkUpdates()
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({ id: 'mock', currentVersion: '0.1.0', nextVersion: '0.2.0' })
  })

  it('未配置目录时 checkUpdates 返回空', async () => {
    await STORE().setCatalogUrl('')
    expect(await STORE().checkUpdates()).toEqual([])
  })
})

describe('卸载清理', () => {
  it('删代码、私有 KV，并移除挂在该插件上的音源', async () => {
    // 用假的 serverStore servers：uninstall 会调 removeServer
    const { useServerStore } = await import('@/store/serverStore')
    const addSpy = vi.fn()
    const removeSpy = vi.fn()
    // 只挂最小面：servers 列表 + removeServer
    vi.spyOn(useServerStore, 'getState').mockReturnValue({
      servers: [
        { id: 'srv-1', pluginId: 'mock' },
        { id: 'srv-2', pluginId: 'other' },
      ],
      removeServer: removeSpy,
    } as never)

    await STORE().installPasted(JSON.stringify(makeManifest()), 'code')
    expect(STORE().plugins).toHaveLength(1)

    await STORE().uninstall('mock')
    expect(STORE().plugins).toHaveLength(0)
    expect(await STORE().getInstalled('mock')).toBeUndefined()
    // 只移除挂在该插件上的音源
    expect(removeSpy).toHaveBeenCalledTimes(1)
    expect(removeSpy).toHaveBeenCalledWith('srv-1')
  })
})

describe('load 与目录地址默认值', () => {
  it('IndexedDB 里的记录载入清单；目录地址持久化', async () => {
    await STORE().installPasted(JSON.stringify(makeManifest()), 'code')
    await STORE().setCatalogUrl('https://catalog.example.test/x.json')
    // 重置内存态再 load（模拟刷新）
    usePluginStore.setState({ plugins: [], catalogUrl: '', loaded: false })
    await STORE().load()
    expect(STORE().plugins).toHaveLength(1)
    expect(STORE().catalogUrl).toBe('https://catalog.example.test/x.json')
  })
})

describe('两段式安装：prepareInstall 不落盘，commitInstall 才落', () => {
  const MANIFEST = 'http://localhost:5173/__n1ko_plugins/mock/manifest.json'

  it('prepare 只拉取校验并算 hosts 增量；commit 之后清单才出现', async () => {
    stubFetch({
      [MANIFEST]: makeManifest(),
      'http://localhost:5173/__n1ko_plugins/mock/index.js': 'code-v1',
    })
    const prepared = await STORE().prepareInstall(MANIFEST)
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    expect(prepared.pending.addedHosts).toEqual([])          // 首装没有「上一版」可比
    expect(prepared.pending.currentVersion).toBeUndefined()
    expect(STORE().plugins).toHaveLength(0)                  // 还没落盘
    expect(await STORE().getInstalled('mock')).toBeUndefined()

    const committed = await STORE().commitInstall(prepared.pending)
    expect(committed.ok).toBe(true)
    expect(STORE().plugins.map(p => p.id)).toEqual(['mock'])
    expect((await STORE().getInstalled('mock'))?.code).toBe('code-v1')
  })

  it('升级时 prepare 报出 hosts 增量与当前版本', async () => {
    await STORE().installPasted(JSON.stringify(makeManifest()), 'code-v1')
    stubFetch({
      [MANIFEST]: makeManifest({ version: '0.2.0', hosts: ['mock.test', 'cdn.mock.test'] }),
      'http://localhost:5173/__n1ko_plugins/mock/index.js': 'code-v2',
    })
    const prepared = await STORE().prepareInstall(MANIFEST)
    expect(prepared.ok && prepared.pending.addedHosts).toEqual(['cdn.mock.test'])
    expect(prepared.ok && prepared.pending.currentVersion).toBe('0.1.0')
    // 没 commit，装的还是旧版
    expect(STORE().plugins[0].version).toBe('0.1.0')
  })
})

describe('内置音源静默更新只认出厂目录', () => {
  /** 出厂目录：开发态 /__n1ko_plugins/catalog.json（与 defaultCatalogUrl 同一棵目录树） */
  const FACTORY = 'http://localhost:5173/__n1ko_plugins/catalog.json'

  /** 从出厂目录装上 0.1.0 版的 netease（内置 id） */
  async function installBuiltinFromFactory(fetchRoutes: Record<string, unknown>) {
    stubFetch({
      [FACTORY]: [{ id: 'netease', name: '网易云音乐', version: '0.1.0', manifest: 'netease/manifest.json' }],
      'http://localhost:5173/__n1ko_plugins/netease/manifest.json': makeManifest({ id: 'netease', platform: 'netease' }),
      'http://localhost:5173/__n1ko_plugins/netease/index.js': 'code-v1',
    })
    await STORE().setCatalogUrl(FACTORY)
    const r = await STORE().installFromCatalog('netease')
    expect(r.ok).toBe(true)
    vi.restoreAllMocks()
    return stubFetch(fetchRoutes)
  }

  it('出厂目录里版本变了且 hosts 无新增 → 静默换代码', async () => {
    await installBuiltinFromFactory({
      [FACTORY]: [{ id: 'netease', name: '网易云音乐', version: '0.2.0', manifest: 'netease/manifest.json' }],
      'http://localhost:5173/__n1ko_plugins/netease/manifest.json': makeManifest({ id: 'netease', platform: 'netease', version: '0.2.0' }),
      'http://localhost:5173/__n1ko_plugins/netease/index.js': 'code-v2',
    })
    await STORE().autoUpdateBuiltins()
    expect(STORE().plugins[0].version).toBe('0.2.0')
    expect((await STORE().getInstalled('netease'))?.code).toBe('code-v2')
    expect(STORE().heldUpdates).toEqual([])
  })

  it('hosts 有新增 → 扣下等确认，代码不换', async () => {
    await installBuiltinFromFactory({
      [FACTORY]: [{ id: 'netease', name: '网易云音乐', version: '0.2.0', manifest: 'netease/manifest.json' }],
      'http://localhost:5173/__n1ko_plugins/netease/manifest.json':
        makeManifest({ id: 'netease', platform: 'netease', version: '0.2.0', hosts: ['mock.test', 'evil.test'] }),
      'http://localhost:5173/__n1ko_plugins/netease/index.js': 'code-v2',
    })
    await STORE().autoUpdateBuiltins()
    expect(STORE().plugins[0].version).toBe('0.1.0')
    expect(STORE().heldUpdates).toMatchObject([{ id: 'netease', nextVersion: '0.2.0', addedHosts: ['evil.test'] }])
  })

  it('用户把目录换成第三方站点：同名 netease 条目不算内置，不静默更新', async () => {
    const THIRD = 'https://third.example.test/plugins/catalog.json'
    await installBuiltinFromFactory({
      [THIRD]: [{ id: 'netease', name: '网易云音乐', version: '9.9.9', manifest: 'netease/manifest.json' }],
      'https://third.example.test/plugins/netease/manifest.json': makeManifest({ id: 'netease', platform: 'netease', version: '9.9.9' }),
      'https://third.example.test/plugins/netease/index.js': 'code-evil',
    })
    await STORE().setCatalogUrl(THIRD)
    await STORE().autoUpdateBuiltins()
    expect(STORE().plugins[0].version).toBe('0.1.0')
    expect((await STORE().getInstalled('netease'))?.code).toBe('code-v1')
  })

  it('同源但不在出厂目录树里的目录同样不算内置（正式版出厂目录与其它同源路径要分开）', async () => {
    const OTHER = 'http://localhost:5173/somewhere-else/catalog.json'
    await installBuiltinFromFactory({
      [OTHER]: [{ id: 'netease', name: '网易云音乐', version: '9.9.9', manifest: 'netease/manifest.json' }],
      'http://localhost:5173/somewhere-else/netease/manifest.json': makeManifest({ id: 'netease', platform: 'netease', version: '9.9.9' }),
      'http://localhost:5173/somewhere-else/netease/index.js': 'code-other',
    })
    await STORE().setCatalogUrl(OTHER)
    await STORE().autoUpdateBuiltins()
    expect(STORE().plugins[0].version).toBe('0.1.0')
  })
})

// ===================================================
// 换来源：同 id、来源不同的安装（2026-11-12 加固）
// ===================================================

/** 一个挂在某插件上的音源（带登录凭据） */
function pluginServer(id: string, pluginId: string, credentials: string) {
  return {
    id, pluginId, type: 'plugin' as const, name: id,
    url: '', username: '', token: '', credentials, isActive: false, createdAt: 0,
  }
}

describe('换来源：同 id、来源不同', () => {
  const A = 'https://a.example.test/netease/manifest.json'
  const B = 'https://b.example.test/netease/manifest.json'

  async function installFromA() {
    stubFetch({
      [A]: makeManifest({ id: 'netease', platform: 'netease' }),
      'https://a.example.test/netease/index.js': 'code-a',
    })
    const r = await STORE().install(A)
    expect(r.ok).toBe(true)
    vi.restoreAllMocks()
  }

  beforeEach(() => {
    useServerStore.setState({
      servers: [pluginServer('srv-ne', 'netease', 'MUSIC_U=old'), pluginServer('srv-qq', 'qqmusic', 'qq=keep')],
      connectedServerIds: [], compromisedServerIds: [], activeServerId: null,
    } as never)
  })

  it('prepareInstall 报出「来源变了」与原来的来源；hosts 没新增也照样报', async () => {
    await installFromA()
    stubFetch({
      [B]: makeManifest({ id: 'netease', platform: 'netease', version: '0.2.0' }),
      'https://b.example.test/netease/index.js': 'code-b',
    })
    const prepared = await STORE().prepareInstall(B)
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    expect(prepared.pending.addedHosts).toEqual([])
    expect(prepared.pending.sourceChanged).toBe(true)
    expect(prepared.pending.previousSourceUrl).toBe(A)
  })

  it('一步装完的 install 不替换换了来源的插件：代码与凭据都不动', async () => {
    await installFromA()
    stubFetch({
      [B]: makeManifest({ id: 'netease', platform: 'netease', version: '0.2.0' }),
      'https://b.example.test/netease/index.js': 'code-b',
    })
    const r = await STORE().install(B)
    expect(r.ok).toBe(false)
    expect((await STORE().getInstalled('netease'))?.code).toBe('code-a')
    expect(useServerStore.getState().servers.find(s => s.id === 'srv-ne')?.credentials).toBe('MUSIC_U=old')
  })

  it('确认后提交：清掉该插件音源的登录与私有存储，别的插件不受影响', async () => {
    await installFromA()
    await pluginStorageSet('netease', 'anonymous-cookie', 'NMTID=old')
    await pluginStorageSet('qqmusic', 'guid', 'keep-me')
    stubFetch({
      [B]: makeManifest({ id: 'netease', platform: 'netease', version: '0.2.0' }),
      'https://b.example.test/netease/index.js': 'code-b',
    })
    const prepared = await STORE().prepareInstall(B)
    if (!prepared.ok) throw new Error(prepared.error)
    const committed = await STORE().commitInstall(prepared.pending)
    expect(committed.ok).toBe(true)

    const installed = await STORE().getInstalled('netease')
    expect(installed?.code).toBe('code-b')
    expect(installed?.sourceUrl).toBe(B)
    const servers = useServerStore.getState().servers
    // 音源行留着（原地重新登录），凭据没了
    expect(servers.find(s => s.id === 'srv-ne')).toBeDefined()
    expect(servers.find(s => s.id === 'srv-ne')?.credentials).toBeUndefined()
    expect(servers.find(s => s.id === 'srv-qq')?.credentials).toBe('qq=keep')
    expect(await pluginStorageGet('netease', 'anonymous-cookie')).toBeNull()
    expect(await pluginStorageGet('qqmusic', 'guid')).toBe('keep-me')
  })

  it('同一来源的升级不算换来源：凭据与私有存储都保留', async () => {
    await installFromA()
    await pluginStorageSet('netease', 'device-id', 'dev-1')
    stubFetch({
      [A]: makeManifest({ id: 'netease', platform: 'netease', version: '0.2.0' }),
      'https://a.example.test/netease/index.js': 'code-a2',
    })
    const prepared = await STORE().prepareInstall(A)
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.pending.sourceChanged).toBe(false)
    await STORE().commitInstall(prepared.pending)
    expect(useServerStore.getState().servers.find(s => s.id === 'srv-ne')?.credentials).toBe('MUSIC_U=old')
    expect(await pluginStorageGet('netease', 'device-id')).toBe('dev-1')
  })

  it('粘贴安装不能覆盖来自别处的同 id 插件；覆盖粘贴装的照旧可以', async () => {
    await installFromA()
    const refused = await STORE().installPasted(JSON.stringify(makeManifest({ id: 'netease', platform: 'netease' })), 'pasted')
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.error).toContain(A)
    expect((await STORE().getInstalled('netease'))?.code).toBe('code-a')
    expect(useServerStore.getState().servers.find(s => s.id === 'srv-ne')?.credentials).toBe('MUSIC_U=old')

    await STORE().installPasted(JSON.stringify(makeManifest()), 'p1')
    const again = await STORE().installPasted(JSON.stringify(makeManifest()), 'p2')
    expect(again.ok).toBe(true)
    expect((await STORE().getInstalled('mock'))?.code).toBe('p2')
  })
})

describe('内置升级不算换来源（不同壳、不同版本的应用源各不相同）', () => {
  /** 开发态出厂目录（defaultCatalogUrl 的目录树） */
  const FACTORY = 'http://localhost:5173/__n1ko_plugins/catalog.json'
  const FACTORY_MANIFEST = 'http://localhost:5173/__n1ko_plugins/netease/manifest.json'

  beforeEach(() => {
    useServerStore.setState({
      servers: [pluginServer('srv-ne', 'netease', 'MUSIC_U=keep')],
      connectedServerIds: [], compromisedServerIds: [], activeServerId: null,
    } as never)
  })

  it('isSameInstallSource：各壳的随包目录互相算同一个来源', () => {
    const bundled = [
      'tauri://localhost/plugins/netease/manifest.json',
      'http://tauri.localhost/plugins/netease/manifest.json',
      'https://tauri.localhost/plugins/netease/manifest.json',
      'capacitor://localhost/plugins/netease/manifest.json',
      'https://localhost/plugins/netease/manifest.json',
      'http://localhost:5173/__n1ko_plugins/netease/manifest.json',
      'http://localhost:5173/plugins/netease/manifest.json',
      '/plugins/netease/manifest.json',
    ]
    for (const a of bundled) {
      for (const b of bundled) expect(isSameInstallSource(a, b), `${a} vs ${b}`).toBe(true)
    }
  })

  it('isSameInstallSource：随包与第三方、粘贴与任何地址都不是同一个', () => {
    const builtin = 'tauri://localhost/plugins/netease/manifest.json'
    expect(isSameInstallSource(builtin, 'https://evil.example.test/plugins/netease/manifest.json')).toBe(false)
    // 主机名只是长得像 localhost 的公网域名不算壳
    expect(isSameInstallSource(builtin, 'https://localhost.evil.test/plugins/netease/manifest.json')).toBe(false)
    // 壳的源、但不在随包目录里
    expect(isSameInstallSource(builtin, 'https://localhost/other/netease/manifest.json')).toBe(false)
    expect(isSameInstallSource(undefined, builtin)).toBe(false)
    expect(isSameInstallSource(undefined, undefined)).toBe(true)
    // 第三方按完整地址比：同址（#片段不算）相同，换路径即不同
    expect(isSameInstallSource('https://x.test/p/m.json', 'https://x.test/p/m.json#v2')).toBe(true)
    expect(isSameInstallSource('https://x.test/p/m.json', 'https://x.test/q/m.json')).toBe(false)
  })

  it('盘上记的是另一个壳的随包地址（tauri://localhost/plugins/），这次从出厂目录升级：不算换来源', async () => {
    await writePlugin({
      manifest: makeManifest({ id: 'netease', platform: 'netease' }) as never,
      code: 'code-v1', codeHash: 'h1', installedAt: 0,
      sourceUrl: 'tauri://localhost/plugins/netease/manifest.json',
    })
    stubFetch({
      [FACTORY_MANIFEST]: makeManifest({ id: 'netease', platform: 'netease', version: '0.2.0' }),
      'http://localhost:5173/__n1ko_plugins/netease/index.js': 'code-v2',
    })
    const prepared = await STORE().prepareInstall(FACTORY_MANIFEST)
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.pending.sourceChanged).toBe(false)
    await STORE().commitInstall(prepared.pending)
    expect(useServerStore.getState().servers[0].credentials).toBe('MUSIC_U=keep')
  })

  it('autoUpdateBuiltins 走完一次内置升级：不扣下、不清登录、不清私有存储', async () => {
    stubFetch({
      [FACTORY]: [{ id: 'netease', name: '网易云音乐', version: '0.1.0', manifest: 'netease/manifest.json' }],
      [FACTORY_MANIFEST]: makeManifest({ id: 'netease', platform: 'netease' }),
      'http://localhost:5173/__n1ko_plugins/netease/index.js': 'code-v1',
    })
    await STORE().setCatalogUrl(FACTORY)
    expect((await STORE().installFromCatalog('netease')).ok).toBe(true)
    await pluginStorageSet('netease', 'device-id', 'dev-1')
    vi.restoreAllMocks()
    stubFetch({
      [FACTORY]: [{ id: 'netease', name: '网易云音乐', version: '0.2.0', manifest: 'netease/manifest.json' }],
      [FACTORY_MANIFEST]: makeManifest({ id: 'netease', platform: 'netease', version: '0.2.0' }),
      'http://localhost:5173/__n1ko_plugins/netease/index.js': 'code-v2',
    })
    await STORE().autoUpdateBuiltins()

    expect((await STORE().getInstalled('netease'))?.code).toBe('code-v2')
    expect(STORE().heldUpdates).toEqual([])
    expect(useServerStore.getState().servers[0].credentials).toBe('MUSIC_U=keep')
    expect(await pluginStorageGet('netease', 'device-id')).toBe('dev-1')
  })
})

// ===================================================
// 读盘复验：IndexedDB 里的 manifest 不当可信输入
// ===================================================

describe('读盘复验', () => {
  it('不合格的记录：getInstalled 抛出说得清的错，load 照样列出它（留着卸载入口）', async () => {
    // load 会顺手跑内置自动更新、去拉出厂目录：挂一个全 404 的桩，不发真实请求
    stubFetch({})
    await writePlugin({
      manifest: { ...makeManifest({ id: 'broken' }), hosts: ['*.com'] } as never,
      code: 'x', codeHash: 'h', installedAt: 0,
    })
    await expect(STORE().getInstalled('broken')).rejects.toThrow(/broken.*不合法.*重新安装/)
    usePluginStore.setState({ plugins: [], loaded: false })
    await STORE().load()
    expect(STORE().plugins.map(p => p.id)).toEqual(['broken'])
  })

  it('形状坏到字段都不是字符串：清单照样生成，不抛', async () => {
    stubFetch({})
    await writePlugin({
      manifest: { id: 'weird', name: 42, version: null, hosts: 'music.163.com', color: 'red;x' } as never,
      code: 'x', codeHash: 'h', installedAt: 0,
    })
    await STORE().load()
    expect(STORE().plugins[0]).toMatchObject({ id: 'weird', name: 'weird', version: '' })
    expect(STORE().plugins[0].color).toBeUndefined()
    await expect(STORE().getInstalled('weird')).rejects.toThrow(/weird/)
  })

  it('v1.11 之前出厂的网易云 0.1.0 / QQ 0.1.0（MusicFree 的能力名）读盘仍能通过', async () => {
    // 原样取自 git 历史里两个插件的首版 manifest（只省略了 disclaimer 正文）
    const netease010 = {
      id: 'netease', name: '网易云音乐', version: '0.1.0', protocol: 1, platform: 'netease', entry: 'index.js',
      author: 'N1KO', auth: { kind: 'qr', allowAnonymous: true },
      hosts: ['music.163.com', '*.music.126.net'],
      capabilities: ['search', 'musicUrl', 'lyric', 'album', 'artist', 'musicSheet', 'importMusicSheet', 'importMusicItem', 'topLists', 'recommendSheets', 'userPlaylists', 'playlistWrite'],
      qualities: ['low', 'medium', 'high', 'lossless'], disclaimer: '本插件使用你自己的网易云账号……', color: '#c20c0c',
    }
    const qqmusic010 = {
      id: 'qqmusic', name: 'QQ 音乐', version: '0.1.0', protocol: 1, platform: 'qqmusic', entry: 'index.js',
      author: 'N1KO', auth: { kind: 'qr', allowAnonymous: true },
      hosts: ['y.qq.com', 'u.y.qq.com', 'graph.qq.com', 'ssl.ptlogin2.qq.com', 'ssl.ptlogin2.graph.qq.com'],
      capabilities: ['search', 'musicUrl', 'lyric', 'album', 'artist', 'musicSheet', 'importMusicSheet', 'importMusicItem', 'topLists', 'recommendSheets', 'userPlaylists'],
      qualities: ['low', 'medium', 'high', 'lossless'], disclaimer: '本插件使用你自己的 QQ 音乐账号……', color: '#31c27c',
    }
    for (const manifest of [netease010, qqmusic010]) {
      await writePlugin({ manifest: manifest as never, code: 'code', codeHash: 'h', installedAt: 0, sourceUrl: '/plugins/x/manifest.json' })
      const installed = await STORE().getInstalled(manifest.id)
      expect(installed?.manifest.id).toBe(manifest.id)
    }
  })

  it('上一版记录坏了也能覆盖安装：这次的 hosts 全部算新增，交给确认', async () => {
    await writePlugin({
      manifest: { ...makeManifest(), hosts: 'not-an-array' } as never,
      code: 'old', codeHash: 'h', installedAt: 0, sourceUrl: 'https://p.test/m/manifest.json',
    })
    stubFetch({
      'https://p.test/m/manifest.json': makeManifest({ version: '0.2.0' }),
      'https://p.test/m/index.js': 'new',
    })
    const prepared = await STORE().prepareInstall('https://p.test/m/manifest.json')
    expect(prepared.ok).toBe(true)
    if (prepared.ok) expect(prepared.pending.addedHosts).toEqual(['mock.test'])
  })
})
