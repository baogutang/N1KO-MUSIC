/**
 * 沉浸样式的底色：封面颜色的延续。
 *
 * 封面上、中、下三段的平均色（services/artLight 的 bands）连成一条竖向渐变，保留真实的明暗——
 * 不再像舞台的暗场那样只取色相、把亮度锁死。底色跟着封面，文字就不能永远是白的：
 * 底色浅的时候换成深色字，按文字所在的那一段分别判断（歌名与歌词看上半段，底下那排控制看下段）。
 *
 * 这里只算数，不碰 DOM：StageField 拿去喂着色器，FullscreenPlayer 拿去定文字深浅和压色的颜色。
 */
import { oklchToRgb } from '@/lib/oklch'
import type { ArtBandTriple, ArtPalette, ArtSwatch } from '@/services/artLight'

export type StageInk = 'light' | 'dark'
export type ArtPlacement = 'side' | 'top'
type Rgb = [number, number, number]

export interface CoverField {
  /** 上 / 中 / 下三段底色，sRGB（已加伽马）0–1 */
  bases: [Rgb, Rgb, Rgb]
  /** 歌名、歌词那一带的文字 */
  ink: StageInk
  /** 底下进度与控制那一带的文字 */
  footInk: StageInk
}

/** 亮度略压一点、饱和略提一点：平均色天然发灰发亮，这样更接近封面给人的印象 */
const L_SCALE = 0.92
const C_SCALE = 1.1
const C_CAP = 0.12
const L_MIN = 0.2
const L_MAX = 0.8

/**
 * 深色字 / 浅色字的分界。墨（L 0.21）与白（L 0.97）压在同一块底色上，对比度在 L≈0.585 处相等：
 * 再亮深色字更清楚，再暗白字更清楚。
 * 歌名贴着顶、歌词的当前行在三分之一处，所以上半带按「上段六成、中段四成」算，分界放低一点点（0.57）：
 * 上段明显是浅色的封面，歌名先保住。
 */
const INK_SPLIT = 0.585
const INK_SPLIT_HEAD = 0.57

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** 两个 LCH 色按权重在 OKLab 里混合 */
function mix(a: ArtSwatch, b: ArtSwatch, wb: number): ArtSwatch {
  const wa = 1 - wb
  const ra = (a.h * Math.PI) / 180
  const rb = (b.h * Math.PI) / 180
  const x = a.c * Math.cos(ra) * wa + b.c * Math.cos(rb) * wb
  const y = a.c * Math.sin(ra) * wa + b.c * Math.sin(rb) * wb
  let h = (Math.atan2(y, x) * 180) / Math.PI
  if (h < 0) h += 360
  return { l: a.l * wa + b.l * wb, c: Math.hypot(x, y), h }
}

/**
 * @param placement side：横屏，封面贴左，右缘融进背景——右半边权重加倍；top：竖屏，封面顶满屏宽，左右一样重。
 * @returns 这张封面没有三段色（没取到像素、旧缓存）时返回 null：调用方退回原来的光场。
 */
export function coverField(palette: ArtPalette, placement: ArtPlacement): CoverField | null {
  const bands = palette.bands
  if (!bands) return null
  const rightWeight = placement === 'side' ? 2 / 3 : 1 / 2
  const tuned = ([0, 1, 2] as const).map(i => {
    const sw = mix((bands.left as ArtBandTriple)[i], (bands.right as ArtBandTriple)[i], rightWeight)
    return { l: clamp(sw.l * L_SCALE, L_MIN, L_MAX), c: Math.min(sw.c * C_SCALE, C_CAP), h: sw.h }
  })
  return {
    bases: tuned.map(sw => oklchToRgb(sw.l, sw.c, sw.h)) as [Rgb, Rgb, Rgb],
    ink: tuned[0].l * 0.6 + tuned[1].l * 0.4 >= INK_SPLIT_HEAD ? 'dark' : 'light',
    footInk: tuned[2].l >= INK_SPLIT ? 'dark' : 'light',
  }
}

export const rgbCss = (rgb: ArrayLike<number>) =>
  `rgb(${Array.from(rgb, v => Math.round(clamp(v, 0, 1) * 255)).join(' ')})`

/**
 * 三段颜色各自的位置：取在封面框的六分之一、二分之一、六分之五处（每一段的中心），
 * 最上面一截保持上段的颜色，封面底边往下保持下段的颜色。
 * @param artTop 封面框顶边在画面里的位置（0–1，自上而下）
 * @param artHeight 封面框的高（占画面高度的比例）
 */
export function bandStops(artTop: number, artHeight: number): [number, number, number] {
  const h = artHeight > 0.05 ? artHeight : 0.85
  const top = artHeight > 0.05 ? artTop : 0
  return [top + h / 6, top + h / 2, top + (h * 5) / 6]
}
