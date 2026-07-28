/**
 * 播放器全局状态管理
 * 管理当前播放歌曲、播放队列、播放模式等
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createPersistStorage } from '@/store/persistStorage'
import { STORAGE_KEYS } from '@/services/storageKeys'
import type { Song } from '@/api/types'

export type RepeatMode = 'none' | 'one' | 'all'

const MAX_HISTORY = 50

/** 切歌防抖：记录上次切歌时间，50ms 内重复调用忽略 */
let lastSwitchTime = 0
function canSwitch(): boolean {
  const now = Date.now()
  if (now - lastSwitchTime < 50) return false
  lastSwitchTime = now
  return true
}

function appendHistory(history: Song[], song: Song | null): Song[] {
  if (!song) return history
  const filtered = history.filter(s => s.id !== song.id)
  return [song, ...filtered].slice(0, MAX_HISTORY)
}

interface PlayerState {
  currentSong: Song | null
  isPlaying: boolean
  currentTime: number
  duration: number
  buffered: number
  playVersion: number

  queue: Song[]
  queueIndex: number
  /** 跨列表播放历史（上一首回退）*/
  history: Song[]

  volume: number
  muted: boolean
  repeatMode: RepeatMode
  shuffle: boolean
  shuffledIndexes: number[]

  isFullscreen: boolean
  isQueueOpen: boolean
  streamBuffering: boolean

  playSong: (song: Song, queue?: Song[]) => void
  playQueue: (songs: Song[], startIndex?: number) => void
  togglePlay: () => void
  pause: () => void
  resume: () => void
  next: () => void
  /** 自然播放结束时前进；单曲循环只在此路径生效 */
  advanceOnEnded: () => void
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
  reorderQueue: (fromIndex: number, toIndex: number) => void
  clearQueue: () => void
  jumpToIndex: (index: number) => void
  setFullscreen: (open: boolean) => void
  toggleFullscreen: () => void
  setQueueOpen: (open: boolean) => void
  setStreamBuffering: (buffering: boolean) => void
  updateCurrentSong: (song: Partial<Song>) => void
  /** 切换/断开服务器时清空所有与旧服务器绑定的播放状态 */
  resetForServerChange: () => void
}

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set, get) => ({
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
      streamBuffering: false,

      playSong: (song, queue) => {
        const state = get()
        const provided = queue ?? [song]
        const found = provided.findIndex(s => s.id === song.id)
        // 歌曲不在传入队列里时把它插到队首，否则 currentSong 与 queue[queueIndex]
        // 不一致，首次 next() 会跳过队列第一首。
        const newQueue = found >= 0 ? provided : [song, ...provided]
        const index = found >= 0 ? found : 0
        set({
          history: appendHistory(state.history, state.currentSong),
          currentSong: song,
          isPlaying: true,
          currentTime: 0,
          queue: newQueue,
          queueIndex: index,
          shuffledIndexes: generateShuffledIndexes(newQueue.length, index),
          playVersion: state.playVersion + 1,
        })
      },

      playQueue: (songs, startIndex = 0) => {
        if (!songs.length) return
        const state = get()
        const song = songs[startIndex]
        const shuffledIndexes = generateShuffledIndexes(songs.length, startIndex)
        set({
          history: appendHistory(state.history, state.currentSong),
          queue: songs,
          queueIndex: startIndex,
          currentSong: song,
          isPlaying: true,
          currentTime: 0,
          shuffledIndexes,
          playVersion: state.playVersion + 1,
        })
      },

      togglePlay: () => {
        set(state => ({ isPlaying: !state.isPlaying }))
      },

      pause: () => set({ isPlaying: false }),
      resume: () => set({ isPlaying: true }),

      next: () => {
        if (!canSwitch()) return
        const state = get()
        const { queue, queueIndex, repeatMode, shuffle, shuffledIndexes, currentSong } = state
        if (!queue.length) return

        let nextIndex: number

        // 单曲循环优先于 shuffle：自然播完时重播当前曲
        if (shuffle) {
          const currentShufflePos = shuffledIndexes.indexOf(queueIndex)
          const nextShufflePos = currentShufflePos + 1
          if (nextShufflePos >= shuffledIndexes.length) {
            // 随机顺序已走完：仅列表循环时回到随机序列开头，否则停止播放
            if (repeatMode === 'all') {
              nextIndex = shuffledIndexes[0]
            } else {
              set({ isPlaying: false })
              return
            }
          } else {
            nextIndex = shuffledIndexes[nextShufflePos]
          }
        } else if (queueIndex < queue.length - 1) {
          nextIndex = queueIndex + 1
        } else if (repeatMode === 'all') {
          nextIndex = 0
        } else {
          set({ isPlaying: false })
          return
        }

        set({
          history: appendHistory(state.history, currentSong),
          currentSong: queue[nextIndex],
          queueIndex: nextIndex,
          isPlaying: true,
          currentTime: 0,
          playVersion: state.playVersion + 1,
        })
      },

      advanceOnEnded: () => {
        const state = get()
        if (state.repeatMode !== 'one') {
          state.next()
          return
        }
        if (!canSwitch() || !state.currentSong) return
        set({
          currentSong: state.currentSong,
          isPlaying: true,
          currentTime: 0,
          playVersion: state.playVersion + 1,
        })
      },

      prev: () => {
        if (!canSwitch()) return
        const state = get()
        const { queue, queueIndex, shuffle, shuffledIndexes, history, currentSong } = state
        if (!queue.length) return

        if (!shuffle && queueIndex === 0 && history.length > 0) {
          const prevSong = history[0]
          const newHistory = history.slice(1)
          const newQueue = [prevSong, ...queue.filter(s => s.id !== prevSong.id)]
          const newIndex = 0
          set({
            history: newHistory,
            queue: newQueue,
            queueIndex: newIndex,
            currentSong: prevSong,
            isPlaying: true,
            currentTime: 0,
            shuffledIndexes: generateShuffledIndexes(newQueue.length, newIndex),
            playVersion: state.playVersion + 1,
          })
          return
        }

        let prevIndex: number

        if (shuffle) {
          const currentShufflePos = shuffledIndexes.indexOf(queueIndex)
          const prevShufflePos =
            (currentShufflePos - 1 + shuffledIndexes.length) % shuffledIndexes.length
          prevIndex = shuffledIndexes[prevShufflePos]
        } else if (queueIndex === 0 && state.repeatMode === 'all') {
          // 列表循环模式下（且无历史可回退）从第一首回绕到最后一首
          prevIndex = queue.length - 1
        } else {
          prevIndex = Math.max(0, queueIndex - 1)
        }

        set({
          history: appendHistory(state.history, currentSong),
          currentSong: queue[prevIndex],
          queueIndex: prevIndex,
          isPlaying: true,
          currentTime: 0,
          playVersion: state.playVersion + 1,
        })
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
          if (!songs.length) return state
          if (position === 'next') {
            const insertAt = state.queueIndex >= 0 ? state.queueIndex + 1 : state.queue.length
            const newQueue = [
              ...state.queue.slice(0, insertAt),
              ...songs,
              ...state.queue.slice(insertAt),
            ]
            // 关闭随机时保持恒等映射，与 removeFromQueue/reorderQueue 一致，
            // 否则会留下长度过短的旧数组
            let shuffledIndexes = newQueue.map((_, i) => i)
            if (state.shuffle) {
              // 保持既有随机顺序：把新歌插到当前曲的随机位置之后，而不是整体重洗
              const remapped = state.shuffledIndexes.map(i =>
                i >= insertAt ? i + songs.length : i
              )
              const currentShufflePos = remapped.indexOf(state.queueIndex)
              const newIndexes = songs.map((_, i) => insertAt + i)
              shuffledIndexes = [
                ...remapped.slice(0, currentShufflePos + 1),
                ...newIndexes,
                ...remapped.slice(currentShufflePos + 1),
              ]
            }
            return { queue: newQueue, shuffledIndexes }
          }
          const newQueue = [...state.queue, ...songs]
          let shuffledIndexes = newQueue.map((_, i) => i)
          if (state.shuffle) {
            // 保留已播放的前缀顺序，仅把新歌随机混入尚未播放的部分
            const currentShufflePos = state.shuffledIndexes.indexOf(state.queueIndex)
            const playedPrefix = state.shuffledIndexes.slice(0, currentShufflePos + 1)
            const upcoming = [
              ...state.shuffledIndexes.slice(currentShufflePos + 1),
              ...songs.map((_, i) => state.queue.length + i),
            ]
            for (let i = upcoming.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1))
              ;[upcoming[i], upcoming[j]] = [upcoming[j], upcoming[i]]
            }
            shuffledIndexes = [...playedPrefix, ...upcoming]
          }
          return { queue: newQueue, shuffledIndexes }
        })
      },

      removeFromQueue: (index) => {
        set(state => {
          if (index < 0 || index >= state.queue.length) return state
          const removedIsCurrent = index === state.queueIndex
          const queue = state.queue.filter((_, i) => i !== index)

          if (!queue.length) {
            return {
              queue: [],
              queueIndex: -1,
              currentSong: null,
              isPlaying: false,
              currentTime: 0,
              shuffledIndexes: [],
            }
          }

          // 无损删除：不重洗随机顺序，仅移除该下标并顺移其后的下标
          const remapAfterRemoval = (indexes: number[]) =>
            indexes.filter(i => i !== index).map(i => (i > index ? i - 1 : i))

          let queueIndex = state.queueIndex
          if (index < state.queueIndex) {
            queueIndex = state.queueIndex - 1
          } else if (removedIsCurrent) {
            const remapped = state.shuffle
              ? remapAfterRemoval(state.shuffledIndexes)
              : queue.map((_, i) => i)

            if (state.shuffle) {
              // 必须沿随机顺序接着播：按队列下标取会跳到随机序列的更后面，
              // 让本该稍后播放的曲目被永久跳过。
              const removedShufflePos = state.shuffledIndexes.indexOf(index)
              const nextPos = removedShufflePos >= 0
                ? Math.min(removedShufflePos, remapped.length - 1)
                : 0
              queueIndex = remapped[nextPos]
            } else {
              queueIndex = Math.min(index, queue.length - 1)
            }

            return {
              queue,
              queueIndex,
              currentSong: queue[queueIndex],
              isPlaying: state.isPlaying,
              currentTime: 0,
              shuffledIndexes: remapped,
              playVersion: state.playVersion + 1,
            }
          }

          const shuffledIndexes = state.shuffle
            ? remapAfterRemoval(state.shuffledIndexes)
            : queue.map((_, i) => i)

          return { queue, queueIndex, shuffledIndexes }
        })
      },

      reorderQueue: (fromIndex, toIndex) => {
        set(state => {
          if (
            fromIndex === toIndex ||
            fromIndex < 0 ||
            toIndex < 0 ||
            fromIndex >= state.queue.length ||
            toIndex >= state.queue.length
          ) {
            return state
          }
          const queue = [...state.queue]
          const [moved] = queue.splice(fromIndex, 1)
          queue.splice(toIndex, 0, moved)

          // 与 queueIndex 相同的移动映射：随机顺序无损跟随队列重排，不重洗
          const mapMovedIndex = (i: number) => {
            if (i === fromIndex) return toIndex
            if (fromIndex < i && toIndex >= i) return i - 1
            if (fromIndex > i && toIndex <= i) return i + 1
            return i
          }

          const queueIndex = mapMovedIndex(state.queueIndex)

          const shuffledIndexes = state.shuffle
            ? state.shuffledIndexes.map(mapMovedIndex)
            : queue.map((_, i) => i)

          return { queue, queueIndex, shuffledIndexes }
        })
      },

      clearQueue: () => {
        const { currentSong, queueIndex } = get()
        if (!currentSong) {
          set({ queue: [], queueIndex: -1, shuffledIndexes: [] })
          return
        }
        set({
          queue: [currentSong],
          queueIndex: 0,
          shuffledIndexes: [0],
        })
      },

      jumpToIndex: (index) => {
        const state = get()
        const { queue } = state
        if (index < 0 || index >= queue.length) return
        set({
          history: appendHistory(state.history, state.currentSong),
          currentSong: queue[index],
          queueIndex: index,
          isPlaying: true,
          currentTime: 0,
          playVersion: state.playVersion + 1,
        })
      },

      setFullscreen: (open) => set({ isFullscreen: open }),
      toggleFullscreen: () => set(state => ({ isFullscreen: !state.isFullscreen })),
      setQueueOpen: (open) => set({ isQueueOpen: open }),
      setStreamBuffering: (buffering) => set({ streamBuffering: buffering }),

      updateCurrentSong: (songPatch) => {
        set(state => ({
          currentSong: state.currentSong ? { ...state.currentSong, ...songPatch } : null,
        }))
      },

      resetForServerChange: () => {
        set(state => ({
          currentSong: null,
          isPlaying: false,
          currentTime: 0,
          duration: 0,
          buffered: 0,
          queue: [],
          queueIndex: -1,
          history: [],
          shuffledIndexes: [],
          isFullscreen: false,
          isQueueOpen: false,
          streamBuffering: false,
          playVersion: state.playVersion + 1,
        }))
      },
    }),
    {
      name: STORAGE_KEYS.playerStore,
      // 队列体积最大且随切歌频繁变化，用合并写入吸收连续操作
      storage: createPersistStorage({ debounceMs: 800 }),
      partialize: (state) => ({
        volume: state.volume,
        muted: state.muted,
        repeatMode: state.repeatMode,
        shuffle: state.shuffle,
        currentSong: state.currentSong,
        queue: state.queue,
        queueIndex: state.queueIndex,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return
        if (state.queue.length && state.queueIndex >= 0 && state.queueIndex < state.queue.length) {
          state.currentSong = state.queue[state.queueIndex]
          state.shuffledIndexes = state.shuffle
            ? generateShuffledIndexes(state.queue.length, state.queueIndex)
            : state.queue.map((_, i) => i)
        } else if (state.currentSong) {
          state.queue = [state.currentSong]
          state.queueIndex = 0
          state.shuffledIndexes = [0]
        }
        state.isPlaying = false
        state.currentTime = 0
      },
    }
  )
)

function generateShuffledIndexes(length: number, currentIndex: number): number[] {
  if (length <= 0) return []
  const safeCurrent = Math.max(0, Math.min(currentIndex, length - 1))
  const indexes = Array.from({ length }, (_, i) => i).filter(i => i !== safeCurrent)
  for (let i = indexes.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[indexes[i], indexes[j]] = [indexes[j], indexes[i]]
  }
  return [safeCurrent, ...indexes]
}
