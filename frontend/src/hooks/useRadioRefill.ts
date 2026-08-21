/**
 * 队列自动续接。
 *
 * 队列播完就停是个很小但很伤的体验缺口：你在做别的事，音乐忽然没了。
 * 这里在未播曲目见底时向服务器再要一批相似曲目接上去，
 * 相当于「一直放下去」的电台模式。
 */

import { useEffect, useRef } from 'react'
import { usePlayerStore } from '@/store/playerStore'
import { useServerStore } from '@/store/serverStore'
import { useSettingsStore } from '@/store/settingsStore'
import { REFILL_THRESHOLD, refillRadio, remainingUnplayed } from '@/services/radio'

export function useRadioRefill() {
  const autoContinue = useSettingsStore(s => s.autoContinueQueue)
  const activeServerId = useServerStore(s => s.activeServerId)
  const isConnected = useServerStore(s => s.isConnected)
  const queueIndex = usePlayerStore(s => s.queueIndex)
  const queueLength = usePlayerStore(s => s.queue.length)
  const repeatMode = usePlayerStore(s => s.repeatMode)
  const busyRef = useRef(false)
  /** 连续补给失败就停手，避免对不支持相似曲目的服务器反复空请求 */
  const failuresRef = useRef(0)

  useEffect(() => {
    if (!autoContinue || !isConnected || !activeServerId) return
    if (busyRef.current || failuresRef.current >= 3) return
    if (!queueLength) return
    // 用户开了循环就是明确表示「这批放完再来一遍」，不要塞进别的歌
    if (repeatMode !== 'none') return
    // 刻意有限的队列（一张专辑、一个歌单）不该被变成电台。
    // 要求队列本身长于阈值，且确实已经播过一段，才认为是「快见底了」。
    if (queueLength <= REFILL_THRESHOLD || queueIndex <= 0) return
    if (remainingUnplayed() > REFILL_THRESHOLD) return

    busyRef.current = true
    refillRadio(activeServerId)
      .then(added => {
        failuresRef.current = added > 0 ? 0 : failuresRef.current + 1
      })
      .catch(() => { failuresRef.current += 1 })
      .finally(() => { busyRef.current = false })
  }, [autoContinue, isConnected, activeServerId, queueIndex, queueLength, repeatMode])

  // 换服务器后重新允许补给
  useEffect(() => { failuresRef.current = 0 }, [activeServerId])
}
