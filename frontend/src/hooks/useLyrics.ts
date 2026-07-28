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
  // 注意 [^\]] 的反斜杠不可省：JS 里 [^]] 会被解析为「任意字符 + 字面 ]」，导致多字符元数据值（如 [ar:周杰伦]）漏过滤
  const metaPattern = /^\[(?:id|ar|ti|al|by|hash|sign|qq|total|offset|lang|length|desc|album|artist|title|author|maker|version|re|ve|encoding|file|rcv|usr|uid|msid|msas|mscv|msp|msu|cap|cta|cla|cla2|com|tag|instrument|role|track|lrcx)\s*(?::[^\]]*)?\]$/i

  // [offset:±毫秒] 全局偏移标签：LRC 约定正值表示歌词提前显示（即时间戳减去偏移）
  const offsetPattern = /^\[offset:\s*([+-]?\d+)\s*\]$/i
  let lrcOffset = 0

  // 匹配标准时间标签 [mm:ss.xx] 或 [mm:ss.xxx]
  const timePattern = /\[(\d{1,2}):(\d{2})\.(\d{2,3})\]/g

  const rows = text.split('\n')

  for (const row of rows) {
    const trimmed = row.trim()
    if (!trimmed) continue

    const offsetMatch = offsetPattern.exec(trimmed)
    if (offsetMatch) {
      lrcOffset = parseInt(offsetMatch[1])
      continue
    }

    if (metaPattern.test(trimmed)) continue

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

  // 应用全局偏移（正值提前 -> 减去偏移），并保证时间不为负
  if (lrcOffset !== 0) {
    for (const line of lines) {
      line.time = Math.max(0, line.time - lrcOffset)
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
