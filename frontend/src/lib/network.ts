/**
 * 网络类型探测。
 *
 * 用于「局域网无损 / 蜂窝转码」：默认无损意味着出门在外仍在从家里的上行
 * 拉原始 FLAC，既费流量又容易卡。
 *
 * Network Information API 在 Android WebView 与 Chromium 上可用，
 * Safari / iOS WebView 上没有——那里退回「假定不是蜂窝」，
 * 宁可多用点流量，也不要在 Wi-Fi 上莫名其妙地降到 192kbps。
 */

type ConnectionType = 'wifi' | 'cellular' | 'unknown'

interface NetworkInformationLike {
  type?: string
  effectiveType?: string
  saveData?: boolean
  addEventListener?: (type: 'change', listener: () => void) => void
  removeEventListener?: (type: 'change', listener: () => void) => void
}

function connection(): NetworkInformationLike | undefined {
  const nav = navigator as Navigator & {
    connection?: NetworkInformationLike
    mozConnection?: NetworkInformationLike
    webkitConnection?: NetworkInformationLike
  }
  return nav.connection ?? nav.mozConnection ?? nav.webkitConnection
}

export function getConnectionType(): ConnectionType {
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
  const conn = connection()
  if (!conn?.addEventListener) return () => {}
  conn.addEventListener('change', listener)
  return () => conn.removeEventListener?.('change', listener)
}
