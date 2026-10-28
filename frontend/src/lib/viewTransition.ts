/**
 * 扩散转场（View Transitions API）：从一个点向外扩开的圆，把新状态「洒」出来。
 * 用在「来源」重要的地方：从开关处切亮暗。
 * 不支持的系统（老 WebKit、WebKitGTK）或减弱动态效果时，直接切换，不做动画。
 */
import { prefersReducedMotion } from '@/lib/motion'

type DocWithVT = Document & {
  startViewTransition?: (cb: () => void) => { ready: Promise<void>; finished: Promise<void> }
}

export function radialReveal(origin: { x: number; y: number } | null, update: () => void) {
  const doc = document as DocWithVT
  if (!doc.startViewTransition || prefersReducedMotion() || !origin) {
    update()
    return
  }
  const { x, y } = origin
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))
  document.documentElement.dataset.vt = 'reveal'
  const transition = doc.startViewTransition(update)
  transition.ready
    .then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 620, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', pseudoElement: '::view-transition-new(root)' }
      )
    })
    .catch(() => {})
  transition.finished.finally(() => {
    delete document.documentElement.dataset.vt
  })
}

/** 事件 → 扩散原点（按钮中心；键盘触发时 clientX/Y 是 0，退回元素中心） */
export function originOf(e: { currentTarget: EventTarget | null; clientX?: number; clientY?: number }) {
  const el = e.currentTarget as HTMLElement | null
  if (e.clientX && e.clientY) return { x: e.clientX, y: e.clientY }
  if (!el?.getBoundingClientRect) return null
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}
