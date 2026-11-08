import { describe, expect, it } from 'vitest'
import { clampAppName, resolveAppName, splashHoldMs } from '@/lib/appName'

describe('软件名称', () => {
  it('留空或只有空格时用默认名', () => {
    expect(resolveAppName('')).toBe('X-MUSIC')
    expect(resolveAppName('   ')).toBe('X-MUSIC')
    expect(resolveAppName(undefined)).toBe('X-MUSIC')
  })

  it('去掉首尾空格，中间的空格留下来', () => {
    expect(resolveAppName('  我的 音乐  ')).toBe('我的 音乐')
  })

  it('超过 24 个字就截断', () => {
    expect(resolveAppName('音'.repeat(30))).toBe('音'.repeat(24))
    expect(clampAppName('音'.repeat(30))).toBe('音'.repeat(24))
  })

  it('字越多，开屏多留一点时间给最后一个字', () => {
    expect(splashHoldMs(7, false)).toBe(2050)
    expect(splashHoldMs(20, false)).toBeGreaterThan(2050)
    expect(splashHoldMs(20, true)).toBe(320)
  })
})
