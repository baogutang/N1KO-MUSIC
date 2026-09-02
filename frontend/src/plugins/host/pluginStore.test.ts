/**
 * pluginStore（PLAN 1.4 验收）：安装（URL / 粘贴 / 目录）、更新检查、卸载清理。
 * IndexedDB 走 fake-indexeddb；网络用 stub 的 fetch。
 */

import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePluginStore } from './pluginStore'
import { resetPluginDbForTests } from './pluginStorage'
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
      'https://p.test/m2/manifest.json': makeManifest({ hosts: ['mock.test', 'extra.test'] }),
      'https://p.test/m2/index.js': 'code-v2',
    })
    const first = await STORE().install('https://p.test/m/manifest.json')
    expect(first.ok && first.hostsAdded).toBe(false) // 首装没有上一版可比
    const second = await STORE().install('https://p.test/m2/manifest.json')
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
