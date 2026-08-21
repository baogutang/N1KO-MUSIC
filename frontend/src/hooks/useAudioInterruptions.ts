/**
 * 打断策略：耳机被拔掉时停下来，插回去时（可选）接着放。
 *
 * 为什么要自己做——各家浏览器在输出设备消失时的行为并不一致：有的会暂停
 * media element，有的直接把声音甩到外放。后者是真的会让人社死的：地铁上拔掉
 * 耳机，手机喇叭当场开始放歌。所以不能指望浏览器，得自己盯着设备列表。
 *
 * 盯的是 `devicechange` 事件加上 audiooutput 的**数量**。没有麦克风权限时
 * enumerateDevices 只返回空的 deviceId 和 label，但设备条目数是准的——
 * 而这里要判断的恰好只是「输出设备变少了」，数量足够。
 *
 * 键盘和耳机线控的播放键不在这里：它们由系统转成 Media Session 的
 * play / pause / nexttrack / previoustrack，useMediaSession 已经接住了。
 */

import { useEffect, useRef } from 'react'
import { usePlayerStore } from '@/store/playerStore'
import { useSettingsStore } from '@/store/settingsStore'
import { toast } from '@/components/ui/use-toast'
import { t } from '@/i18n'

/**
 * 插回耳机后多久之内算「同一次打断」。
 *
 * 拔掉两分钟后再插回来，人多半已经不在听了，这时候突然出声反而是惊吓。
 */
const RESUME_WINDOW_MS = 60_000

async function countAudioOutputs(): Promise<number | null> {
  if (!navigator.mediaDevices?.enumerateDevices) return null
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices.filter(device => device.kind === 'audiooutput').length
  } catch {
    return null
  }
}

export function useAudioInterruptions(): void {
  const resumeAfterInterruption = useSettingsStore(s => s.resumeAfterInterruption)
  const resumeRef = useRef(resumeAfterInterruption)
  resumeRef.current = resumeAfterInterruption

  useEffect(() => {
    if (!navigator.mediaDevices?.addEventListener) return

    let outputCount: number | null = null
    /** 上一次因为设备消失而暂停的时刻；null 表示当前不是被打断的状态 */
    let interruptedAt: number | null = null
    /** 打断发生时正在放的是哪一首，插回来时用来确认「还是同一首」 */
    let interruptedSongId: string | null = null
    let disposed = false

    const sync = async () => {
      const next = await countAudioOutputs()
      if (disposed || next === null) return

      const previous = outputCount
      outputCount = next
      if (previous === null) return

      if (next < previous) {
        // 输出设备变少：耳机 / 蓝牙断了。正在放就停下，别甩到外放。
        const state = usePlayerStore.getState()
        if (state.isPlaying) {
          state.pause()
          interruptedAt = Date.now()
          interruptedSongId = state.currentSong?.id ?? null
          toast({ title: t('player.headphonesUnplugged') })
        }
        return
      }

      if (next > previous && interruptedAt !== null) {
        const withinWindow = Date.now() - interruptedAt < RESUME_WINDOW_MS
        const sameSong = usePlayerStore.getState().currentSong?.id === interruptedSongId
        interruptedAt = null
        interruptedSongId = null
        if (!withinWindow || !resumeRef.current) return
        const state = usePlayerStore.getState()
        /**
         * 三个条件缺一不可：还在窗口内、用户没自己按播放、**而且还是同一首**。
         * 换过歌就说明用户已经在别的地方接着听了，这时候替他按下播放
         * 是在打断他，不是在帮他。
         */
        if (!state.isPlaying && state.currentSong && sameSong) state.resume()
      }
    }

    void sync()
    navigator.mediaDevices.addEventListener('devicechange', sync)
    return () => {
      disposed = true
      navigator.mediaDevices.removeEventListener('devicechange', sync)
    }
  }, [])
}
