/**
 * 专辑封面颜色提取工具
 * 从图片中提取主色调，用于全屏播放器渐变背景
 */

/** 颜色结果 */
export interface ExtractedColors {
  primary: string
  secondary: string
  /** 是否是深色（用于决定文字颜色）*/
  isDark: boolean
}

/**
 * 当前正在加载的颜色提取图片 — 用于取消上一次未完成的提取，
 * 避免 new Image() 持有 HTTP 连接导致连接池耗尽。
 */
let currentExtractImg: HTMLImageElement | null = null

/**
 * 取消当前进行中的颜色提取请求，释放其占用的 HTTP 连接。
 * 在开始新提取前自动调用，也可由外部显式调用。
 */
export function cancelPendingColorExtraction() {
  if (currentExtractImg) {
    currentExtractImg.onload = null
    currentExtractImg.onerror = null
    currentExtractImg.src = ''  // 立即释放 HTTP 连接
    currentExtractImg = null
  }
}

/**
 * 从图片 URL 提取主色调
 * 使用 Canvas API 分析像素
 *
 * 注意：每次调用会自动取消上一次未完成的提取，
 * 确保同一时刻最多只有一个颜色提取 Image() 占用 HTTP 连接。
 */
export async function extractColorsFromUrl(
  imageUrl: string
): Promise<ExtractedColors> {
  // 取消上一次未完成的提取，释放其 HTTP 连接
  cancelPendingColorExtraction()

  return new Promise((resolve) => {
    const img = new Image()
    currentExtractImg = img
    img.crossOrigin = 'anonymous'

    img.onload = () => {
      // 如果已被新的提取取代，直接返回默认色
      if (currentExtractImg !== img) { resolve(getDefaultColors()); return }
      currentExtractImg = null
      try {
        const canvas = document.createElement('canvas')
        const size = 50 // 降采样到 50x50 提高性能
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')

        if (!ctx) {
          resolve(getDefaultColors())
          return
        }

        ctx.drawImage(img, 0, 0, size, size)
        const imageData = ctx.getImageData(0, 0, size, size).data
        const colors = extractDominantColors(imageData)
        resolve(colors)
      } catch {
        resolve(getDefaultColors())
      }
    }

    img.onerror = () => {
      if (currentExtractImg === img) currentExtractImg = null
      resolve(getDefaultColors())
    }
    // 给颜色提取请求附加独立参数，避免与常规 <img> 标签共享 HTTP 缓存。
    // crossOrigin='anonymous' 发起 CORS 请求，若服务器不支持 CORS，浏览器可能
    // 将失败响应缓存，污染同 URL 的非 CORS <img> 请求，导致封面图加载失败。
    const separator = imageUrl.includes('?') ? '&' : '?'
    img.src = imageUrl + separator + '_ce=1'
  })
}

/** 默认颜色（无法提取时使用）*/
function getDefaultColors(): ExtractedColors {
  return {
    primary: 'hsl(141, 69%, 20%)',
    secondary: 'hsl(141, 69%, 10%)',
    isDark: true,
  }
}

/** 从像素数据中提取主色调 */
function extractDominantColors(data: Uint8ClampedArray): ExtractedColors {
  const colorBuckets = new Map<string, { r: number; g: number; b: number; count: number }>()

  // 每隔 4 个像素采样一次（性能优化）
  for (let i = 0; i < data.length; i += 16) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const a = data[i + 3]

    if (a < 128) continue // 跳过透明像素

    // 量化颜色（降低精度，合并相似颜色）
    const qr = Math.round(r / 32) * 32
    const qg = Math.round(g / 32) * 32
    const qb = Math.round(b / 32) * 32
    const key = `${qr},${qg},${qb}`

    const bucket = colorBuckets.get(key) ?? { r: 0, g: 0, b: 0, count: 0 }
    bucket.r += r
    bucket.g += g
    bucket.b += b
    bucket.count++
    colorBuckets.set(key, bucket)
  }

  // 按出现频率排序
  const sorted = Array.from(colorBuckets.values()).sort((a, b) => b.count - a.count)

  if (sorted.length === 0) return getDefaultColors()

  // 取出现最多的颜色
  const dominant = sorted[0]
  const r = Math.round(dominant.r / dominant.count)
  const g = Math.round(dominant.g / dominant.count)
  const b = Math.round(dominant.b / dominant.count)

  // 转换为 HSL
  const hsl = rgbToHsl(r, g, b)

  // 调整饱和度和明度，生成渐变颜色
  const primary = `hsl(${hsl.h}, ${Math.max(hsl.s, 40)}%, ${Math.min(hsl.l, 30)}%)`
  const secondary = `hsl(${hsl.h}, ${Math.max(hsl.s, 30)}%, ${Math.min(hsl.l, 15)}%)`

  const isDark = (r * 299 + g * 587 + b * 114) / 1000 < 128

  return { primary, secondary, isDark }
}

/** RGB 转 HSL */
function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255
  g /= 255
  b /= 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2

  if (max === min) {
    return { h: 0, s: 0, l: Math.round(l * 100) }
  }

  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)

  let h: number
  switch (max) {
    case r:
      h = ((g - b) / d + (g < b ? 6 : 0)) / 6
      break
    case g:
      h = ((b - r) / d + 2) / 6
      break
    default:
      h = ((r - g) / d + 4) / 6
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  }
}

/**
 * 颜色缓存，避免重复提取
 */
const colorCache = new Map<string, ExtractedColors>()

export async function getCachedColors(imageUrl: string): Promise<ExtractedColors> {
  if (colorCache.has(imageUrl)) {
    return colorCache.get(imageUrl)!
  }
  const colors = await extractColorsFromUrl(imageUrl)
  colorCache.set(imageUrl, colors)
  // 限制缓存大小
  if (colorCache.size > 100) {
    const firstKey = colorCache.keys().next().value
    if (firstKey) colorCache.delete(firstKey)
  }
  return colors
}
