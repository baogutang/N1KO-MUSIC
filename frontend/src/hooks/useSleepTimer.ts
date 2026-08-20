/**
 * 睡眠定时。
 *
 * 到点前最后几秒渐弱再暂停，而不是硬切——在延音上突然静音是最刺耳的收尾方式。
 * 定时状态刻意不持久化：重启后残留的过期截止时间会让 App 一打开就暂停。
 */

import { useEffect } from 'react'
import { usePlayerStore } from '@/store/playerStore'
import { useSettingsStore } from '@/store/settingsStore'

/** 最后这段时间用于渐弱 */
const FADE_MS = 8000

export function useSleepTimer() {
  const sleepTimerAt = usePlayerStore(s => s.sleepTimerAt)
  const sleepTimerMode = usePlayerStore(s => s.sleepTimerMode)
  const smooth = useSettingsStore(s => s.smoothTransitions)

  useEffect(() => {
    if (sleepTimerAt === null) return

    // 「放完这首再停」由播放结束时判定，不看时刻
    if (sleepTimerMode === 'endOfTrack') {
      const unsubscribe = usePlayerStore.subscribe((state, prev) => {
        // 曲目发生了变化（自然播完进入下一首）就在此刻停下
        if (state.currentSong?.id !== prev.currentSong?.id) {
          usePlayerStore.setState({ isPlaying: false, sleepTimerAt: null })
        }
      })
      return unsubscribe
    }

    let faded = false
    const tick = () => {
      const remaining = sleepTimerAt - Date.now()
      if (remaining <= 0) {
        const store = usePlayerStore.getState()
        store.pause()
        usePlayerStore.setState({ sleepTimerAt: null })
        // 暂停后把音量还原，否则下次播放是静音的
        if (faded) store.setVolume(volumeBeforeFade)
        return
      }
      if (smooth && !faded && remaining <= FADE_MS) {
        faded = true
        volumeBeforeFade = usePlayerStore.getState().volume
      }
      if (faded) {
        const ratio = Math.max(0, Math.min(1, remaining / FADE_MS))
        usePlayerStore.getState().setVolume(volumeBeforeFade * ratio)
      }
    }

    let volumeBeforeFade = usePlayerStore.getState().volume
    const timer = setInterval(tick, 500)
    return () => {
      clearInterval(timer)
      // 定时被取消时把音量还原
      if (faded) usePlayerStore.getState().setVolume(volumeBeforeFade)
    }
  }, [sleepTimerAt, sleepTimerMode, smooth])
}
