/**
 * 收听统计计算。
 *
 * 从 Stats 页的内联 useMemo 抽出，一是便于测试，二是历史迁到 IndexedDB 后
 * 保留窗口大幅变长（上限 2 万条），统计口径与时间范围需要能明确表达。
 */

import { isQualifiedListeningEvent, type ListeningEvent } from '@/services/listeningHistory'
import { t } from '@/i18n'

/** 统计时间范围：最近 N 天，或全部历史 */
export type StatsRange = 7 | 30 | 'all'

/** 日历图最多渲染的柱数；全部历史也只展示最近这么多天 */
const MAX_DAILY_BUCKETS = 30

const DAY_MS = 86_400_000

export interface RankedEntry {
  key: string
  title: string
  subtitle?: string
  count: number
}

export interface DailyBucket {
  label: string
  dayStart: number
  plays: number
}

export interface ListeningStats {
  /** 达到 scrobble 阈值的有效播放次数 */
  plays: number
  /** 实际收听秒数，包含被跳过的部分（这段时间确实被花掉了） */
  listenedSeconds: number
  uniqueSongs: number
  uniqueArtists: number
  uniqueAlbums: number
  /** 完整听完的占比（0–1），分母为范围内全部收听事件 */
  completionRate: number
  /** 刚开头就被跳过的占比（0–1） */
  skipRate: number
  /** 有有效播放的天数 */
  activeDays: number
  /** 按活跃天平均的收听秒数（不是按范围天数平均，避免长期不听把均值摊平） */
  dailyAverageSeconds: number
  /** 重复收听占比：有效播放中非首次听到该曲目的比例 */
  repeatRate: number
  topSongs: RankedEntry[]
  topArtists: RankedEntry[]
  topAlbums: RankedEntry[]
  daily: DailyBucket[]
  /** 24 项，按本地小时统计的有效播放次数 */
  hourly: number[]
  /** 收听最集中的本地小时；无数据时为 null */
  peakHour: number | null
}

/** 本地零点，作为按天分桶的边界（用 UTC 零点会把当天的播放记到前一天） */
function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function rank<T>(
  source: Map<string, { count: number; value: T }>,
  toEntry: (key: string, value: T, count: number) => RankedEntry,
  limit: number
): RankedEntry[] {
  return Array.from(source.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, limit)
    .map(([key, item]) => toEntry(key, item.value, item.count))
}

export function computeListeningStats(
  events: ListeningEvent[],
  range: StatsRange = 7,
  now = Date.now(),
  topLimit = 5
): ListeningStats | null {
  const todayStart = startOfLocalDay(now)
  const rangeStart = range === 'all' ? -Infinity : todayStart - (range - 1) * DAY_MS
  const scoped = events.filter(event => event.endedAt >= rangeStart)
  if (!scoped.length) return null

  const qualified = scoped.filter(isQualifiedListeningEvent)

  const songs = new Map<string, { count: number; value: ListeningEvent['song'] }>()
  const artists = new Map<string, { count: number; value: string }>()
  const albums = new Map<string, { count: number; value: ListeningEvent['song'] }>()
  const activeDays = new Set<number>()
  const hourly = Array.from({ length: 24 }, () => 0)

  for (const event of qualified) {
    const songKey = `${event.serverId}:${event.song.id}`
    const song = songs.get(songKey)
    if (song) song.count++
    else songs.set(songKey, { count: 1, value: event.song })

    const artistName = event.song.artist || t('artist.unknown')
    const artist = artists.get(artistName)
    if (artist) artist.count++
    else artists.set(artistName, { count: 1, value: artistName })

    if (event.song.album) {
      const albumKey = event.song.albumId ?? event.song.album
      const album = albums.get(albumKey)
      if (album) album.count++
      else albums.set(albumKey, { count: 1, value: event.song })
    }

    activeDays.add(startOfLocalDay(event.endedAt))
    hourly[new Date(event.endedAt).getHours()]++
  }

  const listenedSeconds = scoped.reduce((sum, event) => sum + event.listenedSeconds, 0)
  const completed = scoped.filter(event => event.outcome === 'completed').length
  const skipped = scoped.filter(event => event.outcome === 'skipped').length

  // 日历图：范围内的天数，但不超过 MAX_DAILY_BUCKETS
  const spanDays = range === 'all'
    ? Math.min(
      MAX_DAILY_BUCKETS,
      Math.floor((todayStart - startOfLocalDay(Math.min(...scoped.map(e => e.endedAt)))) / DAY_MS) + 1
    )
    : range
  const daily = Array.from({ length: spanDays }, (_, index) => {
    const dayStart = todayStart - (spanDays - 1 - index) * DAY_MS
    const dayEnd = dayStart + DAY_MS
    const date = new Date(dayStart)
    return {
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      dayStart,
      plays: qualified.filter(event => event.endedAt >= dayStart && event.endedAt < dayEnd).length,
    }
  })

  const peakPlays = Math.max(...hourly)
  const peakHour = peakPlays > 0 ? hourly.indexOf(peakPlays) : null

  return {
    plays: qualified.length,
    listenedSeconds,
    uniqueSongs: songs.size,
    uniqueArtists: artists.size,
    uniqueAlbums: albums.size,
    completionRate: completed / scoped.length,
    skipRate: skipped / scoped.length,
    activeDays: activeDays.size,
    dailyAverageSeconds: activeDays.size ? Math.round(listenedSeconds / activeDays.size) : 0,
    repeatRate: qualified.length ? (qualified.length - songs.size) / qualified.length : 0,
    topSongs: rank(songs, (key, song, count) => ({
      key,
      title: song.title,
      subtitle: song.artist,
      count,
    }), topLimit),
    topArtists: rank(artists, (key, name, count) => ({ key, title: name, count }), topLimit),
    topAlbums: rank(albums, (key, song, count) => ({
      key,
      title: song.album,
      subtitle: song.artist,
      count,
    }), topLimit),
    daily,
    hourly,
    peakHour,
  }
}

/** 把 0–1 的比例格式化为整数百分比 */
export function formatRate(rate: number): string {
  return `${Math.round(rate * 100)}%`
}

/** 把小时格式化为易读时段，例如 21 → 21:00–22:00 */
export function formatHourRange(hour: number): string {
  const next = (hour + 1) % 24
  return `${String(hour).padStart(2, '0')}:00–${String(next).padStart(2, '0')}:00`
}
