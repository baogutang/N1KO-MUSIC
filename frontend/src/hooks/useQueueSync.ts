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
import { getAudioCurrentTime, seekHowl } from '@/hooks/useAudioEngine'
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
  /** 本次会话是否真正播放过（而不是仅仅恢复了上次的队列） */
  const hasPlayedRef = useRef(false)

  useEffect(() => {
    // isPlaying 第一次为真，或位置真的走动过，才算「播过」
    const unsubscribe = usePlayerStore.subscribe(state => {
      if (!hasPlayedRef.current && (state.isPlaying || (state.currentTime ?? 0) > 1)) {
        hasPlayedRef.current = true
      }
    })
    return unsubscribe
  }, [])

  // --- 周期性写入 ---
  useEffect(() => {
    // TODO(sources): 队列混源后的续播语义（跨源队列存不进单一服务器）需要单独设计；
    // 当前只把「主库自己的歌」写回主库，语义等同于旧的单服务器行为
    if (!isConnected || !activeServerId || !hasAdapter()) return
    const adapter = getAdapter()
    if (!adapter.savePlayQueue) return

    const save = () => {
      const st = usePlayerStore.getState()
      if (!st.currentSong || !st.queue.length) return
      // 只在本次会话真正播放过之后才上报。
      // 启动时 onRehydrateStorage 会恢复上次的队列并把 currentTime 置 0，
      // 若此时就写回去，等于「在另一台设备上打开一下」就把那边的续播点抹成 0——
      // 而这恰恰是这个功能存在的场景。
      if (!hasPlayedRef.current) return
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

    // 定位必须走 seekHowl：store 的 seekTo 只改状态，不会移动 audio 元素，
    // 进度条会先跳到目标位置再被 timeupdate 拉回 0，看起来就是「没生效」。
    // 而且要等音频真的可以定位（转码流的 seekable 随缓冲增长），
    // 所以这里等 canplay 而不是拍一个固定延时。
    const seconds = offer.positionMs / 1000
    if (seconds > 1) {
      let attempts = 0
      const trySeek = () => {
        attempts += 1
        seekHowl(seconds)
        // 转码流的 seekable 随缓冲增长，一次不一定落得到位，最多重试约 2 秒
        if (Math.abs(getAudioCurrentTime() - seconds) > 2 && attempts < 10) {
          setTimeout(trySeek, 200)
        }
      }
      setTimeout(trySeek, 300)
    }
    setOffer(null)
  }, [offer])

  const dismiss = useCallback(() => setOffer(null), [])

  return { offer, accept, dismiss }
}
