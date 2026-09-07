import { describe, expect, it } from 'vitest'
import { sourceParam } from './sourceParam'

describe('sourceParam', () => {
  it('正常来源原样返回', () => {
    expect(sourceParam(new URLSearchParams('src=nas-1'))).toBe('nas-1')
  })

  it('字面量 undefined / null / 空串当成没给（v1.10.0 旧缓存拼出来的链接）', () => {
    // encodeURIComponent(undefined) === 'undefined'，这是它的来路
    for (const q of ['src=undefined', 'src=null', 'src=', 'src=%20']) {
      expect(sourceParam(new URLSearchParams(q))).toBeUndefined()
    }
    expect(sourceParam(new URLSearchParams(''))).toBeUndefined()
  })
})
