import { describe, expect, it } from 'vitest'
import { parseColor, rgbToHsl, hslToRgb, toPaperSafe } from './paperSafe'

describe('parseColor', () => {
  it('认 #rrggbb 和 #rgb', () => {
    expect(parseColor('#ff8800')).toEqual({ r: 255, g: 136, b: 0 })
    expect(parseColor('#f80')).toEqual({ r: 255, g: 136, b: 0 })
  })

  it('认 rgb() 和 rgba()', () => {
    expect(parseColor('rgb(12, 34, 56)')).toEqual({ r: 12, g: 34, b: 56 })
    expect(parseColor('rgba(12, 34, 56, 0.5)')).toEqual({ r: 12, g: 34, b: 56 })
  })

  it('认不出来返回 null，不猜', () => {
    expect(parseColor('rebeccapurple')).toBeNull()
    expect(parseColor('')).toBeNull()
    expect(parseColor('#ggg')).toBeNull()
  })
})

describe('hsl 往返', () => {
  it('转过去再转回来仍是同一个颜色（允许 1/255 的取整误差）', () => {
    for (const input of ['#b8442a', '#1d1a15', '#f4efe3', '#00ff00', '#808080']) {
      const rgb = parseColor(input)!
      const { h, s, l } = rgbToHsl(rgb)
      const back = hslToRgb(h, s, l)
      expect(Math.abs(back.r - rgb.r)).toBeLessThanOrEqual(1)
      expect(Math.abs(back.g - rgb.g)).toBeLessThanOrEqual(1)
      expect(Math.abs(back.b - rgb.b)).toBeLessThanOrEqual(1)
    }
  })

  it('灰色的饱和度是 0', () => {
    expect(rgbToHsl({ r: 128, g: 128, b: 128 }).s).toBe(0)
  })
})

describe('toPaperSafe', () => {
  /** 亮色模式下的安全带 */
  const LIGHT = { maxS: 0.28, minL: 0.72, maxL: 0.88 }

  it('荧光色被夹进纸面安全带，不会把版面染成色块', () => {
    const safe = rgbToHsl(parseColor(toPaperSafe('#ff00ff', false))!)
    expect(safe.s).toBeLessThanOrEqual(LIGHT.maxS + 0.01)
    expect(safe.l).toBeGreaterThanOrEqual(LIGHT.minL - 0.01)
    expect(safe.l).toBeLessThanOrEqual(LIGHT.maxL + 0.01)
  })

  it('纯黑封面不会把纸压成灰', () => {
    const safe = rgbToHsl(parseColor(toPaperSafe('#000000', false))!)
    expect(safe.l).toBeGreaterThanOrEqual(LIGHT.minL - 0.01)
  })

  it('纯白封面也不会亮过安全带上限', () => {
    const safe = rgbToHsl(parseColor(toPaperSafe('#ffffff', false))!)
    expect(safe.l).toBeLessThanOrEqual(LIGHT.maxL + 0.01)
  })

  it('保留色相——那是封面唯一值得留下的信息', () => {
    const source = rgbToHsl(parseColor('#2244ff')!)
    const safe = rgbToHsl(parseColor(toPaperSafe('#2244ff', false))!)
    expect(Math.abs(safe.h - source.h)).toBeLessThan(0.02)
  })

  it('本来就淡的封面不会被强行提亮成一种它没有的情绪', () => {
    // s = 0.1，低于上限，应当原样保留
    const pale = hslToRgb(0.6, 0.1, 0.8)
    const input = `rgb(${pale.r}, ${pale.g}, ${pale.b})`
    expect(rgbToHsl(parseColor(toPaperSafe(input, false))!).s).toBeCloseTo(0.1, 1)
  })

  it('暗色模式压向墨色而不是发光', () => {
    const safe = rgbToHsl(parseColor(toPaperSafe('#ffff00', true))!)
    expect(safe.l).toBeLessThanOrEqual(0.35)
    expect(safe.l).toBeGreaterThanOrEqual(0.17)
  })

  it('解析不了的输入原样返回——宁可不加氛围光，也不涂一层假色', () => {
    expect(toPaperSafe('somehow-invalid', false)).toBe('somehow-invalid')
  })
})
