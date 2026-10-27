/**
 * 平台探测（Capacitor 原生壳 / Tauri 桌面壳 / 浏览器）
 * - isNativePlatform: 是否运行在 Android/iOS 原生 WebView 内
 * - isTauriShell: 是否运行在 Tauri 桌面壳内（判定与 useDeepLinks 共用）
 * - useWindowClass: 窗口尺寸档位（compact / regular / wide），外壳按它切换布局
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
 * macOS 桌面壳用的是 Overlay 标题栏：内容铺到窗口顶上，左上角是系统的红黄绿三个键。
 * 外壳左上角那一块（侧栏头、导航条顶端、侧栏收起后的工具栏）要让出它们的位置。
 */
export const needsTrafficLightInset =
  isTauriShell && typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)

/**
 * 插件音源需要一条能带 Cookie、不受 CORS 管的出网通道：桌面壳走 tauri-plugin-http，
 * 原生壳走 CapacitorHttp，开发态走 Vite 代理。正式版的纯浏览器（Docker / 静态托管）
 * 三条都没有——那里的插件只会在登录后一个个报网络错误，所以干脆不提供：
 * 不种内置音源、登录页与音源设置换成「需要 App 或桌面版」的说明。
 */
export const pluginSourcesSupported = isTauriShell || isNativePlatform || import.meta.env.DEV

/**
 * 窗口尺寸档位。**只看窗口宽度，不看设备**：
 *   compact < 600    底部标签栏（iPhone、Duo 外屏、iPad 窄分屏 / 侧拉）
 *   regular 600–1023 侧边导航条（Duo 展开、iPad 竖屏、半屏分屏）
 *   wide    ≥ 1024   侧栏 + 正在播放面板（iPad 横屏、桌面）
 *
 * 此前是「原生壳一律走手机布局」，于是 13 寸 iPad 横屏也只有底部标签栏，
 * Split View / 台前调度拖宽拖窄也不会换布局。iPhone Duo 开合、iPad 分屏
 * 都是在运行中改窗口宽度，按设备判断永远跟不上。
 * 与 tailwind.config 的 regular / wide 断点一致。
 */
export type WindowClass = 'compact' | 'regular' | 'wide'

const REGULAR_QUERY = '(min-width: 600px)'
const WIDE_QUERY = '(min-width: 1024px)'

export function getWindowClass(): WindowClass {
  if (typeof window === 'undefined') return 'wide'
  if (window.matchMedia(WIDE_QUERY).matches) return 'wide'
  if (window.matchMedia(REGULAR_QUERY).matches) return 'regular'
  return 'compact'
}

function subscribeWindowClass(callback: () => void) {
  const queries = [REGULAR_QUERY, WIDE_QUERY].map(q => window.matchMedia(q))
  queries.forEach(mql => mql.addEventListener('change', callback))
  return () => queries.forEach(mql => mql.removeEventListener('change', callback))
}

export function useWindowClass(): WindowClass {
  return useSyncExternalStore(subscribeWindowClass, getWindowClass)
}
