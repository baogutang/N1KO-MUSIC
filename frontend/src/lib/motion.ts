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

export const EASE_OUT = [0.16, 1, 0.3, 1] as const

/** 系统是否要求减弱动态效果（非 React 场景用；组件里用 motion 的 useReducedMotion） */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** 橡皮筋：越过边界后位移按平方根衰减，手感像 iOS 的回弹 */
export function rubberBand(offset: number, limit: number): number {
  if (offset <= 0) return offset
  return limit * (1 - 1 / (offset / limit + 1))
}
