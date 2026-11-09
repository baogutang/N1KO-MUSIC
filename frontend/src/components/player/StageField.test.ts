/**
 * 光场的两档亮度（paletteToUniform）：中间档（沉浸样式）要比暗场亮，但白字压在底色上仍有 7:1。
 * 着色器最后做一次色调映射 col / (1 + 0.4 col)，这里按同样的式子算出屏幕上的颜色。
 */
import { describe, expect, it } from 'vitest'
import { paletteToUniform } from './StageField'
import { HOUSE_LIGHTS, type ArtPalette } from '@/services/artLight'

const tonemap = (v: number) => v / (1 + v * 0.4)
const linear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const luminance = ([r, g, b]: number[]) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
const contrastWithWhite = (rgb: number[]) => 1.05 / (luminance(rgb) + 0.05)

const base = (u: Float32Array) => Array.from(u.slice(0, 3)).map(tonemap)
/** 底色加第一盏光（光心处）：画面上最亮的地方 */
const brightest = (u: Float32Array) => [0, 1, 2].map(i => tonemap(u[i] + u[3 + i]))

const palettes: Array<[string, ArtPalette]> = [
  ['场灯青柠', HOUSE_LIGHTS],
  ['暖橘', { h: 45, c: 0.16, l: 0.62, h2: 80, c2: 0.1, swatches: [{ l: 0.62, c: 0.16, h: 45 }, { l: 0.5, c: 0.1, h: 80 }], neutral: false }],
  ['浅紫', { h: 300, c: 0.08, l: 0.7, h2: 150, c2: 0.04, swatches: [{ l: 0.7, c: 0.08, h: 300 }], neutral: false }],
  ['黑白', { h: 0, c: 0.005, l: 0.5, h2: 0, c2: 0.005, swatches: [{ l: 0.9, c: 0, h: 0 }, { l: 0.2, c: 0, h: 0 }], neutral: true }],
]

describe('光场亮度档', () => {
  it.each(palettes)('%s：中间档比暗场亮，底色上白字仍有 7:1', (_, palette) => {
    const deep = paletteToUniform(palette, 'deep')
    const mid = paletteToUniform(palette, 'mid')
    expect(luminance(base(mid))).toBeGreaterThan(luminance(base(deep)))
    expect(luminance(brightest(mid))).toBeGreaterThan(luminance(brightest(deep)))
    expect(contrastWithWhite(base(mid))).toBeGreaterThanOrEqual(7)
  })

  it('不传档位就是原来的暗场', () => {
    expect(Array.from(paletteToUniform(HOUSE_LIGHTS))).toEqual(Array.from(paletteToUniform(HOUSE_LIGHTS, 'deep')))
  })
})
