/**
 * 动效的单一真源（与 index.css 的 --ease-* 同一组参数；CSS 那边都是临界阻尼）。
 *
 * 弹簧而不是时长曲线：松手那一刻的速度会被带进去，动画随时可以被手指打断，
 * 这是「丝滑」的物理来源。所有交互动画只动 transform / opacity / clip-path。
 */
import type { Transition } from 'motion/react'

/** 界面状态（滑动的当前项、分段、开关、曲名翻页）：快，接近临界阻尼，不过冲 */
export const SPRING_SNAPPY: Transition = { type: 'spring', stiffness: 520, damping: 44, mass: 1 }
/** 手势松开后的回弹：带一点过冲，表达「被甩回去」——只给手指拖过的东西用 */
export const SPRING_PRESS: Transition = { type: 'spring', stiffness: 420, damping: 26, mass: 1 }
/** 布局与浮层：不过冲 */
export const SPRING_SMOOTH: Transition = { type: 'spring', stiffness: 260, damping: 30, mass: 1 }
/** 大面板、全屏：更沉 */
export const SPRING_GENTLE: Transition = { type: 'spring', stiffness: 170, damping: 24, mass: 1 }
/** 共享元素：封面从迷你条飞到全屏 */
export const SPRING_MORPH: Transition = { type: 'spring', stiffness: 300, damping: 32, mass: 1 }

/** 歌词换行：比 GENTLE 再缓一档、临界阻尼不过冲（感知时长约 0.6s）——整列文字一起动，快了晃眼 */
export const SPRING_LYRIC = { stiffness: 110, damping: 21, mass: 1 } as const

export const EASE_OUT = [0.16, 1, 0.3, 1] as const

/**
 * 把一根弹簧（从 0 到 1、初速为 0）采样成 WAAPI / CSS 能用的 linear() 缓动，连同它落定要多久。
 * index.css 的 --ease-smooth 等就是这样得来的；这里给 element.animate() 用——
 * 它不认 CSS 变量，也没法直接写弹簧。浏览器不认 linear() 时退回 EASE_OUT。
 */
export function springEasing(spring: { stiffness: number; damping: number; mass?: number }): { easing: string; duration: number } {
  const mass = spring.mass ?? 1
  const w0 = Math.sqrt(spring.stiffness / mass)
  const zeta = spring.damping / (2 * Math.sqrt(spring.stiffness * mass))
  // 包络衰减到千分之一算落定：欠阻尼 / 临界看 ζω0，过阻尼看慢的那个根
  const decay = zeta <= 1 ? zeta * w0 : w0 * (zeta - Math.sqrt(zeta * zeta - 1))
  const seconds = Math.log(1000) / decay
  const duration = Math.round(seconds * 1000)
  const supported = typeof CSS !== 'undefined' && typeof CSS.supports === 'function'
    && CSS.supports('transition-timing-function', 'linear(0, 1)')
  if (!supported) return { easing: `cubic-bezier(${EASE_OUT.join(', ')})`, duration }
  const at = (t: number): number => {
    if (zeta < 1) {
      const wd = w0 * Math.sqrt(1 - zeta * zeta)
      return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t))
    }
    if (zeta === 1) return 1 - Math.exp(-w0 * t) * (1 + w0 * t)
    const root = Math.sqrt(zeta * zeta - 1)
    const r1 = -w0 * (zeta - root)
    const r2 = -w0 * (zeta + root)
    return 1 - (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r2 - r1)
  }
  const steps = 28
  const points: string[] = []
  for (let i = 0; i < steps; i++) points.push(String(Math.round(at((seconds * i) / steps) * 10000) / 10000))
  points.push('1')
  return { easing: `linear(${points.join(', ')})`, duration }
}

/** 系统是否要求减弱动态效果（非 React 场景用；组件里用 motion 的 useReducedMotion） */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** 橡皮筋：越过边界后位移按平方根衰减，手感像 iOS 的回弹 */
export function rubberBand(offset: number, limit: number): number {
  if (offset <= 0) return offset
  return limit * (1 - 1 / (offset / limit + 1))
}
