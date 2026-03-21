/**
 * 播放器全局状态管理
 * 管理当前播放歌曲、播放队列、播放模式等
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Song } from '@/api/types'

export type RepeatMode = 'none' | 'one' | 'all'

/** 切歌防抖：记录上次切歌时间，50ms 内重复调用忽略 */
let lastSwitchTime = 0
function canSwitch(): boolean {
  const now = Date.now()
  if (now - lastSwitchTime < 50) return false
  lastSwitchTime = now
  return true
}

interface PlayerState {
  // --- 当前播放 ---
  currentSong: Song | null
  isPlaying: boolean
  currentTime: number
  duration: number
  /** 缓冲进度（0-1）*/
  buffered: number
  /** 每次调用 playSong/playQueue 时自增，用于强制触发音频引擎重新加载 */
  playVersion: number

  // --- 队列 ---
  queue: Song[]
  /** 当前在队列中的索引 */
  queueIndex: number
  /** 播放历史（用于上一首）*/
  history: Song[]

  // --- 播放设置 ---
  volume: number
  /** 是否静音 */
  muted: boolean
  /** 循环模式 */
  repeatMode: RepeatMode
  /** 是否随机播放 */
  shuffle: boolean
  /** 随机播放顺序缓存 */
  shuffledIndexes: number[]

  // --- UI 状态 ---
  /** 是否展开全屏播放器 */
  isFullscreen: boolean
  /** 是否显示播放队列抽屉 */
  isQueueOpen: boolean
  /** 是否显示歌词面板 */
  isLyricsOpen: boolean
  /** 音频流是否正在缓冲中 — 为 true 时图片组件暂停新图加载，释放连接池给 audio stream */
  streamBuffering: boolean

  // --- Actions ---
  playSong: (song: Song, queue?: Song[]) => void
  playQueue: (songs: Song[], startIndex?: number) => void
  togglePlay: () => void
  pause: () => void
  resume: () => void
  next: () => void
  prev: () => void
  seekTo: (time: number) => void
  setCurrentTime: (time: number) => void
  setDuration: (duration: number) => void
  setBuffered: (buffered: number) => void
  setVolume: (volume: number) => void
  toggleMute: () => void
  setRepeatMode: (mode: RepeatMode) => void
  toggleShuffle: () => void
  addToQueue: (songs: Song[], position?: 'next' | 'last') => void
  removeFromQueue: (index: number) => void
  clearQueue: () => void
  jumpToIndex: (index: number) => void
  setFullscreen: (open: boolean) => void
  toggleFullscreen: () => void
  setQueueOpen: (open: boolean) => void
  setLyricsOpen: (open: boolean) => void
  setStreamBuffering: (buffering: boolean) => void
  updateCurrentSong: (song: Partial<Song>) => void
}

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set, get) => ({
      // 初始状态
      currentSong: null,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      buffered: 0,
      playVersion: 0,
      queue: [],
      queueIndex: -1,
      history: [],
      volume: 0.8,
      muted: false,
      repeatMode: 'none',
      shuffle: false,
      shuffledIndexes: [],
      isFullscreen: false,
      isQueueOpen: false,
      isLyricsOpen: false,
      streamBuffering: false,

      playSong: (song, queue) => {
        const newQueue = queue ?? [song]
        const index = newQueue.findIndex(s => s.id === song.id)
        const shuffledIndexes = generateShuffledIndexes(newQueue.length, index)
        set(state => ({
          currentSong: song,
          isPlaying: true,
          currentTime: 0,
          queue: newQueue,
          queueIndex: index >= 0 ? index : 0,
          shuffledIndexes,
          playVersion: state.playVersion + 1,
        }))
      },

      playQueue: (songs, startIndex = 0) => {
        if (!songs.length) return
        const song = songs[startIndex]
        const shuffledIndexes = generateShuffledIndexes(songs.length, startIndex)
        set(state => ({
          queue: songs,
          queueIndex: startIndex,
          currentSong: song,
          isPlaying: true,
          currentTime: 0,
          shuffledIndexes,
          playVersion: state.playVersion + 1,
        }))
      },

      togglePlay: () => {
        set(state => ({ isPlaying: !state.isPlaying }))
      },

      pause: () => set({ isPlaying: false }),
      resume: () => set({ isPlaying: true }),

      next: () => {
        if (!canSwitch()) return
        const { queue, queueIndex, repeatMode, shuffle, shuffledIndexes } = get()
        if (!queue.length) return

        let nextIndex: number

        if (shuffle) {
          const currentShufflePos = shuffledIndexes.indexOf(queueIndex)
          const nextShufflePos = (currentShufflePos + 1) % shuffledIndexes.length
          nextIndex = shuffledIndexes[nextShufflePos]
        } else if (repeatMode === 'one') {
          nextIndex = queueIndex
        } else if (queueIndex < queue.length - 1) {
          nextIndex = queueIndex + 1
        } else if (repeatMode === 'all') {
          nextIndex = 0
        } else {
          // 播放完毕
          set({ isPlaying: false })
          return
        }

        set(state => ({
          currentSong: queue[nextIndex],
          queueIndex: nextIndex,
          isPlaying: true,
          currentTime: 0,
          playVersion: state.playVersion + 1,
        }))
      },

      prev: () => {
        if (!canSwitch()) return
        const { queue, queueIndex, shuffle, shuffledIndexes } = get()
        if (!queue.length) return

        // "播放超过 3 秒则重播" 的逻辑已移至 UI 层（handlePrev），
        // 因为 store 无法直接 seek 音频元素，这里只负责切到上一首

        let prevIndex: number

        if (shuffle) {
          const currentShufflePos = shuffledIndexes.indexOf(queueIndex)
          const prevShufflePos =
            (currentShufflePos - 1 + shuffledIndexes.length) % shuffledIndexes.length
          prevIndex = shuffledIndexes[prevShufflePos]
        } else {
          prevIndex = Math.max(0, queueIndex - 1)
        }

        set(state => ({
          currentSong: queue[prevIndex],
          queueIndex: prevIndex,
          isPlaying: true,
          currentTime: 0,
          playVersion: state.playVersion + 1,
        }))
      },

      seekTo: (time) => {
        set({ currentTime: time })
      },

      setCurrentTime: (time) => set({ currentTime: time }),
      setDuration: (duration) => set({ duration }),
      setBuffered: (buffered) => set({ buffered }),

      setVolume: (volume) => {
        set({ volume: Math.max(0, Math.min(1, volume)), muted: false })
      },

      toggleMute: () => set(state => ({ muted: !state.muted })),

      setRepeatMode: (mode) => set({ repeatMode: mode }),

      toggleShuffle: () => {
        const { shuffle, queue, queueIndex } = get()
        const newShuffle = !shuffle
        const shuffledIndexes = newShuffle
          ? generateShuffledIndexes(queue.length, queueIndex)
          : queue.map((_, i) => i)
        set({ shuffle: newShuffle, shuffledIndexes })
      },

      addToQueue: (songs, position = 'last') => {
        set(state => {
          if (position === 'next') {
            const newQueue = [
              ...state.queue.slice(0, state.queueIndex + 1),
              ...songs,
              ...state.queue.slice(state.queueIndex + 1),
            ]
            return { queue: newQueue }
          }
          return { queue: [...state.queue, ...songs] }
        })
      },

      removeFromQueue: (index) => {
        set(state => {
          const queue = state.queue.filter((_, i) => i !== index)
          const queueIndex =
            index < state.queueIndex
              ? state.queueIndex - 1
              : state.queueIndex
          return { queue, queueIndex: Math.max(0, queueIndex) }
        })
      },

      clearQueue: () => set({ queue: [], queueIndex: -1 }),

      jumpToIndex: (index) => {
        const { queue } = get()
        if (index < 0 || index >= queue.length) return
        set(state => ({
          currentSong: queue[index],
          queueIndex: index,
          isPlaying: true,
          currentTime: 0,
          playVersion: state.playVersion + 1,
        }))
      },

      setFullscreen: (open) => set({ isFullscreen: open }),
      toggleFullscreen: () => set(state => ({ isFullscreen: !state.isFullscreen })),
      setQueueOpen: (open) => set({ isQueueOpen: open }),
      setLyricsOpen: (open) => set({ isLyricsOpen: open }),
      setStreamBuffering: (buffering) => set({ streamBuffering: buffering }),

      updateCurrentSong: (songPatch) => {
        set(state => ({
          currentSong: state.currentSong ? { ...state.currentSong, ...songPatch } : null,
        }))
      },
    }),
    {
      name: 'msp-player-store',
      partialize: (state) => ({
        volume: state.volume,
        muted: state.muted,
        repeatMode: state.repeatMode,
        shuffle: state.shuffle,
        // 不持久化 currentSong/queue，刷新后从干净状态开始
      }),
    }
  )
)

/** 生成随机播放顺序索引数组，确保当前索引在第一位 */
function generateShuffledIndexes(length: number, currentIndex: number): number[] {
  const indexes = Array.from({ length }, (_, i) => i).filter(i => i !== currentIndex)
  // Fisher-Yates shuffle
  for (let i = indexes.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[indexes[i], indexes[j]] = [indexes[j], indexes[i]]
  }
  return [currentIndex, ...indexes]
}
