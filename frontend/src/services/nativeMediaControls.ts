/**
 * 原生媒体控制桥（仅 Capacitor 原生壳生效）
 * 把 playerStore 的播放状态同步到 capacitor-music-controls-plugin：
 * - Android：MediaStyle 前台服务通知（保证退后台音频不被挂起）
 * - iOS：MPRemoteCommandCenter 锁屏/控制中心 + AVAudioSession 后台续播
 * 事件回流：锁屏/通知上的 play/pause/next/previous/seek 调回 playerStore
 */

import { useEffect } from 'react'
import { CapacitorMusicControls } from 'capacitor-music-controls-plugin'
import { usePlayerStore } from '@/store/playerStore'
import { seekHowl } from '@/hooks/useAudioEngine'
import { findAdapterFor } from '@/api'
import { isNativePlatform } from '@/lib/platform'

/** 上一首：播放超过 3 秒重播当前歌曲（与 PlayerBar 行为一致） */
function prevWithRestart() {
  const state = usePlayerStore.getState()
  if (state.currentTime > 3) {
    seekHowl(0)
  } else {
    state.prev()
  }
}

export function useNativeMediaControls() {
  useEffect(() => {
    if (!isNativePlatform) return

    let created = false
    let lastElapsedPush = 0

    const createForCurrentSong = () => {
      const { currentSong, isPlaying, currentTime } = usePlayerStore.getState()
      if (!currentSong) return
      // 256 封面：插件会把 bitmap 两次塞进 MediaSession metadata，
      // 512 位图接近 Binder 事务上限（TransactionTooLargeException 闪退）
      const cover = currentSong.coverArt
        ? (findAdapterFor(currentSong.serverId)?.getCoverUrl(currentSong.coverArt, 256) ?? '')
        : ''
      CapacitorMusicControls.create({
        track: currentSong.title,
        artist: currentSong.artist,
        album: currentSong.album ?? '',
        cover,
        isPlaying,
        dismissable: true,
        hasPrev: true,
        hasNext: true,
        hasClose: true,
        hasScrubbing: true,
        duration: Math.round(currentSong.duration ?? 0),
        elapsed: Math.round(currentTime),
        // Android 端 MusicControlsInfos 对所有字符串键做 getString（缺键抛 JSONException，
        // create 会被 reject，通知/前台服务根本不会创建），必须全部传齐；
        // 空串走插件内置的 android.R 媒体图标兜底
        ticker: `${currentSong.title} · ${currentSong.artist}`,
        playIcon: '',
        pauseIcon: '',
        prevIcon: '',
        nextIcon: '',
        closeIcon: '',
        notificationIcon: '',
      }).then(() => {
        created = true
        lastElapsedPush = Date.now()
      }).catch(() => {})
    }

    const destroyControls = () => {
      if (!created) return
      CapacitorMusicControls.destroy()
      created = false
    }

    // 锁屏/通知事件 → 播放器动作
    const listeners: Promise<{ remove: () => void }>[] = []
    const on = (event: string, cb: (info: { position?: number }) => void) => {
      listeners.push(CapacitorMusicControls.addListener(event, cb))
    }
    on('music-controls-play', () => {
      const s = usePlayerStore.getState()
      if (!s.isPlaying) s.togglePlay()
    })
    on('music-controls-pause', () => {
      const s = usePlayerStore.getState()
      if (s.isPlaying) s.togglePlay()
    })
    on('music-controls-toggle-play-pause', () => {
      usePlayerStore.getState().togglePlay()
    })
    on('music-controls-next', () => usePlayerStore.getState().next())
    on('music-controls-previous', prevWithRestart)
    on('music-controls-seek-to', info => {
      if (typeof info?.position === 'number' && isFinite(info.position)) {
        seekHowl(info.position)
      }
    })
    // 用户划掉通知 → 暂停并销毁
    on('music-controls-destroy', () => {
      const s = usePlayerStore.getState()
      if (s.isPlaying) s.togglePlay()
      created = false
    })

    // 状态变化 → 原生控制
    const unsubscribe = usePlayerStore.subscribe((state, prev) => {
      const songChanged = state.currentSong?.id !== prev.currentSong?.id
      if (songChanged) {
        if (state.currentSong) {
          createForCurrentSong()
        } else {
          destroyControls()
        }
        return
      }
      if (!state.currentSong) return
      if (!created) {
        createForCurrentSong()
        return
      }
      if (state.isPlaying !== prev.isPlaying) {
        CapacitorMusicControls.updateIsPlaying({ isPlaying: state.isPlaying })
        CapacitorMusicControls.updateElapsed({
          elapsed: Math.round(state.currentTime),
          isPlaying: state.isPlaying,
        })
        lastElapsedPush = Date.now()
        return
      }
      // 锁屏进度条同步：播放中每 5s 节流推一次；seek 跳变立即推
      const jumped = Math.abs(state.currentTime - prev.currentTime) > 2
      const due = Date.now() - lastElapsedPush > 5000
      if (state.isPlaying && (jumped || due)) {
        CapacitorMusicControls.updateElapsed({
          elapsed: Math.round(state.currentTime),
          isPlaying: true,
        })
        lastElapsedPush = Date.now()
      }
    })

    return () => {
      unsubscribe()
      listeners.forEach(p => p.then(h => h.remove()).catch(() => {}))
      destroyControls()
    }
  }, [])
}
