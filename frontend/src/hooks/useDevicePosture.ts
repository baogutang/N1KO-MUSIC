/**
 * 折叠屏姿态。
 *
 * 'tabletop'：半折、折痕横在屏幕中间（iPhone Duo 竖握内屏半合、安卓折叠屏「笔记本」姿势）。
 * 这时正在播放页按折痕分上下两半：上半屏放歌词，下半屏放封面带与控制键（参考 QQ 音乐的 Duo 适配）。
 *
 * 判定依据两套 Web 标准：
 *   - CSS Device Posture API：`(device-posture: folded)` / navigator.devicePosture
 *   - Viewport Segments：`(vertical-viewport-segments: 2)` 表示视口被横向折痕分成上下两段
 * Chromium（安卓折叠屏）已经实现；WebKit 截至 iOS 27 尚未公开这两个 API，
 * 所以在 iPhone Duo 的 App 里需要原生壳补一条姿态桥接才会触发——在那之前这里恒为 'flat'。
 *
 * 地址里带 `?posture=tabletop` 可以在任何设备上强制进入悬停排法，便于开发和演示。
 */

import { useSyncExternalStore } from 'react'

export type Posture = 'flat' | 'tabletop'

const FOLDED_QUERY = '(device-posture: folded)'
const SPLIT_QUERY = '(vertical-viewport-segments: 2)'

interface DevicePostureLike extends EventTarget {
  type?: 'continuous' | 'folded'
}

function devicePosture(): DevicePostureLike | undefined {
  return (navigator as Navigator & { devicePosture?: DevicePostureLike }).devicePosture
}

function forcedPosture(): Posture | null {
  if (typeof location === 'undefined') return null
  const v = new URLSearchParams(location.search).get('posture')
  return v === 'tabletop' || v === 'flat' ? v : null
}

export function getPosture(): Posture {
  if (typeof window === 'undefined') return 'flat'
  const forced = forcedPosture()
  if (forced) return forced
  const folded = window.matchMedia(FOLDED_QUERY).matches || devicePosture()?.type === 'folded'
  const split = window.matchMedia(SPLIT_QUERY).matches
  // 只有「半折」且折痕横置（上下两段）才是悬停；左右两段是书本姿势，按普通横屏排
  return folded && split ? 'tabletop' : folded && window.innerHeight > window.innerWidth ? 'tabletop' : 'flat'
}

function subscribe(callback: () => void) {
  const queries = [FOLDED_QUERY, SPLIT_QUERY].map(q => window.matchMedia(q))
  queries.forEach(mql => mql.addEventListener('change', callback))
  const dp = devicePosture()
  dp?.addEventListener('change', callback)
  window.addEventListener('resize', callback)
  return () => {
    queries.forEach(mql => mql.removeEventListener('change', callback))
    dp?.removeEventListener('change', callback)
    window.removeEventListener('resize', callback)
  }
}

export function useDevicePosture(): Posture {
  return useSyncExternalStore(subscribe, getPosture)
}
