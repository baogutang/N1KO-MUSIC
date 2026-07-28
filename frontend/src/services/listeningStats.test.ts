import { describe, expect, it } from 'vitest'
import type { Song } from '@/api/types'
import {
  computeListeningStats,
  formatHourRange,
  formatRate,
} from '@/services/listeningStats'
import type { ListeningEvent, ListeningOutcome } from '@/services/listeningHistory'

/**
 * 统计按「本地」日历天与本地小时分桶，因此固定时刻必须用本地时间构造。
 * 写死 +08:00 这类偏移会让断言实际依赖运行机器的时区（CI 跑在 UTC 上就会错位）。
 */
const localTime = (hour: number, minute = 0) =>
  new Date(2026, 6, 28, hour, minute, 0, 0).getTime()

const NOW = localTime(15)
const DAY = 86_400_000

function song(id: string, overrides: Partial<Song> = {}): Song {
  return {
    id,
    serverId: 'server-a',
    title: `Song ${id}`,
    artist: 'Artist A',
    album: 'Album A',
    albumId: 'album-a',
    duration: 200,
    ...overrides,
  }
}

let eventSeq = 0

function event(
  target: Song,
  outcome: ListeningOutcome,
  listenedSeconds: number,
  endedAt = NOW
): ListeningEvent {
  eventSeq += 1
  return {
    version: 2,
    eventId: `event-${eventSeq}`,
    serverId: 'server-a',
    song: target,
    startedAt: endedAt - listenedSeconds * 1000,
    endedAt,
    listenedSeconds,
    completionRate: listenedSeconds / (target.duration || 1),
    outcome,
  }
}

/** 时长 200s 时 scrobble 阈值为 100s，据此构造达标/不达标事件 */
const QUALIFIED_SECONDS = 150
const SKIPPED_SECONDS = 5

describe('computeListeningStats', () => {
  it('无数据时返回 null', () => {
    expect(computeListeningStats([], 7, NOW)).toBeNull()
  })

  it('范围外的记录不参与统计', () => {
    const stats = computeListeningStats(
      [
        event(song('recent'), 'completed', QUALIFIED_SECONDS, NOW),
        event(song('old'), 'completed', QUALIFIED_SECONDS, NOW - 20 * DAY),
      ],
      7,
      NOW
    )
    expect(stats?.plays).toBe(1)
    expect(stats?.uniqueSongs).toBe(1)
  })

  it('range 为 all 时纳入全部历史', () => {
    const stats = computeListeningStats(
      [
        event(song('recent'), 'completed', QUALIFIED_SECONDS, NOW),
        event(song('ancient'), 'completed', QUALIFIED_SECONDS, NOW - 900 * DAY),
      ],
      'all',
      NOW
    )
    expect(stats?.plays).toBe(2)
  })

  it('有效播放次数只计达到 scrobble 阈值的事件', () => {
    const stats = computeListeningStats(
      [
        event(song('a'), 'completed', QUALIFIED_SECONDS),
        event(song('b'), 'skipped', SKIPPED_SECONDS),
      ],
      7,
      NOW
    )
    expect(stats?.plays).toBe(1)
  })

  it('总收听时长包含被跳过的部分,因为这段时间确实被花掉了', () => {
    const stats = computeListeningStats(
      [
        event(song('a'), 'completed', QUALIFIED_SECONDS),
        event(song('b'), 'skipped', SKIPPED_SECONDS),
      ],
      7,
      NOW
    )
    expect(stats?.listenedSeconds).toBe(QUALIFIED_SECONDS + SKIPPED_SECONDS)
  })

  it('完成率与跳过率以范围内全部事件为分母', () => {
    const stats = computeListeningStats(
      [
        event(song('a'), 'completed', 200),
        event(song('b'), 'completed', 200),
        event(song('c'), 'skipped', SKIPPED_SECONDS),
        event(song('d'), 'abandoned', 60),
      ],
      7,
      NOW
    )
    expect(stats?.completionRate).toBeCloseTo(0.5)
    expect(stats?.skipRate).toBeCloseTo(0.25)
  })

  it('重复收听占比反映同一首歌被听了多少次', () => {
    const repeated = song('loop')
    const stats = computeListeningStats(
      [
        event(repeated, 'completed', QUALIFIED_SECONDS),
        event(repeated, 'completed', QUALIFIED_SECONDS),
        event(repeated, 'completed', QUALIFIED_SECONDS),
        event(song('once'), 'completed', QUALIFIED_SECONDS),
      ],
      7,
      NOW
    )
    // 4 次有效播放、2 首不同歌曲 → 一半是重复
    expect(stats?.repeatRate).toBeCloseTo(0.5)
    expect(stats?.uniqueSongs).toBe(2)
  })

  it('活跃天数与日均时长按有播放的天计算,长期不听不会摊平均值', () => {
    const stats = computeListeningStats(
      [
        event(song('a'), 'completed', 100, NOW),
        event(song('b'), 'completed', 100, NOW - DAY),
      ],
      7,
      NOW
    )
    expect(stats?.activeDays).toBe(2)
    // 200 秒分摊到 2 个活跃日，而不是 7 天
    expect(stats?.dailyAverageSeconds).toBe(100)
  })

  it('按本地小时统计收听时段并给出高峰', () => {
    const stats = computeListeningStats(
      [
        event(song('a'), 'completed', QUALIFIED_SECONDS, localTime(22, 30)),
        event(song('b'), 'completed', QUALIFIED_SECONDS, localTime(22, 45)),
        event(song('c'), 'completed', QUALIFIED_SECONDS, localTime(9, 30)),
      ],
      7,
      NOW
    )
    expect(stats?.hourly).toHaveLength(24)
    expect(stats?.hourly[22]).toBe(2)
    expect(stats?.hourly[9]).toBe(1)
    expect(stats?.peakHour).toBe(22)
  })

  it('只有跳过记录时没有高峰时段', () => {
    const stats = computeListeningStats([event(song('a'), 'skipped', SKIPPED_SECONDS)], 7, NOW)
    expect(stats?.peakHour).toBeNull()
    expect(stats?.plays).toBe(0)
  })

  it('日历图按范围给出桶数,最后一桶是今天', () => {
    const events = [event(song('a'), 'completed', QUALIFIED_SECONDS, NOW)]
    expect(computeListeningStats(events, 7, NOW)?.daily).toHaveLength(7)

    const monthly = computeListeningStats(events, 30, NOW)
    expect(monthly?.daily).toHaveLength(30)
    expect(monthly?.daily.at(-1)?.plays).toBe(1)
    expect(monthly?.daily[0].plays).toBe(0)
  })

  it('range 为 all 时日历图不超过 30 桶', () => {
    const stats = computeListeningStats(
      [event(song('a'), 'completed', QUALIFIED_SECONDS, NOW - 900 * DAY)],
      'all',
      NOW
    )
    expect(stats!.daily.length).toBeLessThanOrEqual(30)
  })

  it('榜单按次数排序,跳过的歌不污染最爱榜', () => {
    const loved = song('loved', { title: 'Loved', artist: 'Artist L', albumId: 'album-l', album: 'Album L' })
    const hated = song('hated', { title: 'Hated', artist: 'Artist H', albumId: 'album-h', album: 'Album H' })
    const stats = computeListeningStats(
      [
        event(loved, 'completed', QUALIFIED_SECONDS),
        event(loved, 'completed', QUALIFIED_SECONDS),
        ...Array.from({ length: 5 }, () => event(hated, 'skipped', SKIPPED_SECONDS)),
      ],
      7,
      NOW
    )
    expect(stats?.topSongs[0].title).toBe('Loved')
    expect(stats?.topSongs.map(item => item.title)).not.toContain('Hated')
    expect(stats?.topArtists[0].title).toBe('Artist L')
    expect(stats?.topAlbums[0].title).toBe('Album L')
  })

  it('缺失歌手名归入未知歌手,缺失专辑不进专辑榜', () => {
    const stats = computeListeningStats(
      [event(song('a', { artist: '', album: '', albumId: undefined }), 'completed', QUALIFIED_SECONDS)],
      7,
      NOW
    )
    expect(stats?.topArtists[0].title).toBe('未知歌手')
    expect(stats?.topAlbums).toEqual([])
    expect(stats?.uniqueAlbums).toBe(0)
  })
})

describe('格式化辅助', () => {
  it('比例格式化为整数百分比', () => {
    expect(formatRate(0)).toBe('0%')
    expect(formatRate(0.456)).toBe('46%')
    expect(formatRate(1)).toBe('100%')
  })

  it('时段格式化跨午夜时回到 00:00', () => {
    expect(formatHourRange(9)).toBe('09:00–10:00')
    expect(formatHourRange(23)).toBe('23:00–00:00')
  })
})
