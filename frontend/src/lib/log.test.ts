/** 阶段 4.10：日志环 */
import { describe, expect, it, beforeEach } from 'vitest'
import { log, exportLogRing, resetLogRingForTests } from '@/lib/log'

beforeEach(resetLogRingForTests)

describe('log 环形缓冲（4.10）', () => {
  it('进环、带级别与时间', () => {
    log.warn('test', '一条警告')
    log.debug('test', '调试')
    const ring = exportLogRing()
    expect(ring).toHaveLength(2)
    expect(ring[0].level).toBe('warn')
    expect(ring[0].tag).toBe('test')
    expect(ring[0].time).toBeGreaterThan(0)
  })

  it('上限 200 条，旧的先出', () => {
    for (let i = 0; i < 210; i++) log.debug('flood', i)
    const ring = exportLogRing()
    expect(ring).toHaveLength(200)
    expect(ring[0].args[0]).toBe(10) // 前 10 条被顶掉
  })
})
