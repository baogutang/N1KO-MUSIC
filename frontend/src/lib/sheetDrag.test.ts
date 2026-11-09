import { describe, expect, it } from 'vitest'
import { sheetDragOffset, shouldDismissSheet } from './sheetDrag'

describe('底部弹层下拉收起的判定', () => {
  it('往下拖 1:1 跟手，往上拖不动', () => {
    expect(sheetDragOffset(80)).toBe(80)
    expect(sheetDragOffset(0)).toBe(0)
    expect(sheetDragOffset(-60)).toBe(0)
  })

  it('慢慢拖：过 120px 才收起，不够就弹回', () => {
    expect(shouldDismissSheet(119, 2000)).toBe(false)
    expect(shouldDismissSheet(121, 2000)).toBe(true)
  })

  it('甩得够快：拖了 40px 但速度很高也收起', () => {
    expect(shouldDismissSheet(40, 30)).toBe(true) // 约 1333px/s
  })

  it('速度够快但几乎没动（手一抖）不收起', () => {
    expect(shouldDismissSheet(10, 5)).toBe(false) // 2000px/s，但只动了 10px
  })

  it('往上甩 / 没动都不收起', () => {
    expect(shouldDismissSheet(-200, 100)).toBe(false)
    expect(shouldDismissSheet(0, 100)).toBe(false)
  })

  it('耗时为 0 不会除零', () => {
    expect(shouldDismissSheet(50, 0)).toBe(true)
  })
})
