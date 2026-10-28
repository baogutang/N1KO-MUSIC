import { afterEach, describe, expect, it, vi } from 'vitest'
import { getPauseRecords, notePauseReason, recordPause, resetPauseTrailForTests, type PauseContext } from './playbackTrail'

const ctx: PauseContext = {
  elementPaused: true, readyState: 4, networkState: 1, errorCode: 0,
  currentTime: 42, bufferedAhead: 30, duration: 200, visibility: 'visible', online: true,
}

afterEach(() => {
  vi.useRealTimers()
  resetPauseTrailForTests()
})

describe('播放诊断', () => {
  it('快照在没有新记录时是同一个引用（useSyncExternalStore 要求，否则无限重渲染）', () => {
    const a = getPauseRecords()
    expect(getPauseRecords()).toBe(a)
    recordPause(ctx)
    const b = getPauseRecords()
    expect(b).not.toBe(a)
    expect(getPauseRecords()).toBe(b)
  })

  it('两秒内留下的原因记到这一次暂停上，用过就清掉', () => {
    notePauseReason('remote', 'pause')
    recordPause(ctx)
    recordPause(ctx)
    const [first, second] = getPauseRecords()
    expect(first.reason).toBe('remote')
    expect(first.detail).toBe('pause')
    expect(second.reason).toBe('unknown')
  })

  it('太久以前留的原因不算数', () => {
    vi.useFakeTimers()
    notePauseReason('ui')
    vi.advanceTimersByTime(2500)
    recordPause(ctx)
    expect(getPauseRecords().at(-1)?.reason).toBe('unknown')
  })

  it('只留最近 30 条', () => {
    for (let i = 0; i < 40; i++) recordPause(ctx)
    expect(getPauseRecords()).toHaveLength(30)
  })
})
