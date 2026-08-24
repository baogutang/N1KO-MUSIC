/**
 * 网络类型探测。
 *
 * 用于「局域网无损 / 蜂窝转码」：默认无损意味着出门在外仍在从家里的上行
 * 拉原始 FLAC，既费流量又容易卡。
 *
 * Network Information API 在 Android WebView 与 Chromium 上可用，
 * Safari / iOS WebView 上没有——那里退回「假定不是蜂窝」，
 * 宁可多用点流量，也不要在 Wi-Fi 上莫名其妙地降到 192kbps。
 *
 * 但「iOS 上没有」正是问题所在：iPhone 装成 App 之后跑在 WKWebView 里，
 * navigator.connection 恒为 undefined，于是蜂窝降级在最需要它的那台设备上
 * 从来没有生效过。@capacitor/network 早就在依赖里，它读的是系统网络状态，
 * 这里把它接上——原生壳内以它为准，浏览器内维持原有行为。
 *
 * 插件接口是异步的，而 getConnectionType() 是同步的（调用方在构造流地址时
 * 要立刻拿到答案）。因此用一个缓存值：启动时读一次，之后靠监听更新。
 */

import { isNativePlatform } from '@/lib/platform'

type ConnectionType = 'wifi' | 'cellular' | 'unknown'

interface NetworkInformationLike {
  type?: string
  effectiveType?: string
  saveData?: boolean
  addEventListener?: (type: 'change', listener: () => void) => void
  removeEventListener?: (type: 'change', listener: () => void) => void
}

/**
 * 原生壳里由 @capacitor/network 填充的最近一次网络状态。
 * null 表示还没读到（或不在原生环境），此时退回 Web API。
 */
let nativeType: ConnectionType | null = null

/** 在原生壳内启动网络监听。非原生环境下是空操作。 */
export async function initNativeNetwork(): Promise<void> {
  if (!isNativePlatform) return
  try {
    const { Network } = await import('@capacitor/network')
    const apply = (status: { connectionType?: string }) => {
      const t = status.connectionType
      nativeType = t === 'wifi' || t === 'ethernet' ? 'wifi'
        : t === 'cellular' ? 'cellular'
        : 'unknown'
      for (const l of nativeListeners) l()
    }
    apply(await Network.getStatus())
    void Network.addListener('networkStatusChange', apply)
  } catch (err) {
    // 插件缺失或调用失败都不该影响播放，维持 Web API 的行为即可
    console.warn('[network] native status unavailable:', err)
  }
}

const nativeListeners = new Set<() => void>()

function connection(): NetworkInformationLike | undefined {
  const nav = navigator as Navigator & {
    connection?: NetworkInformationLike
    mozConnection?: NetworkInformationLike
    webkitConnection?: NetworkInformationLike
  }
  return nav.connection ?? nav.mozConnection ?? nav.webkitConnection
}

export function getConnectionType(): ConnectionType {
  // 原生壳里以系统状态为准：那里 navigator.connection 通常根本不存在
  if (nativeType !== null) return nativeType
  const conn = connection()
  if (!conn) return 'unknown'
  const type = conn.type
  if (type === 'wifi' || type === 'ethernet') return 'wifi'
  if (type === 'cellular') return 'cellular'
  // 部分实现只给 effectiveType，无法区分 Wi-Fi 与 4G，只能当作未知
  return 'unknown'
}

/** 用户在系统层面开了「省流量模式」 */
export function isSaveDataEnabled(): boolean {
  return !!connection()?.saveData
}

/** 是否应当按「移动网络」对待：明确是蜂窝，或系统开了省流量 */
export function isMeteredConnection(): boolean {
  return getConnectionType() === 'cellular' || isSaveDataEnabled()
}

/** 订阅网络类型变化，返回取消订阅函数 */
export function onConnectionChange(listener: () => void): () => void {
  if (isNativePlatform) {
    nativeListeners.add(listener)
    return () => { nativeListeners.delete(listener) }
  }
  const conn = connection()
  if (!conn?.addEventListener) return () => {}
  conn.addEventListener('change', listener)
  return () => conn.removeEventListener?.('change', listener)
}
