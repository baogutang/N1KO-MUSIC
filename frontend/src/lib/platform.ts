/**
 * 平台探测（Capacitor 原生壳 / Tauri 桌面壳 / 浏览器）
 * - isNativePlatform: 是否运行在 Android/iOS 原生 WebView 内
 * - isTauriShell: 是否运行在 Tauri 桌面壳内（判定与 useDeepLinks 共用）
 * - useIsMobileLayout: 是否使用移动端布局外壳（原生壳 或 窄视口，便于浏览器开发预览）
 * - pluginSourcesSupported: 插件音源（网易云 / QQ）能不能在当前壳里工作
 */

import { useSyncExternalStore } from 'react'
import { Capacitor } from '@capacitor/core'

export const isNativePlatform = Capacitor.isNativePlatform()
export const nativeOS: 'ios' | 'android' | 'web' = Capacitor.getPlatform() as 'ios' | 'android' | 'web'

/** Tauri 注入的内部对象；useDeepLinks.ts 里的同款判定收敛到这里共用 */
export const isTauriShell =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

/**
 * 插件音源需要一条能带 Cookie、不受 CORS 管的出网通道：桌面壳走 tauri-plugin-http，
 * 原生壳走 CapacitorHttp，开发态走 Vite 代理。正式版的纯浏览器（Docker / 静态托管）
 * 三条都没有——那里的插件只会在登录后一个个报网络错误，所以干脆不提供：
 * 不种内置音源、登录页与音源设置换成「需要 App 或桌面版」的说明。
 */
export const pluginSourcesSupported = isTauriShell || isNativePlatform || import.meta.env.DEV

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
