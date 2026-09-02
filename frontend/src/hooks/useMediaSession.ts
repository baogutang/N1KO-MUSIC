/**
 * Media Session：一处实现，四个系统的媒体面板同时受益。
 *
 * 这不只是「浏览器标签页的媒体控件」——Chrome/Edge 在 Windows 上把它接到
 * SMTC，Safari 与 Chrome 在 macOS 上接到 Now Playing，Linux 桌面上接到
 * MPRIS，Android 上就是通知栏和锁屏。所以桌面端的媒体集成不需要各写一套，
 * 需要的是**把这套 API 填满**。
 *
 * 此前只填了元数据和四个按键，缺了两样最要紧的：
 *   - setPositionState：没有它，锁屏和 Now Playing 上就没有进度条，
 *     系统也不知道歌有多长；
 *   - seekto / seekbackward / seekforward：没有它，进度条即便画出来也拖不动。
 *
 * 封面也从最大 512 提到 1024：锁屏在高分屏上是整屏铺开的，512 会糊。
 */

import { useEffect, useRef } from 'react'
import { usePlayerStore } from '@/store/playerStore'
import { useSettingsStore } from '@/store/settingsStore'
import { seekHowl } from '@/hooks/useAudioEngine'
import { findAdapterFor } from '@/api'

/** 锁屏在高分屏上会把封面铺满整屏，512 明显发糊 */
const ARTWORK_SIZES = [96, 256, 512, 1024] as const

/**
 * 位置上报的最小间隔。
 *
 * timeupdate 是 5fps，而 setPositionState 每次都要跨进程通知系统媒体面板；
 * 按每秒一次上报足够让进度条走得平滑，系统自己会在两次上报之间按
 * playbackRate 外推。
 */
const POSITION_REPORT_MS = 1000

export function useMediaSession() {
  const currentSong = usePlayerStore(s => s.currentSong)
  const isPlaying = usePlayerStore(s => s.isPlaying)
  const notificationActions = useSettingsStore(s => s.notificationActions)
  const seekStep = useSettingsStore(s => s.seekStepSeconds)

  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    /**
     * 队列被清空、或断开服务器之后，系统媒体面板不能还挂着上一首。
     * 之前这里直接 return，于是那首歌会一直留在 Windows SMTC / macOS Now Playing
     * 上，按键处理器也还活着——用户在系统面板上按播放，应用里什么都没有。
     */
    if (!currentSong) {
      navigator.mediaSession.metadata = null
      navigator.mediaSession.playbackState = 'none'
      return
    }

    // 封面按歌曲来源取适配器；来源未连接时不给 artwork（系统面板显示默认占位）
    const artworkAdapter = currentSong.coverArt ? findAdapterFor(currentSong.serverId) : null
    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentSong.title,
      artist: currentSong.artist,
      album: currentSong.album,
      artwork: currentSong.coverArt && artworkAdapter
        ? ARTWORK_SIZES.map(size => ({
            src: artworkAdapter.getCoverUrl(currentSong.coverArt!, size),
            sizes: `${size}x${size}`,
            type: 'image/jpeg',
          }))
        : [],
    })
  }, [currentSong])

  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused'
  }, [isPlaying])

  /**
   * 进度上报。
   *
   * 订阅 store 而不是 useEffect 依赖 currentTime：后者会让整个 hook 以 5fps
   * 重渲染。这里只在跨过一秒边界、或者时长/倍速变了的时候才上报。
   */
  const lastReportRef = useRef(0)
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    if (typeof navigator.mediaSession.setPositionState !== 'function') return

    const report = (force = false) => {
      const state = usePlayerStore.getState()
      const duration = state.duration
      // 时长还没拿到时上报会被浏览器直接拒收（duration 必须为有限正数）
      if (!duration || !Number.isFinite(duration) || duration <= 0) return
      const now = performance.now()
      if (!force && now - lastReportRef.current < POSITION_REPORT_MS) return
      lastReportRef.current = now
      try {
        navigator.mediaSession.setPositionState({
          duration,
          // 倍速在 settingsStore 上（有声书 / 讲座场景），系统据此在两次上报
          // 之间外推进度；报错了进度条会走得比实际慢或快
          playbackRate: useSettingsStore.getState().playbackRate || 1,
          // position 超出 duration 会抛 TypeError，切歌瞬间真的会撞上
          position: Math.min(Math.max(0, state.currentTime), duration),
        })
      } catch {
        // 各家实现对边界值的容忍度不一，报不上去就跳过这一次
      }
    }

    report(true)
    const unsubscribe = usePlayerStore.subscribe(() => report())
    return () => {
      unsubscribe()
      try {
        navigator.mediaSession.setPositionState(undefined)
      } catch {
        // 忽略
      }
    }
  }, [currentSong?.id])

  // 按键处理器。用 getState() 取最新引用，只在「按键配置变了」时才重注册。
  useEffect(() => {
    if (!('mediaSession' in navigator)) return

    const store = usePlayerStore.getState
    /** 设过的处理器都记下来，卸载时逐个清空——留着会指向已卸载的组件 */
    const registered: MediaSessionAction[] = []
    const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler)
        if (handler) registered.push(action)
      } catch {
        // 该动作本浏览器不支持，跳过即可
      }
    }

    set('play', () => store().resume())
    set('pause', () => store().pause())
    set('stop', () => store().pause())

    if (notificationActions !== 'seek') {
      set('nexttrack', () => store().next())
      set('previoustrack', () => {
        const state = store()
        // 播过 3 秒以上时，「上一首」先回到本曲开头——和实体播放器一致
        if (state.currentTime > 3) seekHowl(0)
        else state.prev()
      })
    } else {
      set('nexttrack', null)
      set('previoustrack', null)
    }

    if (notificationActions !== 'track') {
      set('seekbackward', details => {
        const step = details.seekOffset ?? seekStep
        seekHowl(Math.max(0, store().currentTime - step))
      })
      set('seekforward', details => {
        const step = details.seekOffset ?? seekStep
        const state = store()
        seekHowl(Math.min(state.duration || Infinity, state.currentTime + step))
      })
    } else {
      set('seekbackward', null)
      set('seekforward', null)
    }

    // 拖动系统进度条。fastSeek 由系统给出，这里没有独立的快速通道，按普通 seek 处理。
    set('seekto', details => {
      if (typeof details.seekTime === 'number') seekHowl(details.seekTime)
    })

    return () => {
      for (const action of registered) {
        try {
          navigator.mediaSession.setActionHandler(action, null)
        } catch {
          // 某些浏览器不接受 null 清理
        }
      }
    }
  }, [notificationActions, seekStep])
}
