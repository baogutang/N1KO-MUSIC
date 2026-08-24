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
        /**
         * 暂停与复位必须在同一次 setState 里。
         * 分成两次的话，`pause()` 先提交一帧 —— 此时 sleepFadeScalar 还是
         * 接近 0 的渐弱值，但紧接着的复位把它跳回 1，音量在静音边缘
         * 弹回满格再被切断，正好在「就要睡着了」那一刻爆一声。
         */
        usePlayerStore.setState({
          isPlaying: false,
          sleepTimerAt: null,
          sleepFadeScalar: 1,
        })
        return
      }
      if (!smooth) return
      const scalar = remaining <= FADE_MS ? Math.max(0, remaining / FADE_MS) : 1
      if (usePlayerStore.getState().sleepFadeScalar !== scalar) {
        usePlayerStore.setState({ sleepFadeScalar: scalar })
      }
    }

    const timer = setInterval(tick, 250)
    /**
     * 后台标签页里 setInterval 会被节流到 ≥1s，设备休眠时更是整段停摆。
     * tick 每次都用 `sleepTimerAt - Date.now()` 重算，所以节流只会推迟判定、
     * 不会漏判；但「推迟」本身是可感知的——合盖睡着、早上掀开，音乐会再响
     * 一下才停。回到前台立刻补判一次，把这个尾巴收掉。
     */
    const onVisible = () => { if (!document.hidden) tick() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      // 定时被取消或组件卸载时立刻还原，不留残余衰减
      if (usePlayerStore.getState().sleepFadeScalar !== 1) {
        usePlayerStore.setState({ sleepFadeScalar: 1 })
      }
    }
  }, [sleepTimerAt, sleepTimerMode, smooth])
}
