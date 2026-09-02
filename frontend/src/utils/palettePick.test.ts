/** stablePick（来源徽标取档，PLAN 2.1）：稳定性与档位范围 */

import { describe, expect, it } from 'vitest'
import { stablePick } from './palettePick'

describe('stablePick', () => {
  it('同一 id 毸次调用同档（稳定性）', () => {
    for (const id of ['nas', 'netease', 'qqmusic', 'srv-1', '插件源']) {
      const first = stablePick(id, 5)
      for (let i = 0; i < 5; i++) expect(stablePick(id, 5)).toBe(first)
    }
  })

  it('档位落在 0..buckets-1', () => {
    for (let i = 0; i < 200; i++) {
      const pick = stablePick(`id-${i}`, 5)
      expect(pick).toBeGreaterThanOrEqual(0)
      expect(pick).toBeLessThan(5)
    }
  })

  it('不同 id 能铺开到多个档位（不是全撞一档）', () => {
    const seen = new Set(Array.from({ length: 50 }, (_, i) => stablePick(`src-${i}`, 5)))
    expect(seen.size).toBeGreaterThanOrEqual(3)
  })
})
