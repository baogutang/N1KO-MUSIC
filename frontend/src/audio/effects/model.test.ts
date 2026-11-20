import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FX,
  FX_BAND_COUNT,
  FX_PRESETS,
  FX_PRESET_IDS,
  deriveFx,
  isNeutralFx,
  normalizeFx,
  widthMatrix,
  dbToGain,
  type FxSettings,
} from './model'

const on = (over: Partial<FxSettings> = {}): FxSettings => ({ ...DEFAULT_FX, enabled: true, ...over })

describe('音效预设', () => {
  it('每个预设都是完整的一套：十段齐全、各档位在范围内', () => {
    for (const id of FX_PRESET_IDS) {
      const preset = FX_PRESETS[id]
      expect(preset.bands, id).toHaveLength(FX_BAND_COUNT)
      expect(normalizeFx({ ...preset, enabled: true, preset: id }), id).toEqual({ ...preset, enabled: true, preset: id })
    }
  })

  it('「原声」就是什么都不动', () => {
    expect(isNeutralFx(FX_PRESETS.flat)).toBe(true)
    expect(isNeutralFx(FX_PRESETS.pop)).toBe(false)
  })
})

describe('normalizeFx：存档比类型活得久', () => {
  it('缺字段、空存档都给出能直接用的默认值', () => {
    expect(normalizeFx(undefined)).toEqual({ ...DEFAULT_FX, preset: 'custom' })
    expect(normalizeFx({ enabled: true }).bands).toHaveLength(FX_BAND_COUNT)
  })

  it('段数对不上的旧数组：补齐或截断，不留 undefined', () => {
    expect(normalizeFx({ bands: [3, 2] }).bands).toEqual([3, 2, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(normalizeFx({ bands: new Array(14).fill(1) }).bands).toHaveLength(FX_BAND_COUNT)
  })

  it('越界、不是数字的值收回范围内', () => {
    const fx = normalizeFx({
      bands: [99, -99, Number.NaN, 'x' as unknown as number],
      bass: 40,
      clarity: -3,
      width: Number.POSITIVE_INFINITY,
      loudness: undefined,
    })
    expect(fx.bands.slice(0, 4)).toEqual([12, -12, 0, 0])
    expect([fx.bass, fx.clarity, fx.width, fx.loudness]).toEqual([10, 0, 0, 0])
  })

  it('不认识的预设名记成自定义；enabled 只认真的 true', () => {
    expect(normalizeFx({ preset: 'cinema' as never }).preset).toBe('custom')
    expect(normalizeFx({ enabled: 'yes' as never }).enabled).toBe(false)
  })
})

describe('deriveFx：档位换算成处理链参数', () => {
  it('没开、或者开着但全是零：整条链直通，压缩和限幅都不接', () => {
    for (const settings of [DEFAULT_FX, on(), { ...on(FX_PRESETS.rock), enabled: false }]) {
      const derived = deriveFx(settings)
      expect(derived.bypass).toBe(true)
      expect(derived.preGainDb).toBe(0)
      expect(derived.width).toBe(1)
      expect(derived.compressor).toBeNull()
      expect(derived.bandDb.every(db => db === 0)).toBe(true)
    }
  })

  it('往上推了就先让出余量，但不全让（不然开了音效反而变小声）', () => {
    const derived = deriveFx(on({ bands: [0, 0, 6, 0, 0, 0, 0, 0, 0, 0] }))
    expect(derived.bypass).toBe(false)
    expect(derived.preGainDb).toBeLessThan(0)
    expect(derived.preGainDb).toBeGreaterThan(-6)
  })

  it('只往下拉不需要余量', () => {
    expect(deriveFx(on({ bands: [-6, -3, 0, 0, 0, 0, 0, 0, 0, 0] })).preGainDb).toBe(0)
  })

  it('余量封顶 9dB，剩下的交给限幅器', () => {
    const derived = deriveFx(on({ bands: new Array(FX_BAND_COUNT).fill(12), bass: 10, clarity: 10 }))
    expect(derived.preGainDb).toBe(-9)
  })

  it('低音满档 +9dB、清晰度满档 +6dB、声场满档 1.8 倍', () => {
    const derived = deriveFx(on({ bass: 10, clarity: 10, width: 10 }))
    expect(derived.bassDb).toBeCloseTo(9)
    expect(derived.clarityDb).toBeCloseTo(6)
    expect(derived.width).toBeCloseTo(1.8)
  })

  it('响度为 0 不接压缩器；越大门限越低、压得越多', () => {
    expect(deriveFx(on({ bass: 1 })).compressor).toBeNull()
    const soft = deriveFx(on({ loudness: 2 })).compressor!
    const hard = deriveFx(on({ loudness: 10 })).compressor!
    expect(hard.thresholdDb).toBeLessThan(soft.thresholdDb)
    expect(hard.ratio).toBeGreaterThan(soft.ratio)
    expect(hard.thresholdDb).toBeCloseTo(-24)
    expect(hard.ratio).toBeCloseTo(4)
  })
})

describe('声场矩阵', () => {
  it('倍数为 1 就是原样', () => {
    expect(widthMatrix(1)).toEqual({ direct: 1, cross: 0 })
  })

  it('左右一样的内容（居中的人声）不受影响；只有左右之差被放大', () => {
    const { direct, cross } = widthMatrix(1.8)
    // L = R = 1：出来还是 1
    expect(direct + cross).toBeCloseTo(1)
    // L = 1、R = -1（纯侧声道）：放大 1.8 倍
    expect(direct - cross).toBeCloseTo(1.8)
  })
})

describe('dbToGain', () => {
  it('0dB 是 1 倍，-6dB 约一半', () => {
    expect(dbToGain(0)).toBe(1)
    expect(dbToGain(-6)).toBeCloseTo(0.501, 3)
  })
})
