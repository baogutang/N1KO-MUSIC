import { describe, expect, it } from 'vitest'
import { buildRediscovery } from './rediscovery'
import type { ListeningEvent } from '@/services/listeningHistory'
import type { Song } from '@/api/types'

const DAY = 86_400_000
/** 用本地时间构造，否则「年中第几天」的断言会随运行机器的时区漂移 */
const NOW = new Date(2026, 7, 21, 12, 0, 0, 0).getTime()

function song(id: string): Song {
  return {
    id,
    serverId: 'srv',
    title: `Song ${id}`,
    artist: 'Artist',
    album: 'Album',
    duration: 200,
  } as Song
}

/** listenedSeconds 默认给满，确保通过 scrobble 阈值 */
function event(id: string, endedAt: number, listenedSeconds = 190): ListeningEvent {
  return {
    version: 2,
    eventId: `${id}-${endedAt}`,
    serverId: 'srv',
    song: song(id),
    startedAt: endedAt - listenedSeconds * 1000,
    endedAt,
    listenedSeconds,
    completionRate: listenedSeconds / 200,
    outcome: 'completed',
  }
}

describe('去年今日', () => {
  it('认出往年同一天听过的曲子', () => {
    const lastYear = new Date(2025, 7, 21, 20, 0, 0, 0).getTime()
    const result = buildRediscovery([event('a', lastYear)], NOW)
    expect(result.anniversary.map(e => e.song.id)).toEqual(['a'])
    expect(result.anniversary[0].note).toBe('去年今天')
  })

  it('前后三天之内都算，第四天不算', () => {
    const within = new Date(2025, 7, 24, 12, 0, 0, 0).getTime()
    const outside = new Date(2025, 7, 26, 12, 0, 0, 0).getTime()
    expect(buildRediscovery([event('a', within)], NOW).anniversary).toHaveLength(1)
    expect(buildRediscovery([event('b', outside)], NOW).anniversary).toHaveLength(0)
  })

  it('今年听过的不算——那不叫回忆', () => {
    const thisYear = new Date(2026, 7, 20, 12, 0, 0, 0).getTime()
    expect(buildRediscovery([event('a', thisYear)], NOW).anniversary).toHaveLength(0)
  })

  it('多年都在这一天听过时，说最久远的那一年', () => {
    const result = buildRediscovery([
      event('a', new Date(2025, 7, 21).getTime()),
      event('a', new Date(2023, 7, 21).getTime()),
    ], NOW)
    expect(result.anniversary[0].note).toBe('3 年前的今天')
  })

  it('跨年也算相邻：元旦前后不该断开', () => {
    const newYearNow = new Date(2026, 0, 1, 12, 0, 0, 0).getTime()
    const lastDec = new Date(2024, 11, 30, 12, 0, 0, 0).getTime()
    expect(buildRediscovery([event('a', lastDec)], newYearNow).anniversary).toHaveLength(1)
  })
})

describe('久违', () => {
  it('听过很多次、很久没碰的才算', () => {
    const old = NOW - 200 * DAY
    const events = Array.from({ length: 5 }, (_, i) => event('a', old - i * DAY))
    const result = buildRediscovery(events, NOW)
    expect(result.dormant.map(e => e.song.id)).toEqual(['a'])
    expect(result.dormant[0].note).toContain('个月没听了')
  })

  it('只听过两三次的不算「曾经喜欢」', () => {
    const old = NOW - 200 * DAY
    const events = [event('a', old), event('a', old - DAY), event('a', old - 2 * DAY)]
    expect(buildRediscovery(events, NOW).dormant).toHaveLength(0)
  })

  it('最近还在听的不算久违', () => {
    const events = Array.from({ length: 6 }, (_, i) => event('a', NOW - i * DAY))
    expect(buildRediscovery(events, NOW).dormant).toHaveLength(0)
  })

  it('超过一年的说「几年没听了」', () => {
    const events = Array.from({ length: 5 }, (_, i) => event('a', NOW - 800 * DAY - i * DAY))
    expect(buildRediscovery(events, NOW).dormant[0].note).toBe('2 年没听了')
  })

  it('听得多且停得久的排在前面', () => {
    const events = [
      ...Array.from({ length: 20 }, (_, i) => event('loved', NOW - 300 * DAY - i * DAY)),
      ...Array.from({ length: 4 }, (_, i) => event('mild', NOW - 130 * DAY - i * DAY)),
    ]
    expect(buildRediscovery(events, NOW).dormant[0].song.id).toBe('loved')
  })
})

describe('只听过一次', () => {
  it('听过一遍、之后再没打开的才算', () => {
    const result = buildRediscovery([event('a', NOW - 100 * DAY)], NOW)
    expect(result.onceOnly.map(e => e.song.id)).toEqual(['a'])
  })

  it('刚听过的不算被冷落，只是还没轮到', () => {
    expect(buildRediscovery([event('a', NOW - 10 * DAY)], NOW).onceOnly).toHaveLength(0)
  })

  it('听过两次的不算', () => {
    const events = [event('a', NOW - 100 * DAY), event('a', NOW - 99 * DAY)]
    expect(buildRediscovery(events, NOW).onceOnly).toHaveLength(0)
  })

  it('越久远的排越前', () => {
    const result = buildRediscovery([
      event('recent', NOW - 60 * DAY),
      event('ancient', NOW - 900 * DAY),
    ], NOW)
    expect(result.onceOnly.map(e => e.song.id)).toEqual(['ancient', 'recent'])
  })
})

describe('通用约束', () => {
  it('划过去的两秒不该让一首歌进任何名单', () => {
    const skims = Array.from({ length: 8 }, (_, i) => event('a', NOW - 300 * DAY - i * DAY, 2))
    const result = buildRediscovery(skims, NOW)
    expect(result.dormant).toHaveLength(0)
    expect(result.onceOnly).toHaveLength(0)
    expect(result.anniversary).toHaveLength(0)
  })

  it('同一首不会同时出现在两栏里', () => {
    // 只听过一次、且正好是去年今天听的：两个条件同时成立
    const lastYear = new Date(2025, 7, 21, 20, 0, 0, 0).getTime()
    const result = buildRediscovery([event('a', lastYear)], NOW)
    expect(result.anniversary.map(e => e.song.id)).toEqual(['a'])
    expect(result.onceOnly).toHaveLength(0)
  })

  it('去重按「去年今日 → 久违 → 只听过一次」的优先级占位', () => {
    const lastYear = new Date(2025, 7, 21, 20, 0, 0, 0).getTime()
    // 这一首既久违（6 次、一年多没听）又落在去年今天
    const events = Array.from({ length: 6 }, (_, i) => event('a', lastYear - i * DAY))
    const result = buildRediscovery(events, NOW)
    expect(result.anniversary.map(e => e.song.id)).toEqual(['a'])
    expect(result.dormant).toHaveLength(0)
  })

  it('空历史返回三个空列表，不抛错', () => {
    expect(buildRediscovery([], NOW)).toEqual({ anniversary: [], dormant: [], onceOnly: [] })
  })

  it('每一栏都受 limit 限制', () => {
    const events = Array.from({ length: 30 }, (_, i) => event(`s${i}`, NOW - 100 * DAY))
    expect(buildRediscovery(events, NOW, 5).onceOnly).toHaveLength(5)
  })
})
