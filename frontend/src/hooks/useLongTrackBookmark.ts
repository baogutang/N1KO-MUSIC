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
import { getAdapter, hasAdapter } from '@/api'

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
  const activeServerId = useServerStore(s => s.activeServerId)
  const isConnected = useServerStore(s => s.isConnected)
  const currentSongId = usePlayerStore(s => s.currentSong?.id)
  const lastSavedRef = useRef(0)

  useEffect(() => {
    if (!isConnected || !activeServerId || !hasAdapter()) return
    const adapter = getAdapter()
    if (!adapter.createBookmark) return

    const tick = () => {
      const st = usePlayerStore.getState()
      const song = st.currentSong
      if (!song || !isLongTrack(song.duration)) return
      const seconds = st.currentTime || 0
      if (seconds < 60) return

      // 快听完了就清掉，否则下次打开会提示从倒数第二分钟继续
      if (song.duration - seconds < NEAR_END_SECONDS) {
        adapter.deleteBookmark?.(song.id).catch(() => {})
        return
      }
      if (Date.now() - lastSavedRef.current < SAVE_INTERVAL_MS) return
      lastSavedRef.current = Date.now()
      adapter.createBookmark?.(song.id, Math.round(seconds * 1000)).catch(() => {})
    }

    const timer = setInterval(tick, SAVE_INTERVAL_MS)
    const flush = () => { if (document.visibilityState === 'hidden') tick() }
    document.addEventListener('visibilitychange', flush)
    window.addEventListener('pagehide', tick)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', flush)
      window.removeEventListener('pagehide', tick)
      tick()
    }
  }, [isConnected, activeServerId, currentSongId])
}
