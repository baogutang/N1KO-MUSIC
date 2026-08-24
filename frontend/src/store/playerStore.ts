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

/** 一次起播的播放顺序意图。省略时沿用当前 shuffle 模式。 */
export type PlayOrder = 'sequential' | 'shuffled'

const MAX_HISTORY = 50

/**
 * 持久化队列的上限。
 *
 * 队列曾经整个写进一个 localStorage 键：加载两千首后按「播放全部」，
 * 每次切歌的写入都会超配额失败，而每次失败又触发一轮缓存回收，
 * 把封面与歌词缓存反复清空，写入却永远不会成功。
 * 这里以当前曲为中心保留一个窗口，够「关掉再打开接着听」即可。
 */
const QUEUE_PERSIST_LIMIT = 300
/** 窗口里留给「已播过」的位置，其余给未播的 */
const QUEUE_PERSIST_LOOKBEHIND = 60

/**
 * 上一次窗口计算的输入与结果。
 *
 * persistStorage 靠浅比较跳过无关写入（播放稳态下零序列化、零写入），
 * 而这个函数每次都会 slice 出新数组，等于让那条快速路径对长队列彻底失效——
 * 恰恰是它最该保护的场景。输入未变时返回同一批引用即可。
 */
let lastWindowInput: {
  queue: Song[]; queueIndex: number; shuffledIndexes: number[]
  shuffleCursor: number; shuffle: boolean
} | null = null
let lastWindowResult: {
  queue: Song[]; queueIndex: number; shuffledIndexes: number[]; shuffleCursor: number
} | null = null

/**
 * 取出可持久化的队列窗口，并把随机顺序一并重映射到窗口内下标。
 * 随机顺序必须跟着裁剪，否则恢复后下标会越界或指向错误曲目。
 */
function persistableQueueWindow(state: PlayerState): {
  queue: Song[]
  queueIndex: number
  shuffledIndexes: number[]
  shuffleCursor: number
} {
  const { queue, queueIndex, shuffledIndexes, shuffleCursor, shuffle } = state
  if (queue.length <= QUEUE_PERSIST_LIMIT) {
    return { queue, queueIndex, shuffledIndexes, shuffleCursor }
  }

  if (
    lastWindowResult &&
    lastWindowInput &&
    lastWindowInput.queue === queue &&
    lastWindowInput.queueIndex === queueIndex &&
    lastWindowInput.shuffledIndexes === shuffledIndexes &&
    lastWindowInput.shuffleCursor === shuffleCursor &&
    lastWindowInput.shuffle === shuffle
  ) {
    return lastWindowResult
  }

  const start = Math.max(
    0,
    Math.min(queueIndex - QUEUE_PERSIST_LOOKBEHIND, queue.length - QUEUE_PERSIST_LIMIT)
  )
  const end = start + QUEUE_PERSIST_LIMIT
  const sliced = queue.slice(start, end)
  const nextIndex = Math.max(0, Math.min(queueIndex - start, sliced.length - 1))
  const order = shuffle
    ? shuffledIndexes.filter(i => i >= start && i < end).map(i => i - start)
    : sliced.map((_, i) => i)
  const cursor = shuffle ? order.indexOf(nextIndex) : -1

  lastWindowInput = { queue, queueIndex, shuffledIndexes, shuffleCursor, shuffle }
  lastWindowResult = {
    queue: sliced,
    queueIndex: nextIndex,
    shuffledIndexes: order.length === sliced.length ? order : sliced.map((_, i) => i),
    shuffleCursor: order.length === sliced.length ? cursor : -1,
  }
  return lastWindowResult
}

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
  /**
   * 单曲循环的「倒带」信号。
   *
   * 和 playVersion 的区别是关键：playVersion 表示「换了一首，去重新加载」，
   * 而这个只表示「同一首，回到开头」——音频不必重下。
   */
  repeatSeekToken: number

  queue: Song[]
  queueIndex: number
  /** 跨列表播放历史（上一首回退）*/
  history: Song[]

  volume: number
  muted: boolean
  repeatMode: RepeatMode
  shuffle: boolean
  shuffledIndexes: number[]
  /** 随机序列里的当前位置。权威值，queueIndex 由它派生；关闭随机时为 -1 */
  shuffleCursor: number

  isFullscreen: boolean
  isQueueOpen: boolean
  /** 车载模式：大触控目标 + 屏幕常亮，见 components/player/CarMode.tsx */
  isCarMode: boolean
  streamBuffering: boolean

  /** 睡眠定时的截止时间戳；null 表示未设置。刻意不持久化——重启后残留的过期截止会让 App 一打开就暂停 */
  sleepTimerAt: number | null
  /** 'endOfTrack' 表示放完当前这首再停，忽略 sleepTimerAt 的精确时刻 */
  sleepTimerMode: 'duration' | 'endOfTrack'
  /**
   * 睡眠定时收尾时的临时衰减系数（0–1）。
   *
   * 刻意独立于 volume：渐弱如果直接改主音量，就会被持久化下来——
   * 定时中途关掉 App，第二天打开音量停在 5%，滑块也显示 5%，
   * 而且渐弱路径还会顺手清掉 muted，把一个特意静音的播放器轰开。
   * 这个值不进 partialize，重启即恢复为 1。
   */
  sleepFadeScalar: number

  playSong: (song: Song, queue?: Song[]) => void
  /**
   * 起播一个列表。
   * order 显式指定本次播放顺序并同步 shuffle 开关；省略时沿用当前 shuffle 模式，
   * 这样「点某一行歌曲」这类没有顺序意图的入口不会意外改变用户设定的模式。
   */
  playQueue: (songs: Song[], startIndex?: number, order?: PlayOrder) => void
  togglePlay: () => void
  pause: () => void
  resume: () => void
  /**
   * 切下一首。
   *
   * `auto` 区分意图：曲子自然播完时到队尾应当停下（那是「放完了」）；
   * 用户主动按「下一首」到队尾则应当**原地不动**——把音乐停掉不是他要的，
   * 他要的是「还有吗」，答案是没有，那就继续放着当前这首。
   */
  next: (options?: { auto?: boolean }) => void
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
  /** minutes 为 null 表示取消；mode='endOfTrack' 时放完当前曲再停 */
  setSleepTimer: (minutes: number | null, mode?: 'duration' | 'endOfTrack') => void
  addToQueue: (songs: Song[], position?: 'next' | 'last') => void
  removeFromQueue: (index: number) => void
  reorderQueue: (fromIndex: number, toIndex: number) => void
  /** 按「播放顺序」上的位置重排（随机开启时队列面板拖拽走这条） */
  reorderPlayOrder: (fromPos: number, toPos: number) => void
  clearQueue: () => void
  jumpToIndex: (index: number) => void
  setFullscreen: (open: boolean) => void
  toggleFullscreen: () => void
  setCarMode: (open: boolean) => void
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
      repeatSeekToken: 0,
      queue: [],
      queueIndex: -1,
      history: [],
      volume: 0.8,
      muted: false,
      repeatMode: 'none',
      shuffle: false,
      shuffledIndexes: [],
      shuffleCursor: -1,
      isFullscreen: false,
      isQueueOpen: false,
      isCarMode: false,
      streamBuffering: false,
      sleepTimerAt: null,
      sleepTimerMode: 'duration',
      sleepFadeScalar: 1,

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
          shuffledIndexes: state.shuffle
            ? generateShuffledIndexes(newQueue.length, index)
            : newQueue.map((_, i) => i),
          shuffleCursor: state.shuffle ? 0 : -1,
          playVersion: state.playVersion + 1,
        })
      },

      playQueue: (songs, startIndex = 0, order) => {
        if (!songs.length) return
        const state = get()
        const safeStart = Math.max(0, Math.min(startIndex, songs.length - 1))
        const song = songs[safeStart]
        // order 缺省时沿用当前模式：点单曲行不该改变用户设定的随机开关
        const shuffled = order ? order === 'shuffled' : state.shuffle
        set({
          history: appendHistory(state.history, state.currentSong),
          queue: songs,
          queueIndex: safeStart,
          currentSong: song,
          isPlaying: true,
          currentTime: 0,
          shuffle: shuffled,
          shuffledIndexes: shuffled
            ? generateShuffledIndexes(songs.length, safeStart)
            : songs.map((_, i) => i),
          shuffleCursor: shuffled ? 0 : -1,
          playVersion: state.playVersion + 1,
        })
      },

      togglePlay: () => {
        set(state => ({ isPlaying: !state.isPlaying }))
      },

      pause: () => set({ isPlaying: false }),
      resume: () => set({ isPlaying: true }),

      next: (options?: { auto?: boolean }) => {
        if (!canSwitch()) return
        const state = get()
        const { queue, queueIndex, repeatMode, shuffle, shuffledIndexes, currentSong } = state
        if (!queue.length) return

        let nextIndex: number
        let nextCursor = state.shuffleCursor
        let nextOrder: number[] | null = null

        // 单曲循环优先于 shuffle：自然播完时重播当前曲
        if (shuffle) {
          const currentShufflePos = resolveShuffleCursor(shuffledIndexes, queueIndex, state.shuffleCursor)
          const nextShufflePos = currentShufflePos + 1
          if (nextShufflePos >= shuffledIndexes.length) {
            // 随机顺序已走完：仅列表循环时开始新的一轮，否则停止播放
            if (repeatMode === 'all') {
              // 重洗而不是复刻上一轮——同一串顺序循环播放会被听成「假随机」。
              // 顺便避开新一轮首曲与刚播完的末曲相同，否则听感上是一首歌连播两遍。
              const reshuffled = generateShuffledIndexes(queue.length, -1)
              if (queue.length > 1 && reshuffled[0] === queueIndex) {
                const swap = reshuffled[0]
                reshuffled[0] = reshuffled[1]
                reshuffled[1] = swap
              }
              nextOrder = reshuffled
              nextCursor = 0
              nextIndex = reshuffled[0]
            } else {
              // 随机序列走完：自然播完就停，手动按到底则维持现状
              if (options?.auto) set({ isPlaying: false })
              return
            }
          } else {
            nextIndex = shuffledIndexes[nextShufflePos]
            nextCursor = nextShufflePos
          }
        } else if (queueIndex < queue.length - 1) {
          nextIndex = queueIndex + 1
        } else if (repeatMode === 'all') {
          nextIndex = 0
        } else {
          // 队尾：同上。用户按「下一首」不该让音乐停掉。
          if (options?.auto) set({ isPlaying: false })
          return
        }

        set({
          history: appendHistory(state.history, currentSong),
          currentSong: queue[nextIndex],
          queueIndex: nextIndex,
          isPlaying: true,
          currentTime: 0,
          playVersion: state.playVersion + 1,
          ...(nextOrder ? { shuffledIndexes: nextOrder } : null),
          ...(shuffle ? { shuffleCursor: nextCursor } : null),
        })
      },

      advanceOnEnded: () => {
        const state = get()
        // 「这首放完」的睡眠定时只在自然播完这条路径上生效。
        // 若改成监听曲目变化，用户手动按「下一首」也会被当成播完而静默停止。
        if (state.sleepTimerAt !== null && state.sleepTimerMode === 'endOfTrack') {
          set({ isPlaying: false, sleepTimerAt: null, sleepFadeScalar: 1 })
          return
        }
        if (state.repeatMode !== 'one') {
          state.next({ auto: true })
          return
        }
        if (!canSwitch() || !state.currentSong) return
        /**
         * 单曲循环不该重新加载。
         *
         * playVersion 参与 useAudioEngine 的 loadedKey，bump 一次就等于换了一首歌：
         * src 重设、重新拉流。对着家里的 NAS 单曲循环一整晚，等于把同一首歌
         * 下载几百遍；服务器开了转码的话，还要重新转码几百遍。
         *
         * 音频还在，倒回开头就够了。seekHowl 由音频引擎在 currentTime 归零时
         * 处理——这里只声明「回到 0 并继续播」，不声明「换了一首」。
         */
        set({
          isPlaying: true,
          currentTime: 0,
          repeatSeekToken: (state.repeatSeekToken ?? 0) + 1,
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
          // 按下标去重而不是按 id 过滤：同一首歌在队列里出现多次时（合辑、手动加了两遍）
          // 按 id 过滤会把它的每一次出现都抹掉。只摘掉队首那一次即可。
          const duplicateAt = queue.findIndex(s => s.id === prevSong.id)
          const rest = duplicateAt >= 0
            ? [...queue.slice(0, duplicateAt), ...queue.slice(duplicateAt + 1)]
            : queue
          const newQueue = [prevSong, ...rest]
          const newIndex = 0
          set({
            history: newHistory,
            queue: newQueue,
            queueIndex: newIndex,
            currentSong: prevSong,
            isPlaying: true,
            currentTime: 0,
            shuffledIndexes: newQueue.map((_, i) => i),
            shuffleCursor: -1,
            playVersion: state.playVersion + 1,
          })
          return
        }

        let prevIndex: number
        let prevCursor = state.shuffleCursor

        if (shuffle) {
          const currentShufflePos = resolveShuffleCursor(shuffledIndexes, queueIndex, state.shuffleCursor)
          const prevShufflePos =
            (currentShufflePos - 1 + shuffledIndexes.length) % shuffledIndexes.length
          prevIndex = shuffledIndexes[prevShufflePos]
          prevCursor = prevShufflePos
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
          ...(shuffle ? { shuffleCursor: prevCursor } : null),
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

      setSleepTimer: (minutes, mode = 'duration') => {
        // 任何一次设置/取消都把渐弱系数复位，避免残留的衰减挂在音量上
        if (mode === 'endOfTrack') {
          set({ sleepTimerAt: Date.now(), sleepTimerMode: 'endOfTrack', sleepFadeScalar: 1 })
          return
        }
        if (minutes === null || !Number.isFinite(minutes) || minutes <= 0) {
          set({ sleepTimerAt: null, sleepTimerMode: 'duration', sleepFadeScalar: 1 })
          return
        }
        set({
          sleepTimerAt: Date.now() + minutes * 60_000,
          sleepTimerMode: 'duration',
          sleepFadeScalar: 1,
        })
      },

      toggleShuffle: () => {
        const { shuffle, queue, queueIndex } = get()
        const newShuffle = !shuffle
        const shuffledIndexes = newShuffle
          ? generateShuffledIndexes(queue.length, queueIndex)
          : queue.map((_, i) => i)
        // 开启时当前曲被锚在首位，游标随之归零；关闭时游标失效
        set({ shuffle: newShuffle, shuffledIndexes, shuffleCursor: newShuffle ? 0 : -1 })
      },

      addToQueue: (songs, position = 'last') => {
        set(state => {
          if (!songs.length) return state
          if (position === 'next') {
            /**
             * 什么都没在放的时候按「下一首播放」，此前会把歌插到队尾——
             * 而队列并不在走，于是这几首既没开始播、也没有任何入口能到达，
             * 用户只会觉得这个按钮坏了。没有「当前」的时候，「下一首」
             * 唯一合理的含义就是「现在就播」。
             */
            if (state.queueIndex < 0 || state.queue.length === 0) {
              return {
                ...state,
                queue: songs,
                queueIndex: 0,
                currentSong: songs[0],
                isPlaying: true,
                currentTime: 0,
                playVersion: state.playVersion + 1,
                // 开着随机时必须真的洗牌。此前无条件用恒等序列，于是
                // 随机图标亮着、队列面板写着「随机顺序」，实际却按专辑原序播——
                // 界面在说谎。其余几个建队列的入口（playSong / playQueue /
                // toggleShuffle / 重新水合）都调 generateShuffledIndexes。
                shuffledIndexes: state.shuffle
                  ? generateShuffledIndexes(songs.length, 0)
                  : songs.map((_, i) => i),
                shuffleCursor: state.shuffle ? 0 : -1,
              }
            }
            const insertAt = state.queueIndex + 1
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
              // remapped 与原数组一一对应且顺序不变，游标位置因此不受影响
              const currentShufflePos = resolveShuffleCursor(
                remapped, state.queueIndex, state.shuffleCursor
              )
              const newIndexes = songs.map((_, i) => insertAt + i)
              shuffledIndexes = [
                ...remapped.slice(0, currentShufflePos + 1),
                ...newIndexes,
                ...remapped.slice(currentShufflePos + 1),
              ]
              return { queue: newQueue, shuffledIndexes, shuffleCursor: currentShufflePos }
            }
            return { queue: newQueue, shuffledIndexes }
          }
          const newQueue = [...state.queue, ...songs]
          let shuffledIndexes = newQueue.map((_, i) => i)
          if (state.shuffle) {
            // 保留已播放的前缀顺序，仅把新歌随机混入尚未播放的部分
            const currentShufflePos = resolveShuffleCursor(
              state.shuffledIndexes, state.queueIndex, state.shuffleCursor
            )
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
              shuffleCursor: -1,
            }
          }

          // 无损删除：不重洗随机顺序，仅移除该下标并顺移其后的下标
          const remapAfterRemoval = (indexes: number[]) =>
            indexes.filter(i => i !== index).map(i => (i > index ? i - 1 : i))

          // 被删曲目排在游标之前时，游标整体前移一位，否则会指向错误的曲目
          const removedPos = state.shuffle ? state.shuffledIndexes.indexOf(index) : -1
          const cursorBefore = state.shuffle
            ? resolveShuffleCursor(state.shuffledIndexes, state.queueIndex, state.shuffleCursor)
            : -1
          const shiftedCursor = state.shuffle && removedPos >= 0 && removedPos < cursorBefore
            ? cursorBefore - 1
            : cursorBefore

          let queueIndex = state.queueIndex
          if (index < state.queueIndex) {
            queueIndex = state.queueIndex - 1
          } else if (removedIsCurrent) {
            const remapped = state.shuffle
              ? remapAfterRemoval(state.shuffledIndexes)
              : queue.map((_, i) => i)

            let nextCursor = -1
            if (state.shuffle) {
              // 必须沿随机顺序接着播：按队列下标取会跳到随机序列的更后面，
              // 让本该稍后播放的曲目被永久跳过。
              nextCursor = removedPos >= 0
                ? Math.min(removedPos, remapped.length - 1)
                : 0
              queueIndex = remapped[nextCursor]
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
              shuffleCursor: nextCursor,
              playVersion: state.playVersion + 1,
            }
          }

          const shuffledIndexes = state.shuffle
            ? remapAfterRemoval(state.shuffledIndexes)
            : queue.map((_, i) => i)

          return { queue, queueIndex, shuffledIndexes, shuffleCursor: shiftedCursor }
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

      reorderPlayOrder: (fromPos, toPos) => {
        set(state => {
          // 关闭随机时播放顺序就是队列顺序，直接复用队列重排
          if (!state.shuffle || state.shuffledIndexes.length !== state.queue.length) {
            return state
          }
          const len = state.shuffledIndexes.length
          if (
            fromPos === toPos ||
            fromPos < 0 || toPos < 0 ||
            fromPos >= len || toPos >= len
          ) {
            return state
          }
          const order = [...state.shuffledIndexes]
          const [moved] = order.splice(fromPos, 1)
          order.splice(toPos, 0, moved)
          // 队列数组不动，只动播放顺序；游标要重新对准当前曲
          return { shuffledIndexes: order, shuffleCursor: order.indexOf(state.queueIndex) }
        })
      },

      clearQueue: () => {
        const { currentSong, shuffle } = get()
        if (!currentSong) {
          set({ queue: [], queueIndex: -1, shuffledIndexes: [], shuffleCursor: -1 })
          return
        }
        set({
          queue: [currentSong],
          queueIndex: 0,
          shuffledIndexes: [0],
          shuffleCursor: shuffle ? 0 : -1,
        })
      },

      jumpToIndex: (index) => {
        const state = get()
        const { queue, shuffle, shuffledIndexes } = state
        if (index < 0 || index >= queue.length) return

        let shuffledPatch: Partial<PlayerState> | null = null
        if (shuffle && shuffledIndexes.length === queue.length) {
          // 把目标曲从随机序列里摘出来、插到当前游标之后，再前进一步。
          // 直接改 queueIndex 会让 next() 从目标曲在随机序列里的原位置继续，
          // 中间那一大段还没播过的曲目就被永久跳过（或已播的被原样重播）。
          const cursor = resolveShuffleCursor(shuffledIndexes, state.queueIndex, state.shuffleCursor)
          const rest = shuffledIndexes.filter(i => i !== index)
          // cursor 是过滤前的位置：被摘掉的曲目若排在其前，插入点要相应前移
          const removedPos = shuffledIndexes.indexOf(index)
          const adjusted = removedPos >= 0 && removedPos <= cursor ? cursor - 1 : cursor
          const insertAt = Math.max(0, adjusted + 1)
          const reordered = [...rest.slice(0, insertAt), index, ...rest.slice(insertAt)]
          shuffledPatch = { shuffledIndexes: reordered, shuffleCursor: insertAt }
        }

        set({
          history: appendHistory(state.history, state.currentSong),
          currentSong: queue[index],
          queueIndex: index,
          isPlaying: true,
          currentTime: 0,
          playVersion: state.playVersion + 1,
          ...shuffledPatch,
        })
      },

      setFullscreen: (open) => set({ isFullscreen: open }),
      toggleFullscreen: () => set(state => ({ isFullscreen: !state.isFullscreen })),
      setCarMode: (open) => set({ isCarMode: open }),
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
          shuffleCursor: -1,
          isFullscreen: false,
          isQueueOpen: false,
          isCarMode: false,
          streamBuffering: false,
          playVersion: state.playVersion + 1,
        }))
      },
    }),
    {
      name: STORAGE_KEYS.playerStore,
      // 队列体积最大且随切歌频繁变化，用合并写入吸收连续操作
      storage: createPersistStorage({ debounceMs: 800 }),
      partialize: (state) => {
        const windowed = persistableQueueWindow(state)
        return {
          volume: state.volume,
          muted: state.muted,
          repeatMode: state.repeatMode,
          shuffle: state.shuffle,
          currentSong: state.currentSong,
          ...windowed,
        }
      },
      onRehydrateStorage: () => (state) => {
        if (!state) return
        if (state.queue.length && state.queueIndex >= 0 && state.queueIndex < state.queue.length) {
          state.currentSong = state.queue[state.queueIndex]
          const persisted = state.shuffledIndexes
          const usable =
            state.shuffle &&
            Array.isArray(persisted) &&
            persisted.length === state.queue.length &&
            // 必须是一个完整排列，否则宁可重洗也不要放一个坏顺序进去
            new Set(persisted).size === persisted.length &&
            persisted.every(i => Number.isInteger(i) && i >= 0 && i < state.queue.length)

          if (usable) {
            // 沿用上次的随机顺序与位置：重洗会让已播过的曲目回到未播池，
            // 重启一次就等于「随机重来一遍」，长队列下会反复听到同几首。
            state.shuffleCursor = resolveShuffleCursor(
              persisted, state.queueIndex, state.shuffleCursor ?? -1
            )
          } else {
            state.shuffledIndexes = state.shuffle
              ? generateShuffledIndexes(state.queue.length, state.queueIndex)
              : state.queue.map((_, i) => i)
            state.shuffleCursor = state.shuffle ? 0 : -1
          }
        } else if (state.currentSong) {
          state.queue = [state.currentSong]
          state.queueIndex = 0
          state.shuffledIndexes = [0]
          state.shuffleCursor = state.shuffle ? 0 : -1
        } else {
          state.shuffledIndexes = []
          state.shuffleCursor = -1
        }
        state.isPlaying = false
        state.currentTime = 0
      },
    }
  )
)

/**
 * 生成随机播放顺序（Fisher-Yates，无偏）。
 *
 * currentIndex >= 0 时把该曲锚定在首位——「从这首开始随机播放」的语义；
 * 传 -1 表示不锚定，用于列表循环绕回时整体重洗（此时没有「当前曲」要保留在首位）。
 */
function generateShuffledIndexes(length: number, currentIndex: number): number[] {
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
function resolveShuffleCursor(
  shuffledIndexes: number[],
  queueIndex: number,
  cursor: number
): number {
  if (cursor >= 0 && cursor < shuffledIndexes.length && shuffledIndexes[cursor] === queueIndex) {
    return cursor
  }
  return shuffledIndexes.indexOf(queueIndex)
}
