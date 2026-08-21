/**
 * 睡眠定时。
 *
 * 到点前最后几秒渐弱再暂停，而不是硬切。渐弱通过 playerStore 上一个
 * 不持久化的 sleepFadeScalar 生效——绝不能去改主音量：那会被持久化下来，
 * 第二天打开发现音量停在 5%，而且顺手清掉 muted 会把静音的播放器轰开。
 *
 * 定时状态本身也刻意不持久化：重启后残留的过期截止会让 App 一打开就暂停。
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

    // 「放完这首再停」由 advanceOnEnded 在自然播完时判定（见 playerStore），
    // 这里不监听曲目变化——那样连用户手动按「下一首」也会被当成播完而停掉。
    if (sleepTimerMode === 'endOfTrack') return

    const tick = () => {
      const remaining = sleepTimerAt - Date.now()
      if (remaining <= 0) {
        usePlayerStore.getState().pause()
        // 复位渐弱系数，否则下次播放会是几乎听不见的音量
        usePlayerStore.setState({ sleepTimerAt: null, sleepFadeScalar: 1 })
        return
      }
      if (!smooth) return
      const scalar = remaining <= FADE_MS ? Math.max(0, remaining / FADE_MS) : 1
      if (usePlayerStore.getState().sleepFadeScalar !== scalar) {
        usePlayerStore.setState({ sleepFadeScalar: scalar })
      }
    }

    const timer = setInterval(tick, 250)
    return () => {
      clearInterval(timer)
      // 定时被取消或组件卸载时立刻还原，不留残余衰减
      if (usePlayerStore.getState().sleepFadeScalar !== 1) {
        usePlayerStore.setState({ sleepFadeScalar: 1 })
      }
    }
  }, [sleepTimerAt, sleepTimerMode, smooth])
}
