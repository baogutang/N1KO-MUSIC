/**
 * 导入既有的打卡历史。
 *
 * 换到自托管播放器最劝退的一件事：多年的收听记录留在了 Last.fm 或 ListenBrainz 上，
 * 新软件从零开始——统计是空的，《本期》没法成刊，推荐要重新学一遍你是谁。
 * 那些记录本来就是你的，应该能拿回来。
 *
 * 支持三种来源：
 *   1. 本应用自己导出的 JSON（完整，含时长与完成度）
 *   2. ListenBrainz 的导出 JSON（listens 数组）
 *   3. 通用 CSV：本应用导出的那份，以及各家 Last.fm 导出工具的常见列名
 *
 * 有一件事必须说清楚：外部记录只有「哪年哪月听了哪首」，没有听了多少秒。
 * 因此导入的事件按「听完」计（completionRate = 1），这在推荐画像上是合理的——
 * 一条打卡本来就代表一次达标的收听；但它不会凭空编造跳过、秒切之类的负面信号。
 */

import type { Song } from '@/api/types'
import type { ListeningEvent } from '@/services/listeningHistory'

/** 外部记录默认按这个时长计。Last.fm 系导出普遍不带时长。 */
const ASSUMED_DURATION_SECONDS = 210

/** 一次导入的上限。再多就该考虑直接换库文件了，也免得把 IndexedDB 撑爆。 */
export const MAX_IMPORT_EVENTS = 50_000

export interface ImportResult {
  events: ListeningEvent[]
  /** 认出来的来源，用于回报给用户 */
  source: 'n1ko' | 'listenbrainz' | 'csv'
  /** 因为缺歌手/曲名/时间而跳过的条数 */
  skipped: number
  /** 超出上限被截断的条数 */
  truncated: number
}

/**
 * 合成一个稳定的曲目 id。
 *
 * 外部记录没有本地曲库的 id。用「歌手|曲名」哈希出一个确定值，
 * 同一首歌的多次收听才会聚合到一起——否则统计里会出现一百个「只听过一次」。
 * 前缀 import: 让它一眼可辨，也保证永远不会和服务端 id 撞上。
 */
export function syntheticSongId(artist: string, title: string): string {
  const seed = `${artist.trim().toLocaleLowerCase()}|${title.trim().toLocaleLowerCase()}`
  let hash = 2166136261
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `import:${(hash >>> 0).toString(36)}`
}

function makeEvent(
  serverId: string,
  artist: string,
  title: string,
  album: string | undefined,
  endedAtMs: number,
  durationSeconds = ASSUMED_DURATION_SECONDS
): ListeningEvent {
  const songId = syntheticSongId(artist, title)
  const song: Song = {
    id: songId,
    serverId,
    title: title.trim(),
    artist: artist.trim(),
    album: album?.trim() || '',
    duration: durationSeconds,
  } as Song
  return {
    version: 2,
    // eventId 含时间戳：同一首歌的每一次收听都是独立的一条，不能互相覆盖
    eventId: `${songId}@${Math.floor(endedAtMs / 1000)}`,
    serverId,
    song,
    startedAt: endedAtMs - durationSeconds * 1000,
    endedAt: endedAtMs,
    listenedSeconds: durationSeconds,
    completionRate: 1,
    outcome: 'completed',
  }
}

/** 秒级还是毫秒级：2001 年之后的毫秒时间戳都大于 1e12 */
function toMillis(value: number): number {
  return value > 1e12 ? value : value * 1000
}

function isPlausibleTimestamp(ms: number): boolean {
  // 1990 年之前和「明天之后」都不可能是一条真实的收听记录
  return Number.isFinite(ms) && ms > 631_152_000_000 && ms < Date.now() + 86_400_000
}

/** 本应用导出的 JSON：结构完整，原样收下 */
function parseOwnJson(data: unknown, serverId: string): ImportResult | null {
  const root = data as { format?: string; events?: unknown[] }
  if (root?.format !== 'n1ko-music/listening-history' || !Array.isArray(root.events)) return null

  const events: ListeningEvent[] = []
  let skipped = 0
  for (const raw of root.events) {
    const event = raw as Partial<ListeningEvent>
    if (!event?.song?.title || !event.song.artist || !isPlausibleTimestamp(Number(event.endedAt))) {
      skipped++
      continue
    }
    events.push({ ...(event as ListeningEvent), serverId: event.serverId ?? serverId })
  }
  return { events, source: 'n1ko', skipped, truncated: 0 }
}

/** ListenBrainz 导出：顶层是数组，或 { listens: [...] } */
function parseListenBrainz(data: unknown, serverId: string): ImportResult | null {
  const list = Array.isArray(data)
    ? data
    : Array.isArray((data as { listens?: unknown[] })?.listens)
      ? (data as { listens: unknown[] }).listens
      : null
  if (!list) return null

  const events: ListeningEvent[] = []
  let skipped = 0
  for (const raw of list) {
    const listen = raw as {
      listened_at?: number
      track_metadata?: {
        artist_name?: string
        track_name?: string
        release_name?: string
        additional_info?: { duration_ms?: number }
      }
    }
    const meta = listen?.track_metadata
    const endedAt = toMillis(Number(listen?.listened_at))
    if (!meta?.artist_name || !meta.track_name || !isPlausibleTimestamp(endedAt)) {
      skipped++
      continue
    }
    const durationMs = Number(meta.additional_info?.duration_ms)
    events.push(makeEvent(
      serverId, meta.artist_name, meta.track_name, meta.release_name,
      endedAt,
      Number.isFinite(durationMs) && durationMs > 0
        ? Math.round(durationMs / 1000)
        : ASSUMED_DURATION_SECONDS
    ))
  }
  // 一条都认不出来时不能算「认出了 ListenBrainz 格式」，否则会吞掉其它解析器的机会
  if (!events.length) return null
  return { events, source: 'listenbrainz', skipped, truncated: 0 }
}

/** 拆一行 CSV，认得带引号的字段和字段内的转义引号 */
export function splitCsvLine(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') { current += '"'; i++ }
        else inQuotes = false
      } else current += char
    } else if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      cells.push(current)
      current = ''
    } else current += char
  }
  cells.push(current)
  return cells
}

/**
 * 通用 CSV。
 *
 * 认两类列名：本应用导出的（isoTime/title/artist/…），以及各家 Last.fm 导出
 * 工具最常见的那几种（utc_time / track / artist）。表头认不出来就按位置猜：
 * 大多数导出都是 artist, album, track, time 这个顺序。
 */
function parseCsv(text: string, serverId: string): ImportResult | null {
  const lines = text.split(/\r?\n/).filter(line => line.trim())
  if (lines.length < 2) return null

  const header = splitCsvLine(lines[0]).map(cell => cell.trim().toLowerCase())
  const find = (...names: string[]) => {
    for (const name of names) {
      const index = header.indexOf(name)
      if (index >= 0) return index
    }
    return -1
  }

  let artistIndex = find('artist', 'artist_name', 'artistname', '歌手')
  let titleIndex = find('title', 'track', 'track_name', 'trackname', 'song', '曲名')
  let albumIndex = find('album', 'release', 'release_name', '专辑')
  let timeIndex = find('isotime', 'endedat', 'utc_time', 'uts', 'timestamp', 'date', 'listened_at', '时间')

  // 表头认不出来：按 Last.fm 导出最常见的列序猜，并把第一行也当成数据
  let dataStart = 1
  if (artistIndex < 0 && titleIndex < 0) {
    artistIndex = 0
    albumIndex = 1
    titleIndex = 2
    timeIndex = 3
    dataStart = 0
  }
  if (artistIndex < 0 || titleIndex < 0 || timeIndex < 0) return null

  const events: ListeningEvent[] = []
  let skipped = 0
  for (let i = dataStart; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i])
    const artist = cells[artistIndex]?.trim()
    const title = cells[titleIndex]?.trim()
    const rawTime = cells[timeIndex]?.trim()
    if (!artist || !title || !rawTime) { skipped++; continue }

    // 纯数字当 Unix 时间戳，否则交给 Date 解析 ISO / 常见日期串
    const numeric = Number(rawTime)
    const endedAt = Number.isFinite(numeric) && rawTime !== ''
      ? toMillis(numeric)
      : Date.parse(rawTime)
    if (!isPlausibleTimestamp(endedAt)) { skipped++; continue }

    const durationCell = find('durationseconds') >= 0
      ? Number(cells[find('durationseconds')])
      : NaN
    events.push(makeEvent(
      serverId, artist, title,
      albumIndex >= 0 ? cells[albumIndex] : undefined,
      endedAt,
      Number.isFinite(durationCell) && durationCell > 0 ? durationCell : ASSUMED_DURATION_SECONDS
    ))
  }
  if (!events.length) return null
  return { events, source: 'csv', skipped, truncated: 0 }
}

/**
 * 认出格式并解析。
 *
 * 顺序有讲究：先试结构最明确的（自家 JSON 有 format 字段），再试 ListenBrainz，
 * 最后才是 CSV 这种靠猜的。认不出来返回 null，不去硬解析一个不认识的文件。
 */
export function parseHistoryFile(text: string, serverId: string): ImportResult | null {
  const trimmed = text.trim()

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let data: unknown
    try {
      data = JSON.parse(trimmed)
    } catch {
      return null
    }
    return parseOwnJson(data, serverId) ?? parseListenBrainz(data, serverId)
  }

  return parseCsv(trimmed, serverId)
}

/** 上限截断。留最近的：越近的记录对画像和《本期》越有用。 */
export function capImport(result: ImportResult): ImportResult {
  if (result.events.length <= MAX_IMPORT_EVENTS) return result
  const sorted = [...result.events].sort((a, b) => b.endedAt - a.endedAt)
  return {
    ...result,
    events: sorted.slice(0, MAX_IMPORT_EVENTS),
    truncated: sorted.length - MAX_IMPORT_EVENTS,
  }
}
