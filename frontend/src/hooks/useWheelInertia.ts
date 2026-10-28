/**
 * 惯性滚轮：只给「一格一格跳」的鼠标滚轮（Windows / Linux、外接普通鼠标）补上滑行。
 *
 * 触控板和 Magic Mouse 本来就有系统惯性，再叠一层会发飘，所以只接管两种事件：
 * deltaMode 按「行」计（Firefox），或 wheelDeltaY 是 120 的整数倍（经典滚轮一格）。
 * 落在别的可滚动元素里（歌词、菜单、横向书架）、按着 Ctrl / Shift、
 * 或系统要求减弱动态效果时，一律交还给浏览器。
 */
import { useEffect } from 'react'
import { prefersReducedMotion } from '@/lib/motion'

type LegacyWheel = WheelEvent & { wheelDeltaY?: number }

function isDiscreteWheel(e: LegacyWheel): boolean {
  if (e.deltaMode === 1) return true
  const legacy = e.wheelDeltaY
  return typeof legacy === 'number' && legacy !== 0 && Math.abs(legacy) % 120 === 0 && Math.abs(e.deltaX) < 1
}

/** 事件目标和 el 之间有没有另一个自己能纵向滚的元素 */
function nestedScroller(target: EventTarget | null, root: HTMLElement): boolean {
  let node = target instanceof Element ? target : null
  while (node && node !== root) {
    if (node instanceof HTMLElement && node.scrollHeight > node.clientHeight + 1) {
      const oy = getComputedStyle(node).overflowY
      if (oy === 'auto' || oy === 'scroll') return true
    }
    node = node.parentElement
  }
  return false
}

export function useWheelInertia(getEl: () => HTMLElement | null) {
  useEffect(() => {
    const el = getEl()
    if (!el || !window.matchMedia('(pointer: fine)').matches) return

    let target = el.scrollTop
    let frame = 0
    const step = () => {
      const current = el.scrollTop
      const next = current + (target - current) * 0.2
      if (Math.abs(target - next) < 0.5) {
        el.scrollTop = target
        frame = 0
        return
      }
      el.scrollTop = next
      frame = requestAnimationFrame(step)
    }
    const stop = () => {
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      target = el.scrollTop
    }

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.shiftKey || e.defaultPrevented || prefersReducedMotion()) return
      if (!isDiscreteWheel(e as LegacyWheel) || nestedScroller(e.target, el)) return
      e.preventDefault()
      const lineHeight = e.deltaMode === 1 ? 40 : 1
      const max = el.scrollHeight - el.clientHeight
      if (!frame) target = el.scrollTop
      target = Math.max(0, Math.min(max, target + e.deltaY * lineHeight))
      if (!frame) frame = requestAnimationFrame(step)
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('pointerdown', stop)
    el.addEventListener('keydown', stop)
    return () => {
      stop()
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('pointerdown', stop)
      el.removeEventListener('keydown', stop)
    }
  }, [getEl])
}
