/**
 * 长音轨断点续听。
 *
 * DJ set、现场整轨、七十分钟的马勒乐章、磁带转录——这些东西一次听不完，
 * 而位置存在服务器上，换设备也能接着听。
 * `bookmarkPosition` 本来就搭在每个 Child 响应上，adapter 已经映射，
 * 此前只是没人写回去。
 *
 * 只对真正的长音轨生效：给普通三分钟的歌也存断点，只会把书签列表塞满噪音。
 */

import { useEffect, useRef } from 'react'
import { usePlayerStore } from '@/store/playerStore'
import { useServerStore } from '@/store/serverStore'
import { findAdapterFor } from '@/api'

/** 超过这个时长才算「长音轨」 */
export const LONG_TRACK_SECONDS = 20 * 60
/** 写入节流 */
const SAVE_INTERVAL_MS = 15_000
/** 距离结尾这么近就当作听完了，清掉断点而不是存一个没意义的位置 */
const NEAR_END_SECONDS = 30

export function isLongTrack(durationSeconds?: number): boolean {
  return (durationSeconds ?? 0) >= LONG_TRACK_SECONDS
}

export function useLongTrackBookmark() {
  const isConnected = useServerStore(s => s.isConnected)
  const currentSongId = usePlayerStore(s => s.currentSong?.id)
  const lastSavedRef = useRef(0)

  useEffect(() => {
    if (!isConnected) return

    /**
     * 记下最近一次看到的「哪首歌播到哪」。
     *
     * 清理时要补记的是**上一首**的位置，而换歌时 React 先提交新状态、
     * 再跑上一轮 effect 的清理——那时候现读 store 读到的已经是新歌了。
     * 所以位置要在 tick 里就存下来，清理时用存下来的这一份。
     */
    let lastSeen: { id: string; serverId: string; duration: number; seconds: number } | null = null

    // 书签存在歌曲所属的服务器上：按 serverId 找适配器，而不是默认主库
    const writeBookmark = (song: { id: string; serverId: string; duration: number }, seconds: number) => {
      const adapter = findAdapterFor(song.serverId)
      if (!adapter?.createBookmark) return
      // 快听完了就清掉，否则下次打开会提示从倒数第二分钟继续
      if (song.duration - seconds < NEAR_END_SECONDS) {
        adapter.deleteBookmark?.(song.id).catch(() => {})
        return
      }
      lastSavedRef.current = Date.now()
      adapter.createBookmark?.(song.id, Math.round(seconds * 1000)).catch(() => {})
    }

    const tick = () => {
      const st = usePlayerStore.getState()
      const song = st.currentSong
      if (!song || !isLongTrack(song.duration)) return
      const seconds = st.currentTime || 0
      if (seconds < 60) return
      lastSeen = { id: song.id, serverId: song.serverId, duration: song.duration, seconds }
      if (Date.now() - lastSavedRef.current < SAVE_INTERVAL_MS) return
      writeBookmark(song, seconds)
    }

    /** 清理时补记：用捕获到的那一份，而不是现读 store */
    const flushCapturedProgress = () => {
      if (!lastSeen) return
      writeBookmark(lastSeen, lastSeen.seconds)
      lastSeen = null
    }

    const timer = setInterval(tick, SAVE_INTERVAL_MS)
    const flush = () => { if (document.visibilityState === 'hidden') tick() }
    document.addEventListener('visibilitychange', flush)
    window.addEventListener('pagehide', tick)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', flush)
      window.removeEventListener('pagehide', tick)
      /**
       * 卸载/换歌前补记一次断点。
       *
       * 必须用 effect 里捕获到的那一份状态，不能在 tick 里现读 store：
       * 换歌时 React 先提交新状态、再跑上一轮的清理，现读读到的是**新歌**，
       * 于是旧歌的断点永远存不下来，而新歌被写进一个不属于它的位置。
       */
      flushCapturedProgress()
    }
  }, [isConnected, currentSongId])
}
