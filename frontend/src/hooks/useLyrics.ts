/**
 * LRC 歌词解析器 + 同步 Hook
 *
 * 支持：
 * - 标准 LRC 格式
 * - 增强 LRC（逐字时间戳）
 * - 纯文本歌词（无时间戳）
 * - LyricLine 同步逻辑
 */

import { useMemo } from 'react'
import type { LyricLine } from '@/api/types'

// ===================================================
// LRC 解析工具
// ===================================================

/** 解析 LRC 格式文本 */
export function parseLrc(text: string): LyricLine[] {
  if (!text?.trim()) return []

  const lines: LyricLine[] = []

  // LRC 元数据标签正则：匹配 [tag] 或 [tag:value] 格式
  const metaPattern = /^\[(?:id|ar|ti|al|by|hash|sign|qq|total|offset|lang|length|desc|album|artist|title|author|maker|version|re|ve|encoding|file|rcv|usr|uid|msid|msas|mscv|msp|msu|cap|cta|cla|cla2|com|tag|instrument|role|track|lrcx)\s*(?::[^]]*)?\]$/i

  // 匹配标准时间标签 [mm:ss.xx] 或 [mm:ss.xxx]
  const timePattern = /\[(\d{1,2}):(\d{2})\.(\d{2,3})\]/g

  const rows = text.split('\n')

  for (const row of rows) {
    const trimmed = row.trim()
    if (!trimmed || metaPattern.test(trimmed)) continue

    const times: number[] = []
    let match: RegExpExecArray | null
    timePattern.lastIndex = 0

    while ((match = timePattern.exec(trimmed)) !== null) {
      const min = parseInt(match[1])
      const sec = parseInt(match[2])
      const ms = match[3].length === 2 ? parseInt(match[3]) * 10 : parseInt(match[3])
      times.push(min * 60000 + sec * 1000 + ms)
    }

    // 去除所有时间标签后的文本
    const lyricText = trimmed.replace(/\[\d{1,2}:\d{2}\.\d{2,3}\]/g, '').trim()

    if (times.length > 0 && lyricText) {
      for (const time of times) {
        lines.push({ time, text: lyricText })
      }
    } else if (times.length === 0 && lyricText) {
      // 无时间戳的纯文本行
      lines.push({ time: 0, text: lyricText })
    }
  }

  return lines.sort((a, b) => a.time - b.time)
}

/**
 * 根据当前播放时间找到当前歌词行索引
 * 使用二分查找，O(log n) 复杂度
 */
export function findCurrentLyricIndex(lines: LyricLine[], currentTimeMs: number): number {
  if (!lines.length) return -1

  let lo = 0
  let hi = lines.length - 1
  let result = -1

  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid].time <= currentTimeMs) {
      result = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }

  return result
}

// ===================================================
// useLyrics Hook
// ===================================================

interface UseLyricsOptions {
  /** 当前播放时间（秒）*/
  currentTimeSec: number
  /** 歌词行数组 */
  lines: LyricLine[]
  /** 提前高亮的偏移量（毫秒，补偿网络延迟）*/
  offset?: number
}

interface UseLyricsResult {
  /** 当前高亮行索引 */
  currentIndex: number
  /** 是否有歌词 */
  hasLyrics: boolean
  /** 是否已同步（有时间戳）*/
  isSynced: boolean
}

export function useLyrics({
  currentTimeSec,
  lines,
  offset = 0,
}: UseLyricsOptions): UseLyricsResult {
  const currentTimeMs = currentTimeSec * 1000 + offset

  const currentIndex = useMemo(() => {
    return findCurrentLyricIndex(lines, currentTimeMs)
  }, [lines, currentTimeMs])

  const hasLyrics = lines.length > 0
  const isSynced = useMemo(() => lines.some(l => l.time > 0), [lines])

  return { currentIndex, hasLyrics, isSynced }
}

// ===================================================
// 本地播放历史存储（localStorage）
// ===================================================

const HISTORY_KEY = 'msp-play-history'
const MAX_HISTORY = 500

export interface LocalHistoryEntry {
  songId: string
  title: string
  artist: string
  album: string
  coverArt?: string
  serverId?: string
  playedAt: number
  duration: number
}

export function savePlayHistory(entry: LocalHistoryEntry): void {
  try {
    const history = loadPlayHistory()
    // 避免重复：相同歌曲在 5 分钟内不重复计入
    const recent = history.find(
      h => h.songId === entry.songId && Date.now() - h.playedAt < 5 * 60 * 1000
    )
    if (recent) return

    const newHistory = [entry, ...history].slice(0, MAX_HISTORY)
    localStorage.setItem(HISTORY_KEY, JSON.stringify(newHistory))
  } catch {
    // localStorage 可能被禁用
  }
}

export function loadPlayHistory(): LocalHistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function clearPlayHistory(): void {
  localStorage.removeItem(HISTORY_KEY)
}

// ===================================================
// 听歌统计计算
// ===================================================

export interface ListeningReport {
  totalPlays: number
  totalDuration: number
  uniqueSongs: number
  topSongs: Array<{ title: string; artist: string; count: number; coverArt?: string }>
  topArtists: Array<{ artist: string; count: number; duration: number }>
  monthlyPlays: Array<{ month: string; count: number }>
}

export function computeListeningReport(
  history: LocalHistoryEntry[],
  year?: number
): ListeningReport {
  const filtered = year
    ? history.filter(h => new Date(h.playedAt).getFullYear() === year)
    : history

  const songMap = new Map<string, { title: string; artist: string; count: number; coverArt?: string }>()
  const artistMap = new Map<string, { artist: string; count: number; duration: number }>()
  const monthMap = new Map<string, number>()
  let totalDuration = 0

  for (const entry of filtered) {
    totalDuration += entry.duration

    // 歌曲统计
    const songKey = `${entry.songId}_${entry.title}`
    const songStat = songMap.get(songKey) ?? { title: entry.title, artist: entry.artist, count: 0, coverArt: entry.coverArt }
    songStat.count++
    songMap.set(songKey, songStat)

    // 歌手统计
    const artistStat = artistMap.get(entry.artist) ?? { artist: entry.artist, count: 0, duration: 0 }
    artistStat.count++
    artistStat.duration += entry.duration
    artistMap.set(entry.artist, artistStat)

    // 月份统计
    const month = new Date(entry.playedAt).toISOString().substring(0, 7)
    monthMap.set(month, (monthMap.get(month) ?? 0) + 1)
  }

  return {
    totalPlays: filtered.length,
    totalDuration,
    uniqueSongs: songMap.size,
    topSongs: Array.from(songMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 20),
    topArtists: Array.from(artistMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    monthlyPlays: Array.from(monthMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, count]) => ({ month, count })),
  }
}
