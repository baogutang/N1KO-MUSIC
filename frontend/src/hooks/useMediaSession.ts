/**
 * Media Session API Hook
 * 让浏览器媒体控件和系统级通知显示当前播放信息
 *
 * 性能优化：使用细粒度 selector 订阅 store，
 * 避免 currentTime 等高频字段变化导致整个 hook 重渲染
 */

import { useEffect } from 'react'
import { usePlayerStore } from '@/store/playerStore'
import { seekHowl } from '@/hooks/useAudioEngine'
import { getAdapter, hasAdapter } from '@/api'

export function useMediaSession() {
  // 细粒度 selector — 只订阅实际使用的字段
  const currentSong = usePlayerStore(s => s.currentSong)
  const isPlaying   = usePlayerStore(s => s.isPlaying)

  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    if (!currentSong) return

    // 更新媒体元数据
    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentSong.title,
      artist: currentSong.artist,
      album: currentSong.album,
      artwork: currentSong.coverArt && hasAdapter()
        ? [
            {
              src: getAdapter().getCoverUrl(currentSong.coverArt, 96),
              sizes: '96x96',
              type: 'image/jpeg',
            },
            {
              src: getAdapter().getCoverUrl(currentSong.coverArt, 256),
              sizes: '256x256',
              type: 'image/jpeg',
            },
            {
              src: getAdapter().getCoverUrl(currentSong.coverArt, 512),
              sizes: '512x512',
              type: 'image/jpeg',
            },
          ]
        : [],
    })
  }, [currentSong])

  useEffect(() => {
    if (!('mediaSession' in navigator)) return

    // 更新播放状态
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused'
  }, [isPlaying])

  // 媒体控件处理器 — 只注册一次，通过 getState() 获取最新 action 引用
  useEffect(() => {
    if (!('mediaSession' in navigator)) return

    const store = usePlayerStore.getState
    navigator.mediaSession.setActionHandler('play', () => store().resume())
    navigator.mediaSession.setActionHandler('pause', () => store().pause())
    navigator.mediaSession.setActionHandler('nexttrack', () => store().next())
    navigator.mediaSession.setActionHandler('previoustrack', () => {
      const state = store()
      if (state.currentTime > 3) {
        seekHowl(0)
      } else {
        state.prev()
      }
    })
    navigator.mediaSession.setActionHandler('stop', () => store().pause())

    return () => {
      const actions = ['play', 'pause', 'nexttrack', 'previoustrack', 'stop'] as const
      for (const action of actions) {
        try {
          navigator.mediaSession.setActionHandler(action, null)
        } catch {
          // 某些浏览器不支持 null 清理
        }
      }
    }
  }, []) // 空依赖：通过 getState() 始终拿到最新引用，无需重注册
}
