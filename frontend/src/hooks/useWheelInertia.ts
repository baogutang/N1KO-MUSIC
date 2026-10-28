/**
 * 惯性滚轮：只给「一格一格跳」的鼠标滚轮（Windows / Linux、外接普通鼠标）补上滑行。
 *
 * 触控板和 Magic Mouse 本来就有系统惯性，再叠一层会发飘，所以只接管两种事件：
 * deltaMode 按「行」计（Firefox），或 wheelDeltaY 是 120 的整数倍（经典滚轮一格）。
 * 落在别的可滚动元素里（歌词、菜单、横向书架）、按着 Ctrl / Shift、
 * 或系统要求减弱动态效果时，一律交还给浏览器。
 *
 * 两道保险（设置页这种长页面上最明显：触控板快滑时页面一顿一顿往回弹）：
 *   - 精细滚动的事件流里偶尔夹着一帧「像一格」的事件：最近 400ms 见过精细事件，整串都不接管；
 *   - 滑行途中有别的来源在滚（系统惯性、拖滚动条、键盘）：立刻让开，不把页面拉回旧目标。
 */
import { useEffect } from 'react'
import { prefersReducedMotion } from '@/lib/motion'

type LegacyWheel = WheelEvent & { wheelDeltaY?: number }

/** 一格一格的鼠标滚轮（卡片叠也用它：一格走一张） */
export function isDiscreteWheel(e: LegacyWheel): boolean {
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
    /** 上一帧我们自己写进去的位置：读回来对不上，就是别人在滚 */
    let lastSet = el.scrollTop
    /**
     * 触控板 / Magic Mouse 的事件流里偶尔有一帧刚好「像」滚轮一格（Chrome 的 wheelDeltaY = −3 × deltaY，
     * deltaY 恰好是 40 的倍数时就是 120 的倍数）。最近 400ms 里见过不像一格的事件，就当整串都是精细滚动，交还给浏览器
     */
    let preciseUntil = 0
    let frame = 0
    const step = () => {
      // 有别人在滚（系统惯性、拖滚动条、键盘、代码）：立刻让开，不把页面往旧目标拉回去
      if (Math.abs(el.scrollTop - lastSet) > 1.5) {
        frame = 0
        target = el.scrollTop
        return
      }
      const current = el.scrollTop
      const delta = (target - current) * 0.2
      // 最后几像素一步到位：整数像素的屏幕上写不进不到 1px 的变化，按比例慢慢逼近会永远停不下来
      if (Math.abs(delta) < 1) {
        el.scrollTop = target
        frame = 0
        return
      }
      el.scrollTop = current + delta
      lastSet = el.scrollTop
      frame = requestAnimationFrame(step)
    }
    const stop = () => {
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      target = el.scrollTop
    }

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.shiftKey || e.defaultPrevented || prefersReducedMotion()) return
      if (!isDiscreteWheel(e as LegacyWheel)) {
        preciseUntil = e.timeStamp + 400
        return
      }
      if (e.timeStamp < preciseUntil || nestedScroller(e.target, el)) return
      e.preventDefault()
      const lineHeight = e.deltaMode === 1 ? 40 : 1
      const max = el.scrollHeight - el.clientHeight
      if (!frame) {
        target = el.scrollTop
        lastSet = el.scrollTop
      }
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
