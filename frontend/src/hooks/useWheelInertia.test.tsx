/**
 * @vitest-environment happy-dom
 *
 * 惯性滚轮的边界：只接管经典滚轮，触控板的事件流里偶尔「像一格」的那一帧不能接；
 * 滑行途中别的来源（系统惯性、拖滚动条）一动就让开——不然页面会被拉回旧目标，一顿一顿往回弹。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act, useCallback, useRef } from 'react'
import { useWheelInertia } from './useWheelInertia'

let root: Root | null = null
let host: HTMLDivElement | null = null
let scroller: HTMLDivElement | null = null

/** 像真浏览器那样：scrollTop 只存整数像素、夹在 [0, max] 里 */
function fakeScrollMetrics(el: HTMLDivElement, scrollHeight = 5000, clientHeight = 800) {
  let top = 0
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => scrollHeight })
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => clientHeight })
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (v: number) => { top = Math.round(Math.max(0, Math.min(scrollHeight - clientHeight, v))) },
  })
}

function Harness() {
  const ref = useRef<HTMLDivElement>(null)
  const get = useCallback(() => ref.current, [])
  useWheelInertia(get)
  return (
    <div ref={ref} data-testid="scroller">
      <div style={{ height: 5000 }} />
    </div>
  )
}

function wheel(opts: { deltaY: number; deltaMode?: number; wheelDeltaY?: number; at: number }) {
  const e = new WheelEvent('wheel', { deltaY: opts.deltaY, deltaMode: opts.deltaMode ?? 0, bubbles: true, cancelable: true })
  if (opts.wheelDeltaY !== undefined) Object.defineProperty(e, 'wheelDeltaY', { value: opts.wheelDeltaY })
  Object.defineProperty(e, 'timeStamp', { value: opts.at })
  scroller!.dispatchEvent(e)
  return e
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] })
  // 有精确指针（鼠标 / 触控板）、没开减弱动态效果
  vi.spyOn(window, 'matchMedia').mockImplementation(q => ({
    matches: q.includes('pointer: fine'), media: q, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }) as unknown as MediaQueryList)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(<Harness />))
  // 钩子只在装上时读一次 scrollTop（此时是 0），尺寸都在滚轮事件里现读：挂上之后再换成假尺寸就行
  scroller = host.querySelector('[data-testid="scroller"]') as HTMLDivElement
  fakeScrollMetrics(scroller)
})

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
  scroller = null
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('惯性滚轮', () => {
  it('经典滚轮按行滚：接管并平滑滑到目标，最后一步到位、不再空转', () => {
    const e = wheel({ deltaY: 3, deltaMode: 1, at: 1000 })
    expect(e.defaultPrevented).toBe(true)
    act(() => { vi.advanceTimersByTime(16 * 3) })
    const mid = scroller!.scrollTop
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(120)
    act(() => { vi.advanceTimersByTime(16 * 60) })
    expect(scroller!.scrollTop).toBe(120)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('触控板事件流里夹着一帧「像一格」的事件：不接管，交给浏览器', () => {
    const precise = wheel({ deltaY: 4, wheelDeltaY: -12, at: 1000 })
    expect(precise.defaultPrevented).toBe(false)
    const looksDiscrete = wheel({ deltaY: 40, wheelDeltaY: -120, at: 1100 })
    expect(looksDiscrete.defaultPrevented).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('离上一次精细事件够久之后，真的滚轮一格照常接管', () => {
    wheel({ deltaY: 4, wheelDeltaY: -12, at: 1000 })
    const notch = wheel({ deltaY: 100, wheelDeltaY: -120, at: 2000 })
    expect(notch.defaultPrevented).toBe(true)
  })

  it('滑行途中有别的来源在滚：立刻让开，不把页面拉回旧目标', () => {
    wheel({ deltaY: 10, deltaMode: 1, at: 1000 }) // 目标 400
    act(() => { vi.advanceTimersByTime(16 * 2) })
    scroller!.scrollTop = 900 // 系统惯性 / 拖滚动条把它推到了更远
    act(() => { vi.advanceTimersByTime(16 * 30) })
    expect(scroller!.scrollTop).toBe(900)
    expect(vi.getTimerCount()).toBe(0)
  })
})
