/**
 * 统一播放列表操作。
 *
 * 所有「起播」都应经过这里，而不是直接调 playQueue：顺序意图必须是显式的。
 * 旧实现用 toggleShuffle() 去翻全局开关，于是「播放全部」会把用户在播放条上
 * 点亮的随机静默关掉，反过来点过一次「随机播放」之后全站每次起播都变随机。
 * 现在顺序作为一次性参数传给 playQueue，由它同步开关，不再有反向副作用。
 */
import { usePlayerStore } from '@/store/playerStore'
import { getAdapter, hasAdapter } from '@/api'
import type { Song } from '@/api/types'

/** 顺序播放列表 */
export function playAllInOrder(songs: Song[], startIndex = 0) {
  if (!songs.length) return
  usePlayerStore.getState().playQueue(songs, startIndex, 'sequential')
}

/**
 * 随机播放列表。
 * startIndex 省略或为 0 时随机挑选起始曲，避免每次都从第一首开始。
 */
export function playAllShuffled(songs: Song[], startIndex = 0) {
  if (!songs.length) return
  const start = startIndex > 0 ? startIndex : Math.floor(Math.random() * songs.length)
  usePlayerStore.getState().playQueue(songs, start, 'shuffled')
}

/**
 * 起播一个列表但不表达顺序意图：沿用用户当前的随机开关。
 * 用于「点某一行歌曲」「点专辑封面的播放键」这类入口——它们只表示
 * 「从这里开始放这批歌」，不该顺手改掉用户设定的播放模式。
 */
export function playListFrom(songs: Song[], startIndex = 0) {
  if (!songs.length) return
  usePlayerStore.getState().playQueue(songs, startIndex)
}

/** 下一首播放：插入到当前曲之后 */
export function playNextInQueue(songs: Song[]) {
  if (!songs.length) return
  usePlayerStore.getState().addToQueue(songs, 'next')
}

/** 加入队列末尾 */
export function appendToQueue(songs: Song[]) {
  if (!songs.length) return
  usePlayerStore.getState().addToQueue(songs, 'last')
}

/**
 * 全库随机播放。
 *
 * 关键点：不要对页面上「已加载的那一页」洗牌。列表页是分页加载的，
 * 首屏只有 100 首且是服务端固定排序的前 100 首，对它洗牌听感上就是
 * 「随机播放还是按排序在放」。这里改为向服务端要一批真正的随机取样。
 */
const LIBRARY_SHUFFLE_POOL = 500

export async function shuffleWholeLibrary(fallback?: Song[]): Promise<boolean> {
  if (!hasAdapter()) {
    if (fallback?.length) playAllShuffled(fallback, 0)
    return false
  }
  try {
    const pool = await getAdapter().getRandomSongs(LIBRARY_SHUFFLE_POOL)
    if (pool.length) {
      playAllShuffled(pool, 0)
      return true
    }
  } catch {
    // 服务端取样失败时退回到已加载的曲目，至少还能放出声音
  }
  if (fallback?.length) {
    playAllShuffled(fallback, 0)
    return false
  }
  return false
}
