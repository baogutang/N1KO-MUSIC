/**
 * 沉浸样式的封面色场（coverField）：三段底色保留封面的真实明暗，文字深浅按所在那一段的底色定。
 * 对比度按 WCAG 的式子算：深色字 / 浅色字压在各自那一段上都要够得着大字的 3:1。
 */
import { describe, expect, it } from 'vitest'
import { bandStops, coverField, rgbCss } from './coverField'
import { fieldUniform } from './StageField'
import { HOUSE_LIGHTS, bandsFromPixels, type ArtBands, type ArtPalette, type ArtSwatch } from '@/services/artLight'
import { oklchToRgb } from '@/lib/oklch'

const linear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const luminance = ([r, g, b]: number[]) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
const contrast = (a: number[], b: number[]) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
const INK = { dark: oklchToRgb(0.19, 0.02, 127), light: oklchToRgb(0.97, 0.006, 127) }

const same = (top: ArtSwatch, mid: ArtSwatch, bot: ArtSwatch): ArtBands => ({ left: [top, mid, bot], right: [top, mid, bot] })
const withBands = (bands: ArtBands): ArtPalette => ({ ...HOUSE_LIGHTS, bands })

/** 上浅下深：暖黄的墙和字在上，灰蓝的路面在下（实拍封面里很常见的一种） */
const SUNLIT = withBands(same({ l: 0.72, c: 0.07, h: 91 }, { l: 0.54, c: 0.01, h: 120 }, { l: 0.5, c: 0.015, h: 212 }))
const NIGHT = withBands(same({ l: 0.3, c: 0.08, h: 265 }, { l: 0.24, c: 0.06, h: 270 }, { l: 0.18, c: 0.04, h: 280 }))
const PAPER = withBands(same({ l: 0.96, c: 0.005, h: 90 }, { l: 0.95, c: 0.005, h: 90 }, { l: 0.94, c: 0.005, h: 90 }))

describe('封面色场', () => {
  it('没有三段色（没取到像素、旧缓存）：返回 null，调用方退回原来的光场', () => {
    expect(coverField(HOUSE_LIGHTS, 'side')).toBeNull()
    expect(fieldUniform(HOUSE_LIGHTS, 'cover').tone).toBe('mid')
    expect(fieldUniform(HOUSE_LIGHTS, 'cover').flat).toBe(0)
  })

  it('上浅下深的封面：歌名歌词用深色字，底下的控制用浅色字', () => {
    const f = coverField(SUNLIT, 'side')!
    expect(f.ink).toBe('dark')
    expect(f.footInk).toBe('light')
    expect(contrast(f.bases[0], INK.dark), '歌名压在上段').toBeGreaterThanOrEqual(4.5)
    expect(contrast(f.bases[2], INK.light), '控制压在下段').toBeGreaterThanOrEqual(4.5)
  })

  it('暗的封面：全是浅色字；纸白的封面：全是深色字，而且底色不会亮到刺眼', () => {
    const night = coverField(NIGHT, 'side')!
    expect([night.ink, night.footInk]).toEqual(['light', 'light'])
    expect(contrast(night.bases[0], INK.light)).toBeGreaterThanOrEqual(7)

    const paper = coverField(PAPER, 'top')!
    expect([paper.ink, paper.footInk]).toEqual(['dark', 'dark'])
    expect(luminance(paper.bases[0]), '亮度封顶，不是一片纯白').toBeLessThan(0.62)
    expect(contrast(paper.bases[2], INK.dark)).toBeGreaterThanOrEqual(7)
  })

  it.each([0.2, 0.3, 0.4, 0.5, 0.55, 0.6, 0.65, 0.7, 0.8, 0.9])('中性灰 L=%s：选出来的字在自己那一段上至少 3:1', l => {
    const sw = { l, c: 0.01, h: 100 }
    const f = coverField(withBands(same(sw, sw, sw)), 'side')!
    expect(contrast(f.bases[0], INK[f.ink])).toBeGreaterThanOrEqual(3)
    expect(contrast(f.bases[2], INK[f.footInk])).toBeGreaterThanOrEqual(3)
  })

  it('横屏右半边的权重大（封面右缘要融进背景），竖屏左右一样重', () => {
    const left = { l: 0.3, c: 0.02, h: 30 }
    const right = { l: 0.7, c: 0.02, h: 30 }
    const p = withBands({ left: [left, left, left], right: [right, right, right] })
    const side = luminance(coverField(p, 'side')!.bases[0])
    const top = luminance(coverField(p, 'top')!.bases[0])
    expect(side).toBeGreaterThan(top)
  })

  it('喂给着色器：三段底色原样、没有游走的光、不过色调映射', () => {
    const f = coverField(SUNLIT, 'side')!
    const u = fieldUniform(SUNLIT, 'cover', 'side')
    expect(u.tone).toBe('cover')
    expect(u.flat).toBe(1)
    expect(Array.from(u.u.subarray(0, 9))).toEqual(Array.from(new Float32Array(f.bases.flat())))
    expect(Array.from(u.u.subarray(9)).every(v => v === 0), '四盏光都是 0').toBe(true)
  })

  it('暗场 / 中间档：三段底色相同，光照旧', () => {
    const u = fieldUniform(HOUSE_LIGHTS, 'deep')
    expect(Array.from(u.u.subarray(0, 3))).toEqual(Array.from(u.u.subarray(3, 6)))
    expect(Array.from(u.u.subarray(0, 3))).toEqual(Array.from(u.u.subarray(6, 9)))
    expect(u.u[9]).toBeGreaterThan(0)
    expect(u.flat).toBe(0)
  })

  it('三段颜色摆在封面框的 1/6、1/2、5/6 处；量不到封面框时用默认位置', () => {
    bandStops(0, 0.6).forEach((v, i) => expect(v).toBeCloseTo([0.1, 0.3, 0.5][i], 6))
    const fallback = bandStops(0, 0)
    expect(fallback[0]).toBeLessThan(fallback[1])
    expect(fallback[1]).toBeLessThan(fallback[2])
  })

  it('rgbCss：0–1 的三个数 → rgb()', () => {
    expect(rgbCss([1, 0.5, 0])).toBe('rgb(255 128 0)')
    expect(rgbCss(new Float32Array([0, 0, 0]))).toBe('rgb(0 0 0)')
  })
})

describe('从像素取三段色（bandsFromPixels）', () => {
  /** size×size：上三分之一红、中间绿、下面蓝；右半边整体更亮 */
  function stripes(size: number) {
    const data = new Uint8ClampedArray(size * size * 4)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const band = Math.min(2, Math.floor((y * 3) / size))
        const v = x < size / 2 ? 120 : 220
        const i = (y * size + x) * 4
        data[i + band] = v
        data[i + 3] = 255
      }
    }
    return data
  }

  it('上中下各是各的色相，左右分开存', () => {
    const b = bandsFromPixels(stripes(12), 12)!
    const hue = (sw: ArtSwatch) => Math.round(sw.h)
    expect(hue(b.left[0])).toBe(hue(b.right[0]))
    expect(new Set([hue(b.left[0]), hue(b.left[1]), hue(b.left[2])]).size, '三段色相各不相同').toBe(3)
    expect(b.right[0].l).toBeGreaterThan(b.left[0].l)
  })

  it('像素不够、或整段透明：不出三段色', () => {
    expect(bandsFromPixels(new Uint8ClampedArray(16), 12)).toBeUndefined()
    expect(bandsFromPixels(new Uint8ClampedArray(12 * 12 * 4), 12)).toBeUndefined()
  })
})
