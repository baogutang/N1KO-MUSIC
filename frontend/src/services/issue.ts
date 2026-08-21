/**
 * 《本期》—— 把一段收听期整理成一期刊物。
 *
 * 别人做「年度总结」是一次性的营销活动；以刊物为形态的产品可以每个月自动成刊。
 *
 * 关键纪律：编者按只由**真实数据拼成的模板句**组成，一个字都不虚构——
 * 首页的 heroLede 已经在守这条，这里沿用。宁可少说一句，不说没有依据的话。
 */

import type { ListeningEvent } from '@/services/listeningHistory'
import { isQualifiedListeningEvent } from '@/services/listeningHistory'
import type { Song } from '@/api/types'

const DAY_MS = 86_400_000
/** 两次收听间隔超过这个值就算两次独立的「一场」 */
const SESSION_GAP_MS = 30 * 60_000

export interface IssuePeriod {
  /** 'month' | 'year' */
  kind: 'month' | 'year'
  /** 本地时间的起止（含起、不含止）*/
  from: number
  to: number
  /** 展示用的期号，如 2026·08 或 2026 */
  label: string
}

export interface IssueEntry {
  key: string
  title: string
  subtitle?: string
  count: number
  /** 用于跳转 */
  id?: string
  coverArt?: string
}

export interface IssueSuperlative {
  label: string
  value: string
  detail?: string
}

export interface Issue {
  period: IssuePeriod
  /** 有效播放次数 */
  plays: number
  listenedSeconds: number
  uniqueSongs: number
  uniqueArtists: number
  activeDays: number
  topSongs: IssueEntry[]
  topArtists: IssueEntry[]
  topAlbums: IssueEntry[]
  /** 本期封面故事：这一期最具代表性的歌手 */
  coverArtist: IssueEntry | null
  /** 本期第一次听到的歌手 */
  discoveries: IssueEntry[]
  superlatives: IssueSuperlative[]
  /** 编者按：只由模板化的真实句子拼成 */
  editorsNote: string
  /** 数据是否足以成刊 */
  hasEnough: boolean
}

/** 本地月份的起止 */
export function monthPeriod(now = Date.now()): IssuePeriod {
  const d = new Date(now)
  const from = new Date(d.getFullYear(), d.getMonth(), 1).getTime()
  const to = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime()
  return {
    kind: 'month',
    from,
    to,
    label: `${d.getFullYear()}·${String(d.getMonth() + 1).padStart(2, '0')}`,
  }
}

/** 本地年份的起止 */
export function yearPeriod(now = Date.now()): IssuePeriod {
  const d = new Date(now)
  const from = new Date(d.getFullYear(), 0, 1).getTime()
  const to = new Date(d.getFullYear() + 1, 0, 1).getTime()
  return { kind: 'year', from, to, label: String(d.getFullYear()) }
}

/** 往前推 n 期 */
export function shiftPeriod(period: IssuePeriod, delta: number): IssuePeriod {
  const d = new Date(period.from)
  if (period.kind === 'month') {
    const from = new Date(d.getFullYear(), d.getMonth() + delta, 1)
    const to = new Date(d.getFullYear(), d.getMonth() + delta + 1, 1)
    return {
      kind: 'month',
      from: from.getTime(),
      to: to.getTime(),
      label: `${from.getFullYear()}·${String(from.getMonth() + 1).padStart(2, '0')}`,
    }
  }
  const from = new Date(d.getFullYear() + delta, 0, 1)
  const to = new Date(d.getFullYear() + delta + 1, 0, 1)
  return { kind: 'year', from: from.getTime(), to: to.getTime(), label: String(from.getFullYear()) }
}

function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function formatDurationCn(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.round((seconds % 3600) / 60)
  if (hours >= 1) return minutes > 0 ? `${hours} 小时 ${minutes} 分钟` : `${hours} 小时`
  return `${Math.max(1, minutes)} 分钟`
}

function rank(map: Map<string, { count: number; song: Song }>, limit: number): IssueEntry[] {
  return Array.from(map.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, limit)
    .map(([key, v]) => ({
      key,
      title: v.song.title,
      subtitle: v.song.artist,
      count: v.count,
      id: v.song.id,
      coverArt: v.song.coverArt,
    }))
}

/** 成刊的最低数据量：太少的话「本期」只会显得寒酸 */
const MIN_PLAYS_FOR_ISSUE = 12

export function buildIssue(
  allEvents: ListeningEvent[],
  period: IssuePeriod,
  topLimit = 10
): Issue {
  const scoped = allEvents.filter(e => e.endedAt >= period.from && e.endedAt < period.to)
  const qualified = scoped.filter(isQualifiedListeningEvent)

  const songs = new Map<string, { count: number; song: Song }>()
  const artists = new Map<string, { count: number; song: Song }>()
  const albums = new Map<string, { count: number; song: Song }>()
  const artistSeconds = new Map<string, number>()
  const activeDays = new Set<number>()
  let listenedSeconds = 0

  for (const event of scoped) listenedSeconds += event.listenedSeconds
  for (const event of qualified) {
    const song = event.song
    activeDays.add(startOfLocalDay(event.endedAt))

    const songKey = `${song.serverId ?? ''}:${song.id}`
    const prevSong = songs.get(songKey)
    songs.set(songKey, { count: (prevSong?.count ?? 0) + 1, song })

    if (song.artist) {
      const key = song.artist.toLocaleLowerCase()
      const prev = artists.get(key)
      artists.set(key, { count: (prev?.count ?? 0) + 1, song })
      artistSeconds.set(key, (artistSeconds.get(key) ?? 0) + event.listenedSeconds)
    }
    if (song.album) {
      const key = song.albumId || song.album.toLocaleLowerCase()
      const prev = albums.get(key)
      albums.set(key, { count: (prev?.count ?? 0) + 1, song })
    }
  }

  const topSongs = rank(songs, topLimit)
  const topArtists = Array.from(artists.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, topLimit)
    .map(([key, v]) => ({
      key,
      title: v.song.artist,
      count: v.count,
      id: v.song.artistId,
      coverArt: v.song.coverArt,
    }))
  const topAlbums = Array.from(albums.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, topLimit)
    .map(([key, v]) => ({
      key,
      title: v.song.album,
      subtitle: v.song.artist,
      count: v.count,
      id: v.song.albumId,
      coverArt: v.song.coverArt,
    }))

  // 本期发现：这一期第一次听到、而此前从没听过的歌手
  const earlierArtists = new Set(
    allEvents
      .filter(e => e.endedAt < period.from && e.song.artist)
      .map(e => e.song.artist.toLocaleLowerCase())
  )
  const discoveries = topArtists.filter(a => !earlierArtists.has(a.key)).slice(0, 5)

  const superlatives = buildSuperlatives(scoped, qualified, artistSeconds, artists)
  const coverArtist = topArtists[0] ?? null

  const hasEnough = qualified.length >= MIN_PLAYS_FOR_ISSUE
  return {
    period,
    plays: qualified.length,
    listenedSeconds: Math.round(listenedSeconds),
    uniqueSongs: songs.size,
    uniqueArtists: artists.size,
    activeDays: activeDays.size,
    topSongs,
    topArtists,
    topAlbums,
    coverArtist,
    discoveries,
    superlatives,
    editorsNote: buildEditorsNote({
      period,
      plays: qualified.length,
      listenedSeconds: Math.round(listenedSeconds),
      activeDays: activeDays.size,
      uniqueArtists: artists.size,
      coverArtist,
      discoveries,
    }),
    hasEnough,
  }
}

function buildSuperlatives(
  scoped: ListeningEvent[],
  qualified: ListeningEvent[],
  artistSeconds: Map<string, number>,
  artists: Map<string, { count: number; song: Song }>
): IssueSuperlative[] {
  const out: IssueSuperlative[] = []
  if (!qualified.length) return out

  // 最长的一场：按 30 分钟间隔切分连续收听
  const sorted = [...qualified].sort((a, b) => a.endedAt - b.endedAt)
  let bestSession = 0
  let sessionStart = sorted[0].endedAt
  let sessionEnd = sorted[0].endedAt
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].endedAt - sessionEnd > SESSION_GAP_MS) {
      bestSession = Math.max(bestSession, sessionEnd - sessionStart)
      sessionStart = sorted[i].endedAt
    }
    sessionEnd = sorted[i].endedAt
  }
  bestSession = Math.max(bestSession, sessionEnd - sessionStart)
  if (bestSession > 20 * 60_000) {
    out.push({ label: '最长的一场', value: formatDurationCn(bestSession / 1000) })
  }

  // 单曲重复最多
  const repeat = new Map<string, { count: number; song: Song }>()
  for (const e of qualified) {
    const key = `${e.song.serverId ?? ''}:${e.song.id}`
    const prev = repeat.get(key)
    repeat.set(key, { count: (prev?.count ?? 0) + 1, song: e.song })
  }
  const mostRepeated = Array.from(repeat.values()).sort((a, b) => b.count - a.count)[0]
  if (mostRepeated && mostRepeated.count >= 3) {
    out.push({
      label: '单曲重复最多',
      value: mostRepeated.song.title,
      detail: `${mostRepeated.count} 次`,
    })
  }

  // 最重的一天
  const byDay = new Map<number, number>()
  for (const e of scoped) {
    const day = startOfLocalDay(e.endedAt)
    byDay.set(day, (byDay.get(day) ?? 0) + e.listenedSeconds)
  }
  const heaviest = Array.from(byDay.entries()).sort((a, b) => b[1] - a[1])[0]
  if (heaviest && heaviest[1] > 600) {
    const d = new Date(heaviest[0])
    out.push({
      label: '最重的一天',
      value: `${d.getMonth() + 1} 月 ${d.getDate()} 日`,
      detail: formatDurationCn(heaviest[1]),
    })
  }

  // 陪伴时间最长的歌手（按秒，不是按次——一首长曲和一首短曲不该等价）
  const longestArtist = Array.from(artistSeconds.entries()).sort((a, b) => b[1] - a[1])[0]
  if (longestArtist && longestArtist[1] > 600) {
    out.push({
      label: '陪伴最久',
      value: artists.get(longestArtist[0])?.song.artist ?? longestArtist[0],
      detail: formatDurationCn(longestArtist[1]),
    })
  }

  return out
}

/**
 * 编者按。
 * 每一句都由真实数值填进固定模板，没有任何生成式描述。
 * 数据不足以支撑某一句时，那一句直接不出现。
 */
function buildEditorsNote(input: {
  period: IssuePeriod
  plays: number
  listenedSeconds: number
  activeDays: number
  uniqueArtists: number
  coverArtist: IssueEntry | null
  discoveries: IssueEntry[]
}): string {
  const { period, plays, listenedSeconds, activeDays, uniqueArtists, coverArtist, discoveries } = input
  if (!plays) return ''

  const unit = period.kind === 'month' ? '这个月' : '这一年'
  const sentences: string[] = []

  sentences.push(
    `${unit}你听了 ${plays} 次，累计 ${formatDurationCn(listenedSeconds)}，` +
    `分布在 ${activeDays} 天里。`
  )
  if (uniqueArtists > 0) {
    sentences.push(`一共来自 ${uniqueArtists} 位歌手。`)
  }
  if (coverArtist && coverArtist.count >= 3) {
    sentences.push(`其中 ${coverArtist.title} 出现了 ${coverArtist.count} 次，是${unit}的主角。`)
  }
  if (discoveries.length) {
    const names = discoveries.slice(0, 3).map(d => d.title).join('、')
    sentences.push(`${unit}第一次听到的有 ${names}。`)
  }
  return sentences.join('')
}
