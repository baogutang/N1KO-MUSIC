import { describe, expect, it } from 'vitest'
import { cardPose, flingTarget, springOmega, stackGeometry } from './CardStack'

describe('cardPose：一叠卡的排法', () => {
  it('位置随离焦点的距离单调增加：左边叠起来、右边散开', () => {
    let prev = -Infinity
    for (let u = -8; u <= 3; u += 0.05) {
      const { x } = cardPose(u)
      expect(x).toBeGreaterThan(prev)
      prev = x
    }
  })

  it('经过焦点和右边第一张时不跳：两段在接缝处连续', () => {
    for (const at of [0, 1]) {
      expect(cardPose(at - 1e-6).x).toBeCloseTo(cardPose(at + 1e-6).x, 4)
      // 斜率也连续：拖着经过接缝时速度不突变
      const slope = (u: number) => (cardPose(u + 1e-4).x - cardPose(u - 1e-4).x) / 2e-4
      expect(slope(at - 1e-3)).toBeCloseTo(slope(at + 1e-3), 1)
    }
  })

  it('焦点那张完整露出：右边那张从它右边缘之外开始', () => {
    expect(cardPose(0).x).toBe(0)
    expect(cardPose(1).x).toBeGreaterThanOrEqual(1)
  })

  it('左边越远露得越少、越小越暗，最后叠在一起不出界', () => {
    const strips = [-1, -2, -3, -4].map(u => cardPose(u + 1).x - cardPose(u).x)
    for (let i = 1; i < strips.length; i++) expect(strips[i]).toBeLessThan(strips[i - 1])
    expect(cardPose(-50).x).toBeGreaterThan(-0.86)
    expect(cardPose(-2).scale).toBeLessThan(cardPose(-1).scale)
    expect(cardPose(-2).dim).toBeGreaterThan(cardPose(-1).dim)
    expect(cardPose(0)).toEqual({ x: 0, scale: 1, dim: 0 })
  })
})

describe('flingTarget：松手后落在哪一张', () => {
  it('几乎没速度：就近吸附', () => {
    expect(flingTarget(3.4, 0.1, 20)).toBe(3)
    expect(flingTarget(3.6, -0.1, 20)).toBe(4)
  })

  it('甩得越狠飞得越远', () => {
    const soft = flingTarget(3, 4, 40)
    const hard = flingTarget(3, 16, 40)
    expect(soft).toBeGreaterThan(3)
    expect(hard).toBeGreaterThan(soft)
  })

  it('夹在两头之间', () => {
    expect(flingTarget(2, -40, 10)).toBe(0)
    expect(flingTarget(8, 40, 10)).toBe(9)
  })
})

describe('springOmega：吸附的弹簧', () => {
  /** 临界阻尼弹簧的解析解：从 0 出发、带初速度 v，滑到 d */
  function track(d: number, v: number) {
    const omega = springOmega(d, v)
    const A = -d
    const B = v + omega * A
    const xs: number[] = []
    for (let t = 0; t <= 3; t += 1 / 120) xs.push(d + (A + B * t) * Math.exp(-omega * t))
    return xs
  }

  it('顺着速度滑过去时不冲过头（甩到哪就停在哪）', () => {
    for (const [d, v] of [[1, 3], [4, 10], [8, 16], [2, 1]] as const) {
      const xs = track(d, v)
      expect(Math.max(...xs)).toBeLessThanOrEqual(d + 1e-6)
      expect(xs[xs.length - 1]).toBeCloseTo(d, 2)
    }
  })

  it('慢慢松手用硬一点的弹簧；往回甩用最硬的', () => {
    expect(springOmega(1, 0)).toBe(11)
    expect(springOmega(1, -5)).toBe(13)
  })
})

describe('stackGeometry', () => {
  it('iPad 横屏：大卡片，焦点略偏右', () => {
    const g = stackGeometry(1376, 720)
    expect(g.size).toBeGreaterThan(500)
    expect(g.left + g.size / 2).toBeGreaterThan(1376 / 2)
  })

  it('再小也不小于 140', () => {
    expect(stackGeometry(300, 100).size).toBe(140)
  })
})
