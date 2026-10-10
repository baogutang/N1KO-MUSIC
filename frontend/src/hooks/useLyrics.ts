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
import { parseLrc as parseLrcUnified } from '@/utils/lrc'

// ===================================================
// LRC 解析工具
// ===================================================

/** LRC 解析的唯一实现已抽到 utils/lrc（阶段 4.2 / F11），这里是兼容出口 */
export function parseLrc(text: string): LyricLine[] {
  return parseLrcUnified(text)
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
