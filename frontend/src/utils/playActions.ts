/**
 * 统一播放列表操作：顺序播放 vs 随机播放（shuffle 模式）
 */
import { usePlayerStore } from '@/store/playerStore'
import type { Song } from '@/api/types'

function ensureShuffle(enabled: boolean) {
  const { shuffle, toggleShuffle } = usePlayerStore.getState()
  if (shuffle !== enabled) toggleShuffle()
}

/** 顺序播放列表（关闭 shuffle）*/
export function playAllInOrder(songs: Song[], startIndex = 0) {
  if (!songs.length) return
  ensureShuffle(false)
  usePlayerStore.getState().playQueue(songs, startIndex)
}

/**
 * 随机播放列表（开启 shuffle，由 store 生成随机顺序）
 * startIndex 省略或为 0 时随机挑选起始曲，避免每次都从第一首开始
 */
export function playAllShuffled(songs: Song[], startIndex = 0) {
  if (!songs.length) return
  ensureShuffle(true)
  const start = startIndex > 0 ? startIndex : Math.floor(Math.random() * songs.length)
  usePlayerStore.getState().playQueue(songs, start)
}

/** 下一首播放：插入到当前曲之后 */
export function playNextInQueue(songs: Song[]) {
  if (!songs.length) return
  usePlayerStore.getState().addToQueue(songs, 'next')
}
