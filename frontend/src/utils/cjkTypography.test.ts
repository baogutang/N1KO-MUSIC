import { describe, expect, it } from 'vitest'
import { spaceCJK } from '@/utils/cjkTypography'

describe('spaceCJK', () => {
  it('在中西文边界插入细空格', () => {
    expect(spaceCJK('周杰伦Jay')).toBe('周杰伦 Jay')
    expect(spaceCJK('Hello世界')).toBe('Hello 世界')
    expect(spaceCJK('第3首')).toBe('第 3 首')
  })

  it('纯西文与纯中文原样返回', () => {
    expect(spaceCJK('Bohemian Rhapsody')).toBe('Bohemian Rhapsody')
    expect(spaceCJK('青花瓷')).toBe('青花瓷')
  })

  it('已有空白处不重复插入', () => {
    expect(spaceCJK('周杰伦 Jay')).toBe('周杰伦 Jay')
  })

  it('幂等：重复调用不会叠加空格', () => {
    const once = spaceCJK('周杰伦Jay')
    expect(spaceCJK(once)).toBe(once)
  })

  it('空值安全', () => {
    expect(spaceCJK('')).toBe('')
  })

  it('标点不会被当成西文', () => {
    expect(spaceCJK('《范特西》')).toBe('《范特西》')
    expect(spaceCJK('你好，世界')).toBe('你好，世界')
  })

  it('日文与假名同样处理', () => {
    expect(spaceCJK('宇多田ヒカルFirst Love')).toBe('宇多田ヒカル First Love')
  })
})
