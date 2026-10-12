/**
 * 队列下标 / 洗牌的纯函数（阶段 5：从 playerStore 抽出，行为不变）。
 *
 * 这些是随机播放的全部数学：生成随机序列（当前曲锚定在首位）、游标自愈、
 * 历史去重回插。抽出后可在不渲染 store 的情况下验证。
 */
import type { Song } from '@/api/types'

/**
 * 生成 [0, length) 的随机序列。currentIndex >= 0 时把当前曲固定在首位
 * （正在放的这首不能被洗到后面去——它已经播过了）。
 */
export function generateShuffledIndexes(length: number, currentIndex: number): number[] {
  if (length <= 0) return []
  const anchored = currentIndex >= 0
  const safeCurrent = anchored ? Math.min(currentIndex, length - 1) : -1
  const indexes = Array.from({ length }, (_, i) => i).filter(i => i !== safeCurrent)
  for (let i = indexes.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[indexes[i], indexes[j]] = [indexes[j], indexes[i]]
  }
  return anchored ? [safeCurrent, ...indexes] : indexes
}

/**
 * 随机游标自愈。
 *
 * shuffleCursor 是随机序列里的权威位置，queueIndex 由它派生。但外部可能直接
 * setState（测试、旧版本持久化数据）而不带游标，此时回退到按下标反查——即旧行为。
 * 反查会让 jumpToIndex 之后的 next() 跳到目标曲在随机序列里的原位置，
 * 从而永久跳过中间未播的一段，所以正常路径必须让游标保持权威。
 */
export function resolveShuffleCursor(
  shuffledIndexes: number[],
  queueIndex: number,
  cursor: number
): number {
  if (cursor >= 0 && cursor < shuffledIndexes.length && shuffledIndexes[cursor] === queueIndex) {
    return cursor
  }
  return shuffledIndexes.indexOf(queueIndex)
}

/** 上一首历史追加（null 安全）。 */
export function appendHistory(history: Song[], song: Song | null): Song[] {
  return song ? [song, ...history] : history
}
