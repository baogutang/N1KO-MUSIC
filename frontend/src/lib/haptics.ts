/**
 * 触感：只在原生壳里有（iOS / Android）；网页与桌面壳上是空操作。
 * 只给「确认发生了」的瞬间用：播放 / 暂停、切歌、收藏、甩牌越过阈值、抽屉吸附到档位。
 */
import { Haptics, ImpactStyle } from '@capacitor/haptics'
import { isNativePlatform } from '@/lib/platform'

export type HapticKind = 'light' | 'medium' | 'selection'

export function haptic(kind: HapticKind = 'light') {
  if (!isNativePlatform) return
  if (kind === 'selection') {
    Haptics.selectionChanged().catch(() => {})
    return
  }
  Haptics.impact({ style: kind === 'medium' ? ImpactStyle.Medium : ImpactStyle.Light }).catch(() => {})
}
