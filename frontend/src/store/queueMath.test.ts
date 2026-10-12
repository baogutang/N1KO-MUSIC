/** 阶段 5：队列数学纯函数（从 playerStore 抽出，行为不变） */
import { describe, expect, it } from 'vitest'
import { generateShuffledIndexes, resolveShuffleCursor, appendHistory } from '@/store/queueMath'
import type { Song } from '@/api/types'

describe('generateShuffledIndexes（5）', () => {
  it('是 [0, length) 的排列；当前曲锚定在首位', () => {
    for (let trial = 0; trial < 20; trial++) {
      const order = generateShuffledIndexes(8, 3)
      expect(order).toHaveLength(8)
      expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
      expect(order[0]).toBe(3)
    }
  })
  it('无锚定（-1）时不固定任何位置，仍是排列', () => {
    const order = generateShuffledIndexes(5, -1)
    expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4])
  })
  it('空序列 / 越界锚定安全', () => {
    expect(generateShuffledIndexes(0, 0)).toEqual([])
    const order = generateShuffledIndexes(3, 99)
    expect(order[0]).toBe(2) // 钳到 length-1
  })
})

describe('resolveShuffleCursor（5）', () => {
  it('游标权威时直接返回；不一致时按下标反查', () => {
    const order = [2, 0, 3, 1]
    expect(resolveShuffleCursor(order, 2, 0)).toBe(0)
    expect(resolveShuffleCursor(order, 1, 0)).toBe(3) // 反查
    expect(resolveShuffleCursor(order, 99, 0)).toBe(-1) // 不在序列里
  })
})

describe('appendHistory（5）', () => {
  const song = (id: string) => ({ id, title: 'T', artist: 'A', duration: 100 }) as Song
  it('null 安全；新的在前', () => {
    expect(appendHistory([], null)).toEqual([])
    const h = appendHistory([song('a')], song('b'))
    expect(h.map(s => s.id)).toEqual(['b', 'a'])
  })
})
