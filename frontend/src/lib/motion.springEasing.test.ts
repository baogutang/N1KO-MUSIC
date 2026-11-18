/**
 * 弹簧 → linear() 缓动（springEasing）：歌词换行的位移动画用它。
 * 曲线要从 0 单调走到 1（临界阻尼不过冲），时长就是弹簧落定的时间。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SPRING_LYRIC, springEasing } from './motion'

afterEach(() => { vi.unstubAllGlobals() })

describe('springEasing', () => {
  it('浏览器认 linear()：采样成一串从 0 到 1 的点，不回头、不过冲', () => {
    vi.stubGlobal('CSS', { supports: () => true })
    const { easing, duration } = springEasing(SPRING_LYRIC)
    const points = easing.replace(/^linear\(|\)$/g, '').split(',').map(Number)
    expect(points[0]).toBe(0)
    expect(points.at(-1)).toBe(1)
    expect(points.every((p, i) => i === 0 || p >= points[i - 1]), '单调').toBe(true)
    expect(Math.max(...points)).toBeLessThanOrEqual(1)
    expect(duration).toBeGreaterThan(550)
    expect(duration).toBeLessThan(800)
  })

  it('欠阻尼的弹簧会过冲一点，最后仍落在 1', () => {
    vi.stubGlobal('CSS', { supports: () => true })
    const points = springEasing({ stiffness: 420, damping: 26 }).easing.replace(/^linear\(|\)$/g, '').split(',').map(Number)
    expect(Math.max(...points)).toBeGreaterThan(1)
    expect(points.at(-1)).toBe(1)
  })

  it('浏览器不认 linear()：退回 ease-out 曲线，时长不变', () => {
    vi.stubGlobal('CSS', { supports: () => false })
    const { easing, duration } = springEasing(SPRING_LYRIC)
    expect(easing).toBe('cubic-bezier(0.16, 1, 0.3, 1)')
    expect(duration).toBeGreaterThan(550)
  })
})
