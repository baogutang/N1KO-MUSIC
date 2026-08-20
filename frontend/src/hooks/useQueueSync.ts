/**
 * 跨设备续播。
 *
 * 把队列、当前曲与毫秒级位置存到音乐服务器本身（Subsonic savePlayQueue，
 * API 1.12.0 起就有，Navidrome 已实现），换一台设备打开就能接着听。
 * 不需要自建同步后端——这个能力此前全仓零调用。
 *
 * 对一个「服务器在家、人在外面」的播放器，这是最贴题的一条：
 * 桌面听到一半出门，手机接着放。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePlayerStore } from '@/store/playerStore'
import { useServerStore } from '@/store/serverStore'
import { getAdapter, hasAdapter } from '@/api'
import type { Song } from '@/api/types'

/** 写入节流：切歌/暂停都写会打爆服务器，10 秒一次足够 */
const SAVE_INTERVAL_MS = 10_000
/** 上报的队列上限，与服务端实现留出余量 */
const MAX_SYNCED_QUEUE = 200

export interface RemoteQueueOffer {
  songs: Song[]
  currentId?: string
  positionMs: number
  changedBy?: string
}

/** 位置差异小于这个值就不值得提示「从别处继续」 */
const MIN_RESUME_POSITION_MS = 10_000

export function useQueueSync() {
  const activeServerId = useServerStore(s => s.activeServerId)
  const isConnected = useServerStore(s => s.isConnected)
  const lastSavedRef = useRef(0)
  const lastPayloadRef = useRef('')

  // --- 周期性写入 ---
  useEffect(() => {
    if (!isConnected || !activeServerId || !hasAdapter()) return
    const adapter = getAdapter()
    if (!adapter.savePlayQueue) return

    const save = () => {
      const st = usePlayerStore.getState()
      if (!st.currentSong || !st.queue.length) return
      // 只上报当前曲附近的一段，长队列没必要整个推上去
      const start = Math.max(0, st.queueIndex - 20)
      const slice = st.queue.slice(start, start + MAX_SYNCED_QUEUE)
      const ids = slice.map(s => s.id)
      if (!ids.length) return
      const positionMs = Math.round((st.currentTime || 0) * 1000)
      const payload = `${ids.length}:${st.currentSong.id}:${Math.floor(positionMs / 5000)}`
      if (payload === lastPayloadRef.current) return
      lastPayloadRef.current = payload
      lastSavedRef.current = Date.now()
      adapter.savePlayQueue?.(ids, st.currentSong.id, positionMs).catch(() => {
        // 同步失败不该影响播放，也不提示——这是后台行为
      })
    }

    const timer = setInterval(save, SAVE_INTERVAL_MS)
    // 切后台 / 关页面时补一次，否则最后十秒的进度会丢
    const flush = () => { if (document.visibilityState === 'hidden') save() }
    document.addEventListener('visibilitychange', flush)
    window.addEventListener('pagehide', save)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', flush)
      window.removeEventListener('pagehide', save)
      save()
    }
  }, [isConnected, activeServerId])
}

/**
 * 启动时读取服务端队列，判断是否值得提示「从别处继续」。
 * 与写入分开：提示是一次性的 UI 决策，不该跟着播放状态反复触发。
 */
export function useRemoteQueueOffer() {
  const activeServerId = useServerStore(s => s.activeServerId)
  const isConnected = useServerStore(s => s.isConnected)
  const [offer, setOffer] = useState<RemoteQueueOffer | null>(null)
  const checkedRef = useRef<string | null>(null)

  useEffect(() => {
    if (!isConnected || !activeServerId || !hasAdapter()) return
    if (checkedRef.current === activeServerId) return
    checkedRef.current = activeServerId

    const adapter = getAdapter()
    if (!adapter.getPlayQueue) return

    let cancelled = false
    adapter.getPlayQueue()
      .then(remote => {
        if (cancelled || !remote?.songs.length) return
        const local = usePlayerStore.getState()
        // 本地已经在放同一首且位置接近，就没有「从别处继续」这回事
        const sameSong = local.currentSong?.id === remote.currentId
        const localMs = (local.currentTime || 0) * 1000
        if (sameSong && Math.abs(localMs - remote.positionMs) < MIN_RESUME_POSITION_MS) return
        if (remote.positionMs < MIN_RESUME_POSITION_MS && sameSong) return
        setOffer(remote)
      })
      .catch(() => {})

    return () => { cancelled = true }
  }, [isConnected, activeServerId])

  const accept = useCallback(() => {
    if (!offer) return
    const index = offer.currentId
      ? Math.max(0, offer.songs.findIndex(s => s.id === offer.currentId))
      : 0
    usePlayerStore.getState().playQueue(offer.songs, index)
    // 起播后再定位，避免加载路径把位置重置为 0
    const seconds = offer.positionMs / 1000
    if (seconds > 1) {
      setTimeout(() => usePlayerStore.getState().seekTo(seconds), 400)
    }
    usePlayerStore.getState().pause()
    setOffer(null)
  }, [offer])

  const dismiss = useCallback(() => setOffer(null), [])

  return { offer, accept, dismiss }
}
