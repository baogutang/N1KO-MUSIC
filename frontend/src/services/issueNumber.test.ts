import { describe, expect, it } from 'vitest'
import { isoWeek, issueNumber, FOUNDING_YEAR } from './issueNumber'

describe('isoWeek', () => {
  it('包含当年第一个星期四的那一周是第 1 周', () => {
    // 2026-01-01 是星期四，所以它自己就在第 1 周
    expect(isoWeek(new Date(2026, 0, 1))).toEqual({ year: 2026, week: 1 })
  })

  it('年末几天可能属于下一年的第 1 周', () => {
    // 2024-12-30 是星期一，那一周的星期四落在 2025-01-02
    expect(isoWeek(new Date(2024, 11, 30))).toEqual({ year: 2025, week: 1 })
  })

  it('年初几天可能属于上一年的最后一周', () => {
    // 2022-01-01 是星期六，归属 2021 年第 52 周
    expect(isoWeek(new Date(2022, 0, 1))).toEqual({ year: 2021, week: 52 })
  })

  it('长年份有第 53 周', () => {
    expect(isoWeek(new Date(2020, 11, 31))).toEqual({ year: 2020, week: 53 })
  })

  it('同一周里的每一天算出来都是同一期', () => {
    const weeks = [15, 16, 17, 18, 19, 20, 21].map(
      day => isoWeek(new Date(2026, 5, day)).week
    )
    expect(new Set(weeks).size).toBe(1)
  })
})

describe('issueNumber', () => {
  it('创刊那年是第 1 卷，不是第 0 卷', () => {
    expect(issueNumber(new Date(FOUNDING_YEAR, 5, 1).getTime()).volume).toBe(1)
  })

  it('每过一年卷号加一', () => {
    const a = issueNumber(new Date(FOUNDING_YEAR + 2, 5, 1).getTime())
    expect(a.volume).toBe(3)
  })

  it('创刊之前不会出现零或负数卷号', () => {
    expect(issueNumber(new Date(FOUNDING_YEAR - 5, 5, 1).getTime()).volume).toBe(1)
  })

  it('期号补零，读起来是刊号而不是普通数字', () => {
    expect(issueNumber(new Date(2026, 0, 1).getTime()).label).toBe('VOL.3 NO.01')
  })

  it('同一天多次调用结果稳定', () => {
    const at = new Date(2026, 7, 21, 3, 0, 0).getTime()
    const later = new Date(2026, 7, 21, 23, 30, 0).getTime()
    expect(issueNumber(at).label).toBe(issueNumber(later).label)
  })
})
