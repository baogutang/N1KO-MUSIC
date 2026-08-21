/**
 * 《本期》的关键契约：编者按只由真实数据拼成，数据不够就不成刊。
 */
import { describe, expect, it } from 'vitest'
import { buildIssue, monthPeriod, shiftPeriod, yearPeriod } from '@/services/issue'
import type { ListeningEvent } from '@/services/listeningHistory'
import type { Song } from '@/api/types'

const NOW = new Date(2026, 7, 15, 12, 0, 0, 0).getTime()

function song(id: string, artist: string, album = 'A'): Song {
  return {
    id, serverId: 's', title: `Song ${id}`, artist, album, albumId: album,
    duration: 200,
  }
}

function event(target: Song, at: number, listened = 200): ListeningEvent {
  return {
    version: 2,
    eventId: `${target.id}-${at}`,
    serverId: 's',
    song: target,
    startedAt: at - listened * 1000,
    endedAt: at,
    listenedSeconds: listened,
    completionRate: listened / target.duration,
    outcome: 'completed',
  }
}

describe('期号与区间', () => {
  it('月期与年期按本地时间切分', () => {
    const m = monthPeriod(NOW)
    expect(m.label).toBe('2026·08')
    expect(new Date(m.from).getDate()).toBe(1)
    expect(new Date(m.from).getMonth()).toBe(7)

    const y = yearPeriod(NOW)
    expect(y.label).toBe('2026')
    expect(new Date(y.from).getMonth()).toBe(0)
  })

  it('往前推期号正确跨年', () => {
    const jan = shiftPeriod(monthPeriod(new Date(2026, 0, 10).getTime()), -1)
    expect(jan.label).toBe('2025·12')
    const prevYear = shiftPeriod(yearPeriod(NOW), -1)
    expect(prevYear.label).toBe('2025')
  })
})

describe('成刊', () => {
  const period = monthPeriod(NOW)
  const inPeriod = (day: number) => new Date(2026, 7, day, 20, 0, 0).getTime()

  it('数据太少时明确标为不足以成刊', () => {
    const issue = buildIssue([event(song('1', 'A'), inPeriod(3))], period)
    expect(issue.hasEnough).toBe(false)
    expect(issue.plays).toBe(1)
  })

  it('统计只覆盖本期，跨期事件不计入', () => {
    const events = [
      ...Array.from({ length: 14 }, (_, i) => event(song(String(i), '张三'), inPeriod(1 + (i % 20)))),
      // 上个月的，不该被算进来
      event(song('old', '李四'), new Date(2026, 6, 20).getTime()),
    ]
    const issue = buildIssue(events, period)
    expect(issue.hasEnough).toBe(true)
    expect(issue.plays).toBe(14)
    expect(issue.topArtists.map(a => a.title)).toEqual(['张三'])
  })

  it('本期发现只算此前从没听过的歌手', () => {
    const events = [
      // 上个月听过老王
      event(song('x', '老王'), new Date(2026, 6, 5).getTime()),
      ...Array.from({ length: 12 }, (_, i) => event(song(`a${i}`, '老王'), inPeriod(2))),
      ...Array.from({ length: 4 }, (_, i) => event(song(`b${i}`, '新人'), inPeriod(4))),
    ]
    const issue = buildIssue(events, period)
    const names = issue.discoveries.map(d => d.title)
    expect(names).toContain('新人')
    expect(names).not.toContain('老王')
  })

  it('编者按只陈述真实数值，无数据时为空', () => {
    expect(buildIssue([], period).editorsNote).toBe('')

    const events = Array.from({ length: 20 }, (_, i) =>
      event(song(String(i), '周杰伦'), inPeriod(1 + (i % 5)))
    )
    const note = buildIssue(events, period).editorsNote
    expect(note).toContain('20 次')
    expect(note).toContain('周杰伦')
    // 活跃天数必须是真实的去重天数
    expect(note).toContain('5 天')
  })

  it('超级数据只在有依据时出现', () => {
    const thin = buildIssue([event(song('1', 'A'), inPeriod(3))], period)
    expect(thin.superlatives).toEqual([])

    const repeated = Array.from({ length: 15 }, (_, i) =>
      event(song('same', 'A'), inPeriod(3) + i * 60_000)
    )
    const issue = buildIssue(repeated, period)
    const labels = issue.superlatives.map(s => s.label)
    expect(labels).toContain('单曲重复最多')
  })
})
