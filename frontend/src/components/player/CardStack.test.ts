import { describe, expect, it } from 'vitest'
import { cardPose, flingTarget, springOmega, stackGeometry } from './CardStack'

const slope = (u: number) => (cardPose(u + 1e-4).x - cardPose(u - 1e-4).x) / 2e-4

describe('cardPose：一叠卡的排法', () => {
  it('位置随离焦点的距离单调增加：左边散开、右边叠起来', () => {
    let prev = -Infinity
    for (let u = -3; u <= 10; u += 0.05) {
      const { x } = cardPose(u)
      expect(x).toBeGreaterThan(prev)
      prev = x
    }
  })

  it('经过焦点时不跳：位置和斜率在接缝处都连续', () => {
    expect(cardPose(-1e-6).x).toBeCloseTo(cardPose(1e-6).x, 4)
    // 斜率也连续：拖着经过焦点时速度不突变
    expect(slope(-1e-3)).toBeCloseTo(slope(1e-3), 1)
  })

  it('跟手：左边那侧匀速，间距就是拖一张的距离', () => {
    const g = stackGeometry(1376, 720)
    for (const u of [-0.2, -0.7, -1.5, -2.5]) expect(slope(u) * g.size).toBeCloseTo(g.unit, 6)
  })

  it('焦点那张完整露出：前一张停在它左边缘之外', () => {
    expect(cardPose(0)).toEqual({ x: 0, scale: 1, dim: 0 })
    expect(cardPose(-1).x + 1).toBeLessThanOrEqual(0)
  })

  it('右边越往后露得越少、越小越暗，最后叠在一起不出界', () => {
    const strips = [1, 2, 3, 4, 5].map(u => cardPose(u).x - cardPose(u - 1).x)
    expect(strips[0]).toBeGreaterThan(0.4)
    for (let i = 1; i < strips.length; i++) expect(strips[i]).toBeLessThan(strips[i - 1])
    expect(cardPose(50).x).toBeLessThan(0.91)
    expect(cardPose(2).scale).toBeLessThan(cardPose(1).scale)
    expect(cardPose(2).dim).toBeGreaterThan(cardPose(1).dim)
  })
})

describe('flingTarget：松手后落在哪一张', () => {
  it('几乎没速度：就近吸附', () => {
    expect(flingTarget(3.4, 0.1, 20)).toBe(3)
    expect(flingTarget(3.6, -0.1, 20)).toBe(4)
  })

  it('轻轻一扫也至少翻一张，不会又吸回原处', () => {
    expect(flingTarget(3, 0.5, 20)).toBe(4)
    expect(flingTarget(3, -0.5, 20)).toBe(2)
    // 往回拉了一点点再往前扫：还是去下一张
    expect(flingTarget(2.97, 0.5, 20)).toBe(4)
    // 已经快到下一张了：就停在那一张，不多翻
    expect(flingTarget(3.6, 0.5, 20)).toBe(4)
  })

  it('甩得越狠飞得越远', () => {
    const soft = flingTarget(3, 4, 40)
    const hard = flingTarget(3, 16, 40)
    expect(soft).toBeGreaterThan(4)
    expect(hard).toBeGreaterThan(soft)
  })

  it('夹在两头之间', () => {
    expect(flingTarget(2, -40, 10)).toBe(0)
    expect(flingTarget(8, 40, 10)).toBe(9)
    expect(flingTarget(0, -2, 10)).toBe(0)
  })
})

describe('springOmega：吸附的弹簧', () => {
  /** 临界阻尼弹簧的解析解：从 0 出发、带初速度 v，滑到 d；返回位置和速度 */
  function track(d: number, v: number) {
    const omega = springOmega(d, v)
    const A = -d
    const B = v + omega * A
    const xs: number[] = []
    const vs: number[] = []
    for (let t = 0; t <= 3; t += 1 / 120) {
      const e = Math.exp(-omega * t)
      xs.push(d + (A + B * t) * e)
      vs.push((B - omega * (A + B * t)) * e)
    }
    return { xs, vs }
  }

  it('顺着速度滑过去时不冲过头（甩到哪就停在哪）', () => {
    for (const [d, v] of [[1, 3], [4, 10], [8, 16], [2, 1]] as const) {
      const { xs } = track(d, v)
      expect(Math.max(...xs)).toBeLessThanOrEqual(d + 1e-6)
      expect(xs[xs.length - 1]).toBeCloseTo(d, 2)
    }
  })

  it('甩远了：松手后不会比手指还快地往前窜', () => {
    for (const v of [6, 12, 20]) {
      const d = Math.round(v * 0.5)
      const { vs } = track(d, v)
      expect(Math.max(...vs)).toBeLessThanOrEqual(v * 1.08)
    }
  })

  it('慢慢松手用硬一点的弹簧；往回甩用最硬的', () => {
    expect(springOmega(1, 0)).toBe(11)
    expect(springOmega(1, -5)).toBe(13)
  })
})

describe('stackGeometry', () => {
  it('iPad 横屏：大卡片，焦点略偏左，右边那一叠和左边那张都在屏幕里', () => {
    for (const [w, h] of [[1376, 720], [1194, 560], [1024, 600]]) {
      const g = stackGeometry(w, h)
      expect(g.left + g.size / 2).toBeLessThan(w / 2)
      // 叠最深处那张的右边缘（以右边缘为原点缩放，右边缘就在 left + size × (x + 1)）
      expect(g.left + g.size * (cardPose(8).x + 1)).toBeLessThan(w)
      // 前一张露出来的一截
      expect(g.left + g.size * (cardPose(-1).x + 1)).toBeGreaterThan(g.size * 0.2)
    }
    expect(stackGeometry(1376, 720).size).toBeGreaterThan(500)
  })

  it('再小也不小于 140', () => {
    expect(stackGeometry(300, 100).size).toBe(140)
  })
})
