/**
 * 纸面安全色。
 *
 * 从封面取色做氛围光是个好主意，但直接用取到的原色是不安全的：一张荧光粉的
 * 电子专辑会把整块版面染成粉色，一张纯黑的爵士封面会把纸压成灰。设计契约说的是
 * 「纸、墨、朱」三色——氛围光可以有，但它必须始终读作**染了色的纸**，
 * 而不是一块颜色。
 *
 * 做法是把任意输入色投影到一条窄带里：色相保留（这是封面唯一值得留下的信息），
 * 饱和度和明度强行夹进纸的邻域。于是不管封面多刺眼，落到版面上的都是一层薄晕。
 */

/** 亮色模式下允许的饱和度上限。再高就不像纸了。 */
const LIGHT_MAX_SATURATION = 0.28
/** 亮色模式下的明度区间：始终比纸略深一点点，但不能变成色块 */
const LIGHT_MIN_LIGHTNESS = 0.72
const LIGHT_MAX_LIGHTNESS = 0.88

/** 暗色模式：底色是墨，晕染要更暗更沉，否则会在深底上发光 */
const DARK_MAX_SATURATION = 0.34
const DARK_MIN_LIGHTNESS = 0.18
const DARK_MAX_LIGHTNESS = 0.34

export interface Rgb { r: number; g: number; b: number }

/** 解析 #rgb / #rrggbb / rgb(...)，认不出来返回 null 而不是猜 */
export function parseColor(input: string): Rgb | null {
  const text = input.trim()

  const hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (hex) {
    const body = hex[1]
    const full = body.length === 3
      ? body.split('').map(char => char + char).join('')
      : body
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
    }
  }

  const rgb = text.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i)
  if (rgb) {
    return {
      r: Math.round(Number(rgb[1])),
      g: Math.round(Number(rgb[2])),
      b: Math.round(Number(rgb[3])),
    }
  }
  return null
}

export function rgbToHsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const rf = r / 255, gf = g / 255, bf = b / 255
  const max = Math.max(rf, gf, bf)
  const min = Math.min(rf, gf, bf)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }

  const delta = max - min
  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min)
  let h: number
  if (max === rf) h = ((gf - bf) / delta + (gf < bf ? 6 : 0)) / 6
  else if (max === gf) h = ((bf - rf) / delta + 2) / 6
  else h = ((rf - gf) / delta + 4) / 6
  return { h, s, l }
}

function hueToChannel(p: number, q: number, t: number): number {
  let temp = t
  if (temp < 0) temp += 1
  if (temp > 1) temp -= 1
  if (temp < 1 / 6) return p + (q - p) * 6 * temp
  if (temp < 1 / 2) return q
  if (temp < 2 / 3) return p + (q - p) * (2 / 3 - temp) * 6
  return p
}

export function hslToRgb(h: number, s: number, l: number): Rgb {
  if (s === 0) {
    const value = Math.round(l * 255)
    return { r: value, g: value, b: value }
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return {
    r: Math.round(hueToChannel(p, q, h + 1 / 3) * 255),
    g: Math.round(hueToChannel(p, q, h) * 255),
    b: Math.round(hueToChannel(p, q, h - 1 / 3) * 255),
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * 把任意颜色夹到纸面安全带里。
 *
 * 只保留色相。饱和度取「原值与上限的较小者」——本来就淡的封面不该被强行提亮，
 * 那会凭空造出一种它没有的情绪。
 *
 * 认不出来的输入原样返回：宁可不加氛围光，也不要为了「有东西」而涂一层假色。
 */
export function toPaperSafe(color: string, isDark: boolean): string {
  const rgb = parseColor(color)
  if (!rgb) return color

  const { h, s, l } = rgbToHsl(rgb)
  const maxSaturation = isDark ? DARK_MAX_SATURATION : LIGHT_MAX_SATURATION
  const minLightness = isDark ? DARK_MIN_LIGHTNESS : LIGHT_MIN_LIGHTNESS
  const maxLightness = isDark ? DARK_MAX_LIGHTNESS : LIGHT_MAX_LIGHTNESS

  const safe = hslToRgb(
    h,
    Math.min(s, maxSaturation),
    clamp(l, minLightness, maxLightness)
  )
  return `rgb(${safe.r}, ${safe.g}, ${safe.b})`
}
