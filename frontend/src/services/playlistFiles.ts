/**
 * 歌单与收听历史的导入导出。
 *
 * 一个自托管播放器最该保证的事是：你的东西随时能拿走。歌单走 M3U8 和 XSPF
 * 两种通用格式（前者所有播放器都认，后者能完整保留元数据），历史走 JSON 和
 * CSV（CSV 是给表格和第三方打卡导入工具用的）。
 *
 * 导出全部在浏览器里完成，不经过任何服务器。
 */

import type { Song } from '@/api/types'
import type { ListeningEvent } from '@/services/listeningHistory'

/** M3U 的 #EXTINF 时长用秒，未知写 -1 */
function extinfSeconds(song: Song): number {
  return song.duration && song.duration > 0 ? Math.round(song.duration) : -1
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * M3U8。
 *
 * 位置行写服务器上的相对路径（song.path）而不是带鉴权参数的流地址：
 * token 会过期，把它写进一个准备长期保存的文件里等于交出凭据，
 * 而路径能被同一个库的其它播放器直接认出来。
 */
export function toM3U(songs: Song[], playlistName?: string): string {
  const lines = ['#EXTM3U']
  if (playlistName) lines.push(`#PLAYLIST:${playlistName}`)
  for (const song of songs) {
    const artist = song.artist ? `${song.artist} - ` : ''
    lines.push(`#EXTINF:${extinfSeconds(song)},${artist}${song.title}`)
    lines.push(song.path || `${song.artist ?? 'Unknown'}/${song.album ?? 'Unknown'}/${song.title}`)
  }
  return lines.join('\n') + '\n'
}

/** XSPF：能带住曲名、歌手、专辑、时长和轨号，回到本 App 时信息不丢 */
export function toXSPF(songs: Song[], playlistName?: string): string {
  const tracks = songs.map(song => {
    const parts = [
      `      <location>${escapeXml(song.path || song.id)}</location>`,
      `      <title>${escapeXml(song.title)}</title>`,
    ]
    if (song.artist) parts.push(`      <creator>${escapeXml(song.artist)}</creator>`)
    if (song.album) parts.push(`      <album>${escapeXml(song.album)}</album>`)
    if (song.track) parts.push(`      <trackNum>${song.track}</trackNum>`)
    if (song.duration) parts.push(`      <duration>${Math.round(song.duration * 1000)}</duration>`)
    return `    <track>\n${parts.join('\n')}\n    </track>`
  })
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<playlist version="1" xmlns="http://xspf.org/ns/0/">',
    playlistName ? `  <title>${escapeXml(playlistName)}</title>` : '',
    '  <trackList>',
    ...tracks,
    '  </trackList>',
    '</playlist>',
    '',
  ].filter(Boolean).join('\n')
}

export interface ParsedPlaylistEntry {
  /** 文件里写的位置行，用来和库里的曲目对上 */
  location: string
  title?: string
  artist?: string
  album?: string
  durationSeconds?: number
}

/** 解析 M3U / M3U8。忽略注释行，#EXTINF 里的信息尽量带上。 */
export function parseM3U(text: string): ParsedPlaylistEntry[] {
  const out: ParsedPlaylistEntry[] = []
  let pending: Partial<ParsedPlaylistEntry> = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    if (line.startsWith('#EXTINF:')) {
      const body = line.slice('#EXTINF:'.length)
      const comma = body.indexOf(',')
      const seconds = Number(comma >= 0 ? body.slice(0, comma) : body)
      const label = comma >= 0 ? body.slice(comma + 1).trim() : ''
      const dash = label.indexOf(' - ')
      pending = {
        durationSeconds: Number.isFinite(seconds) && seconds > 0 ? seconds : undefined,
        artist: dash > 0 ? label.slice(0, dash).trim() : undefined,
        title: dash > 0 ? label.slice(dash + 3).trim() : label || undefined,
      }
      continue
    }
    if (line.startsWith('#')) continue
    out.push({ location: line, ...pending })
    pending = {}
  }
  return out
}

/** 解析 XSPF。用 DOMParser，不手搓正则。 */
export function parseXSPF(text: string): ParsedPlaylistEntry[] {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.querySelector('parsererror')) return []
  return Array.from(doc.getElementsByTagName('track')).map(track => {
    const pick = (tag: string) => track.getElementsByTagName(tag)[0]?.textContent?.trim() || undefined
    const ms = Number(pick('duration'))
    return {
      location: pick('location') ?? '',
      title: pick('title'),
      artist: pick('creator'),
      album: pick('album'),
      durationSeconds: Number.isFinite(ms) && ms > 0 ? ms / 1000 : undefined,
    }
  }).filter(entry => entry.location || entry.title)
}

/** 按扩展名或内容特征挑解析器 */
export function parsePlaylistFile(fileName: string, text: string): ParsedPlaylistEntry[] {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.xspf') || text.trimStart().startsWith('<?xml')) return parseXSPF(text)
  return parseM3U(text)
}

/**
 * 把解析结果对回库里的歌。
 *
 * 三轮匹配，一轮比一轮松：完整路径 → 文件名 →「歌手 + 曲名」。
 * 路径最可靠（同一个库导出的文件必然对得上），文件名能扛住库根目录变化，
 * 歌手加曲名则用于跨库导入。全部小写比较，避免大小写文件系统的差异。
 */
export function matchEntriesToLibrary(
  entries: ParsedPlaylistEntry[],
  library: Song[]
): { matched: Song[]; missing: ParsedPlaylistEntry[] } {
  const byPath = new Map<string, Song>()
  const byBasename = new Map<string, Song>()
  const byLabel = new Map<string, Song>()
  for (const song of library) {
    if (song.path) {
      const path = song.path.toLowerCase()
      if (!byPath.has(path)) byPath.set(path, song)
      const base = path.split(/[\\/]/).pop()
      if (base && !byBasename.has(base)) byBasename.set(base, song)
    }
    const label = `${song.artist ?? ''} ${song.title}`.toLowerCase()
    if (!byLabel.has(label)) byLabel.set(label, song)
  }

  const matched: Song[] = []
  const missing: ParsedPlaylistEntry[] = []
  for (const entry of entries) {
    const location = entry.location.toLowerCase()
    const base = location.split(/[\\/]/).pop() ?? ''
    const song =
      byPath.get(location) ??
      (base ? byBasename.get(base) : undefined) ??
      (entry.title ? byLabel.get(`${entry.artist ?? ''} ${entry.title}`.toLowerCase()) : undefined)
    if (song) matched.push(song)
    else missing.push(entry)
  }
  return { matched, missing }
}

/** 收听历史导出为 JSON：完整、可再导入 */
export function historyToJSON(events: ListeningEvent[], exportedAt: string): string {
  return JSON.stringify(
    {
      format: 'n1ko-music/listening-history',
      version: 2,
      exportedAt,
      count: events.length,
      events,
    },
    null,
    2
  )
}

function csvCell(value: string | number | undefined): string {
  const text = value == null ? '' : String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** 收听历史导出为 CSV：给表格和第三方打卡导入工具用 */
export function historyToCSV(events: ListeningEvent[]): string {
  const header = [
    'endedAt', 'isoTime', 'title', 'artist', 'album',
    'listenedSeconds', 'durationSeconds', 'outcome',
  ]
  const rows = events.map(event => [
    event.endedAt,
    new Date(event.endedAt).toISOString(),
    event.song.title,
    event.song.artist ?? '',
    event.song.album ?? '',
    Math.round(event.listenedSeconds),
    event.song.duration ?? '',
    event.outcome,
  ].map(csvCell).join(','))
  return [header.join(','), ...rows].join('\n') + '\n'
}

/** 文件名里不能出现的字符换成连字符，避免导出直接失败 */
export function safeFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[-\s]+|[-\s]+$/g, '')
  return cleaned || 'playlist'
}

/** 触发下载。整段在浏览器里完成，文件不经过任何服务器。 */
export function downloadTextFile(fileName: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  // 立刻 revoke 会让部分浏览器的下载中途断掉，留一拍
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** 一次导入最多解析多少条。再多就不是「导个歌单」而是「迁移整个库」了。 */
export const MAX_IMPORT_ENTRIES = 500
/** 并发查询数：够快，又不至于把自托管的小机器打满 */
const RESOLVE_CONCURRENCY = 4

export interface ResolveResult {
  matched: Song[]
  missing: ParsedPlaylistEntry[]
  /** 超出上限被丢掉的条数 */
  truncated: number
}

/**
 * 把解析出来的条目对回服务器上的歌。
 *
 * 不下载整个曲库再本地比对——十万首的库根本不该为了导一个歌单被拖下来一遍。
 * 改成拿每条的「歌手 曲名」去问服务端搜索，再在返回的少量候选里做严格匹配，
 * 排序和分词都交给服务端自己的索引。
 *
 * 相同查询只发一次；并发有上限；整体条数有上限。
 */
export async function resolvePlaylistEntries(
  entries: ParsedPlaylistEntry[],
  search: (query: string) => Promise<Song[]>
): Promise<ResolveResult> {
  const capped = entries.slice(0, MAX_IMPORT_ENTRIES)
  const truncated = entries.length - capped.length

  const queryOf = (entry: ParsedPlaylistEntry) =>
    [entry.title, entry.artist].filter(Boolean).join(' ').trim() ||
    (entry.location.split(/[\\/]/).pop() ?? '').replace(/\.[a-z0-9]+$/i, '')

  const uniqueQueries = Array.from(new Set(capped.map(queryOf).filter(Boolean)))
  const candidates = new Map<string, Song[]>()

  let cursor = 0
  const workers = Array.from({ length: Math.min(RESOLVE_CONCURRENCY, uniqueQueries.length) }, async () => {
    for (;;) {
      const index = cursor++
      if (index >= uniqueQueries.length) return
      const query = uniqueQueries[index]
      try {
        candidates.set(query, await search(query))
      } catch {
        // 单条查询失败不该让整次导入垮掉，这一条按「没找到」处理
        candidates.set(query, [])
      }
    }
  })
  await Promise.all(workers)

  const matched: Song[] = []
  const missing: ParsedPlaylistEntry[] = []
  for (const entry of capped) {
    const pool = candidates.get(queryOf(entry)) ?? []
    const result = matchEntriesToLibrary([entry], pool)
    if (result.matched.length) matched.push(result.matched[0])
    else missing.push(entry)
  }
  return { matched, missing, truncated }
}
