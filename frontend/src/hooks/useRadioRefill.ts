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
  const busyRef = useRef(false)
  /** 连续补给失败就停手，避免对不支持相似曲目的服务器反复空请求 */
  const failuresRef = useRef(0)

  useEffect(() => {
    if (!autoContinue || !isConnected || !activeServerId) return
    if (busyRef.current || failuresRef.current >= 3) return
    if (!queueLength) return
    if (remainingUnplayed() > REFILL_THRESHOLD) return

    busyRef.current = true
    refillRadio(activeServerId)
      .then(added => {
        failuresRef.current = added > 0 ? 0 : failuresRef.current + 1
      })
      .catch(() => { failuresRef.current += 1 })
      .finally(() => { busyRef.current = false })
  }, [autoContinue, isConnected, activeServerId, queueIndex, queueLength])

  // 换服务器后重新允许补给
  useEffect(() => { failuresRef.current = 0 }, [activeServerId])
}
