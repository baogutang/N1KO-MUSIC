/**
 * 适配器注册表的多源语义。
 *
 * 这些断言钉的是「多音源不串数据」的地基（审计 高-4/高-5/高-6）：
 * 注册 / 注销 / 主库切换 / 未注册抛错——任何一个语义松了，
 * 队列混源时请求就会打到错误的服务器上。
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { MusicServerAdapter, ServerConfig } from './types'
import {
  clearAdapter,
  createAdapter,
  findAdapterFor,
  getAdapter,
  getAdapterFor,
  hasAdapter,
  hasAdapterFor,
  listAdapters,
  registerAdapter,
  setPrimary,
  unregisterAdapter,
} from './index'

/** 只承载 serverId 的最小适配器替身：注册表不关心适配器内部 */
function stubAdapter(tag: string): MusicServerAdapter {
  return { type: 'subsonic', __tag: tag } as unknown as MusicServerAdapter
}

function baseConfig(overrides: Partial<ServerConfig>): ServerConfig {
  return {
    id: 'srv-x',
    name: 'x',
    type: 'subsonic',
    url: 'https://example.test',
    username: 'u',
    token: 't',
    isActive: false,
    createdAt: 0,
    ...overrides,
  }
}

afterEach(() => {
  clearAdapter()
})

describe('注册与注销', () => {
  it('注册后 getAdapterFor 能取到，listAdapters 全量可见', () => {
    const a = stubAdapter('a')
    const b = stubAdapter('b')
    registerAdapter('srv-a', a)
    registerAdapter('srv-b', b)
    expect(getAdapterFor('srv-a')).toBe(a)
    expect(getAdapterFor('srv-b')).toBe(b)
    expect(listAdapters().map(x => x.serverId).sort()).toEqual(['srv-a', 'srv-b'])
  })

  it('同一 serverId 重复注册以后者为准', () => {
    const old = stubAdapter('old')
    const fresh = stubAdapter('fresh')
    registerAdapter('srv-a', old)
    registerAdapter('srv-a', fresh)
    expect(getAdapterFor('srv-a')).toBe(fresh)
  })

  it('未注册的 serverId 抛错，而不是静默回退主库', () => {
    registerAdapter('srv-a', stubAdapter('a'))
    setPrimary('srv-a')
    expect(() => getAdapterFor('srv-nope')).toThrow(/srv-nope/)
  })

  it('注销后 getAdapterFor 抛错、hasAdapterFor 为假', () => {
    registerAdapter('srv-a', stubAdapter('a'))
    unregisterAdapter('srv-a')
    expect(() => getAdapterFor('srv-a')).toThrow()
    expect(hasAdapterFor('srv-a')).toBe(false)
  })

  it('注销主库时主库一并清空，getAdapter 恢复抛错', () => {
    registerAdapter('srv-a', stubAdapter('a'))
    setPrimary('srv-a')
    unregisterAdapter('srv-a')
    expect(hasAdapter()).toBe(false)
    expect(() => getAdapter()).toThrow()
  })
})

describe('主库语义', () => {
  it('getAdapter 返回主库，未设主库时抛错', () => {
    expect(() => getAdapter()).toThrow()
    const a = stubAdapter('a')
    registerAdapter('srv-a', a)
    expect(() => getAdapter()).toThrow()
    setPrimary('srv-a')
    expect(getAdapter()).toBe(a)
  })

  it('切换主库后 getAdapter 跟随，其余音源不受影响', () => {
    const a = stubAdapter('a')
    const b = stubAdapter('b')
    registerAdapter('srv-a', a)
    registerAdapter('srv-b', b)
    setPrimary('srv-a')
    expect(getAdapter()).toBe(a)
    setPrimary('srv-b')
    expect(getAdapter()).toBe(b)
    expect(getAdapterFor('srv-a')).toBe(a)
  })

  it('把未注册的 serverId 设为主库时抛错', () => {
    expect(() => setPrimary('srv-nope')).toThrow()
  })

  it('hasAdapter 只看主库，不看是否注册过别的音源', () => {
    registerAdapter('srv-a', stubAdapter('a'))
    expect(hasAdapter()).toBe(false)
    setPrimary('srv-a')
    expect(hasAdapter()).toBe(true)
  })
})

describe('findAdapterFor 的宽容回退', () => {
  it('缺 serverId 时回退主库', () => {
    const a = stubAdapter('a')
    registerAdapter('srv-a', a)
    setPrimary('srv-a')
    expect(findAdapterFor(undefined)).toBe(a)
  })

  it('serverId 未连接时返回 null 而不是抛错（封面等展示路径）', () => {
    registerAdapter('srv-a', stubAdapter('a'))
    setPrimary('srv-a')
    expect(findAdapterFor('srv-gone')).toBeNull()
  })

  it('什么都没有时返回 null', () => {
    expect(findAdapterFor(undefined)).toBeNull()
  })
})

describe('clearAdapter', () => {
  it('清空全部注册与主库', () => {
    registerAdapter('srv-a', stubAdapter('a'))
    registerAdapter('srv-b', stubAdapter('b'))
    setPrimary('srv-a')
    clearAdapter()
    expect(listAdapters()).toEqual([])
    expect(hasAdapter()).toBe(false)
    expect(() => getAdapterFor('srv-a')).toThrow()
  })
})

describe('createAdapter 传 serverId', () => {
  it('工厂创建的适配器是完整曲库音源', () => {
    const adapter = createAdapter(baseConfig({ id: 'srv-1', type: 'subsonic' }))
    // searchAll 走 mapSong：不请求网络，直接断言 mapper 产物即可（用内部请求桩太重，
    // 这里借 getSourceCapabilities 做最小存在性证据；
    // serverId 的映射正确性由 subsonic.test.ts / jellyfin.test.ts 单独钉住）。
    expect(adapter.type).toBe('subsonic')
    expect(adapter.getSourceCapabilities?.().libraryBrowse).toBe(true)
  })

  it('不认识的服务器类型抛错', () => {
    expect(() =>
      createAdapter(baseConfig({ type: 'plugin' as ServerConfig['type'] }))
    ).toThrow(/Unsupported server type/)
  })
})
