/**
 * 平台探测（Capacitor 原生壳 / 浏览器）
 * - isNativePlatform: 是否运行在 Android/iOS 原生 WebView 内
 * - useIsMobileLayout: 是否使用移动端布局外壳（原生壳 或 窄视口，便于浏览器开发预览）
 */

import { useSyncExternalStore } from 'react'
import { Capacitor } from '@capacitor/core'

export const isNativePlatform = Capacitor.isNativePlatform()
export const nativeOS: 'ios' | 'android' | 'web' = Capacitor.getPlatform() as 'ios' | 'android' | 'web'

const MOBILE_QUERY = '(max-width: 767px)'

function subscribeMobileViewport(callback: () => void) {
  const mql = window.matchMedia(MOBILE_QUERY)
  mql.addEventListener('change', callback)
  return () => mql.removeEventListener('change', callback)
}

export function useIsMobileLayout(): boolean {
  const narrow = useSyncExternalStore(
    subscribeMobileViewport,
    () => window.matchMedia(MOBILE_QUERY).matches
  )
  return isNativePlatform || narrow
}
