import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 全局 setup 会预加载 en-US；这里要测「还没加载」的路径，
 * 所以每个用例 resetModules 后重新 import，拿到一份全新的、只有 zh-CN 的模块。
 */
async function freshI18n() {
  vi.resetModules()
  return await import('./index')
}

beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
})
afterEach(() => {
  vi.doUnmock('./locales/en-US.json')
  vi.unstubAllGlobals()
})

describe('en-US 按需加载', () => {
  it('未加载时 setLocale 先加载、再切换并通知订阅者', async () => {
    const i18n = await freshI18n()
    await i18n.setLocale('zh-CN')
    expect(i18n.missingKeys('en-US').length).toBeGreaterThan(0) // 确认此刻没加载
    const p = i18n.setLocale('en-US')
    expect(i18n.getLocale()).toBe('zh-CN') // 加载完之前不变
    await p
    expect(i18n.getLocale()).toBe('en-US')
    expect(i18n.missingKeys('en-US')).toEqual([])
    expect(i18n.t('nav.home')).not.toBe('首页')
  })

  it('加载失败时保持中文，t 仍可用', async () => {
    vi.doMock('./locales/en-US.json', () => { throw new Error('chunk load failed') })
    const i18n = await freshI18n()
    await i18n.setLocale('zh-CN')
    await i18n.setLocale('en-US')
    expect(i18n.getLocale()).toBe('zh-CN')
    expect(i18n.t('nav.home')).toBe('首页')
  })

  it('whenLocaleReady：检测到英文且加载失败时回落中文，不抛错', async () => {
    vi.stubGlobal('localStorage', { getItem: () => 'en-US', setItem: () => {}, removeItem: () => {} })
    vi.doMock('./locales/en-US.json', () => { throw new Error('offline') })
    const i18n = await freshI18n()
    expect(i18n.getLocale()).toBe('en-US')
    await expect(i18n.whenLocaleReady()).resolves.toBeUndefined()
    expect(i18n.getLocale()).toBe('zh-CN')
  })

  it('whenLocaleReady：检测到英文且加载成功后，首次取词就是英文', async () => {
    vi.stubGlobal('localStorage', { getItem: () => 'en-US', setItem: () => {}, removeItem: () => {} })
    const i18n = await freshI18n()
    await i18n.whenLocaleReady()
    expect(i18n.getLocale()).toBe('en-US')
    expect(i18n.t('nav.home')).not.toBe('首页')
  })

  it('连续切换：以最后一次为准', async () => {
    const i18n = await freshI18n()
    await i18n.setLocale('zh-CN')
    const a = i18n.setLocale('en-US')
    const b = i18n.setLocale('zh-CN')
    await Promise.all([a, b])
    expect(i18n.getLocale()).toBe('zh-CN')
  })
})
