import { describe, expect, it } from 'vitest'
import { pickMergedCoverDisplaySrc } from '@/hooks/useCoverUrl'
import type { CoverSource } from '@/store/settingsStore'

const SERVER = 'https://server/cover.jpg'
const CUSTOM = 'blob:custom-cover'
const PINNED = 'https://pinned/cover.jpg'

const ALL_SOURCES: CoverSource[] = ['server_first', 'remote_first', 'server_only', 'remote_only']

function pick(overrides: Partial<Parameters<typeof pickMergedCoverDisplaySrc>[0]> = {}) {
  return pickMergedCoverDisplaySrc({
    coverSource: 'server_first',
    serverSrc: SERVER,
    serverFailed: false,
    customBlobUrl: CUSTOM,
    hasCustom: true,
    ...overrides,
  })
}

describe('封面来源优先级', () => {
  it('手动钉住的本地封面优先于一切来源与设置', () => {
    for (const coverSource of ALL_SOURCES) {
      expect(pick({ coverSource, pinnedSrc: PINNED })).toBe(PINNED)
    }
  })

  it('钉住的封面在服务器封面失效时依然生效', () => {
    expect(pick({ serverSrc: undefined, serverFailed: true, hasCustom: false, pinnedSrc: PINNED }))
      .toBe(PINNED)
  })

  it('未钉住时按设置的封面来源决定', () => {
    expect(pick({ coverSource: 'server_first' })).toBe(SERVER)
    expect(pick({ coverSource: 'remote_first' })).toBe(CUSTOM)
    expect(pick({ coverSource: 'server_only' })).toBe(SERVER)
    expect(pick({ coverSource: 'remote_only' })).toBe(CUSTOM)
  })

  it('server_first 在服务器封面失败时降级到自定义封面', () => {
    expect(pick({ coverSource: 'server_first', serverFailed: true })).toBe(CUSTOM)
  })

  it('server_only 不会降级到自定义封面', () => {
    expect(pick({ coverSource: 'server_only', serverFailed: true })).toBeUndefined()
  })

  it('未配置自定义封面时只用服务器封面', () => {
    expect(pick({ hasCustom: false, customBlobUrl: null })).toBe(SERVER)
    expect(pick({ hasCustom: false, customBlobUrl: null, serverFailed: true })).toBeUndefined()
  })

  it('空字符串的钉住值视为未钉住,不会盖掉正常封面', () => {
    expect(pick({ pinnedSrc: '' })).toBe(SERVER)
    expect(pick({ pinnedSrc: null })).toBe(SERVER)
  })

  it('钉住地址失效后传入 null,即可自动回落到其他来源', () => {
    // 展示组件在图片 onError 后会把 pinnedSrc 置空，避免坏链把封面永久卡住
    expect(pick({ pinnedSrc: PINNED })).toBe(PINNED)
    expect(pick({ pinnedSrc: null })).toBe(SERVER)
    expect(pick({ pinnedSrc: null, serverFailed: true })).toBe(CUSTOM)
  })
})
