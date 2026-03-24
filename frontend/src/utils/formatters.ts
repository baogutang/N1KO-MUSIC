/**
 * 格式化工具函数
 */

/**
 * 格式化时长（秒 -> mm:ss 或 h:mm:ss）
 */
export function formatDuration(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '0:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)

  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * 格式化文件大小
 */
export function formatFileSize(bytes: number): string {
  if (!bytes) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let size = bytes
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex++
  }
  return `${size.toFixed(unitIndex > 0 ? 1 : 0)} ${units[unitIndex]}`
}

/**
 * 格式化播放次数
 */
export function formatPlayCount(count: number): string {
  if (!count) return '0'
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`
  return String(count)
}

/**
 * 格式化相对时间（几分钟前、几小时前等）
 */
export function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  const months = Math.floor(days / 30)
  const years = Math.floor(days / 365)

  if (seconds < 60) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  if (hours < 24) return `${hours} 小时前`
  if (days < 30) return `${days} 天前`
  if (months < 12) return `${months} 个月前`
  return `${years} 年前`
}

/**
 * 格式化日期
 */
export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/**
 * 格式化时长为自然语言
 */
export function formatDurationNatural(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)

  if (hours > 0) {
    return `${hours} 小时 ${minutes} 分钟`
  }
  return `${minutes} 分钟`
}

/**
 * 截断文字，超出显示省略号
 */
export function truncate(text: string, maxLength: number): string {
  if (!text || text.length <= maxLength) return text
  return text.substring(0, maxLength) + '...'
}

/**
 * 生成随机颜色（用于 Avatar 占位符）
 */
export function stringToColor(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }
  const colors = [
    '#1DB954', '#FA233B', '#0073cf', '#a855f7',
    '#f97316', '#06b6d4', '#84cc16', '#ec4899',
  ]
  return colors[Math.abs(hash) % colors.length]
}

/**
 * 生成首字母缩写（用于无封面的 Avatar）
 */
export function getInitials(name: string): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/**
 * 清理文件名中的音轨号前缀（如 "01-06 - 安妮.dsf" -> "安妮.dsf"）
 * 支持常见格式：01-06、01.06、01-06、01_06 等
 */
export function cleanFileName(path: string): string {
  if (!path) return path

  // 从路径中提取文件名
  const fileName = path.split('/').pop() || path

  // 匹配音轨号模式：数字-数字 或 数字.数字 或 数字_数字 后跟分隔符
  // 例如：01-06 - 安妮、01.06 - 安妮、01_06 - 安妮、01 - 安妮
  const trackPrefixPattern = /^\d{1,2}[-._]\d{1,2}\s*[-–—.]\s+/

  // 移除音轨号前缀
  const cleaned = fileName.replace(trackPrefixPattern, '')

  // 如果没有匹配到，尝试匹配单数字格式：01 - 安妮
  const singleTrackPattern = /^\d{1,2}\s*[-–—.]\s+/
  if (cleaned === fileName) {
    return fileName.replace(singleTrackPattern, '')
  }

  return cleaned
}
