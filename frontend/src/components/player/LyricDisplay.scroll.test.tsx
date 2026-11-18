/**
 * @vitest-environment happy-dom
 *
 * 歌词自动滚动的三处交互：
 *  1. 重播 / 拖回 0:00 时 currentIndex 变回 -1，视图要滚回顶部（原先直接 return，停在上一遍的末尾）；
 *  2. 手动滚动后锁 8 秒，停手满 8 秒要自己滚回当前行（原先要等下一句换行，慢歌里能等很久）；
 *  3. 面板：系统开了「减少动态」时，容器不能再带 scroll-behavior: smooth（它会盖过 scrollTo 的 auto）。
 *  4. 全屏：滚动位置一步到位（behavior: auto、容器不带 smooth），再让各行自己滑过去；
 *     开了「减少动态」、刚挂上、换了一首歌时不滑。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

vi.mock('@/hooks/useAudioEngine', () => ({ seekHowl: vi.fn(), getAudioCurrentTime: () => 0 }))

import { LyricDisplay } from './LyricDisplay'
import { seekHowl } from '@/hooks/useAudioEngine'
import type { LyricLine } from '@/api/types'

const LINES: LyricLine[] = [
  { time: 5_000, text: '第一句' },
  { time: 10_000, text: '第二句' },
  { time: 15_000, text: '第三句' },
]

let root: Root | null = null
let host: HTMLDivElement | null = null
let reduceMotion = false
const scrollTo = vi.fn()
const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo')
const originalRect = HTMLElement.prototype.getBoundingClientRect

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  reduceMotion = false
  vi.spyOn(window, 'matchMedia').mockImplementation(q => ({
    matches: reduceMotion && q.includes('prefers-reduced-motion'),
    media: q, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }) as unknown as MediaQueryList)
  scrollTo.mockClear()
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, writable: true, value: scrollTo })
  // happy-dom 不排版，所有矩形都是 0：给容器一块 600 高的视口，当前行摆在 500 处，
  // 这样「滚到当前行」算出来的 top 必然大于 0，与「滚回顶部」的 0 分得开
  HTMLElement.prototype.getBoundingClientRect = function () {
    const isActive = this.classList.contains('is-active')
    const isContainer = this.classList.contains('overflow-y-auto')
    const rect = isActive
      ? { top: 500, height: 40 }
      : isContainer ? { top: 0, height: 600 } : { top: 0, height: 0 }
    return { ...rect, bottom: rect.top + rect.height, left: 0, right: 0, width: 0, x: 0, y: rect.top, toJSON: () => ({}) } as DOMRect
  }
})

afterEach(() => {
  act(() => { root?.unmount() })
  root = null
  host?.remove()
  host = null
  HTMLElement.prototype.getBoundingClientRect = originalRect
  if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, 'scrollTo', originalScrollTo)
  else delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollTo
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function mount(currentTimeSec: number) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  render(currentTimeSec)
}

function render(currentTimeSec: number, variant: 'fullscreen' | 'panel' = 'fullscreen', lines: LyricLine[] = LINES) {
  act(() => { root!.render(<LyricDisplay lines={lines} currentTimeSec={currentTimeSec} variant={variant} />) })
}

const container = () => host!.firstElementChild as HTMLDivElement
/** 最近一次 scrollTo 的参数 */
const lastScroll = () => scrollTo.mock.calls.at(-1)?.[0] as { top: number; behavior: string } | undefined
/** 手指 / 滚轮滚动：触发 scroll 事件；先等程序化滚动的 150ms 结算窗过去，免得被当成自动滚动 */
function userScroll() {
  act(() => { vi.advanceTimersByTime(200) })
  act(() => { container().dispatchEvent(new Event('scroll')) })
}

describe('歌词回到第一句之前（重播 / 拖回 0:00）', () => {
  it('currentIndex 变回 -1 时滚回顶部，而不是停在上一遍的末尾', () => {
    mount(12) // 12.5s → 第二句，视图滚到第二句
    expect(lastScroll()?.top, '先滚到了当前行').toBeGreaterThan(0)
    const before = scrollTo.mock.calls.length

    render(0) // 单曲循环重新开始：0.5s 还没到第一句（5s）
    expect(scrollTo.mock.calls.length, '回到第一句之前必须有一次滚动').toBeGreaterThan(before)
    expect(lastScroll()?.top).toBe(0)
  })

  it('一开始就在第一句之前：不会把顶上的视图滚走', () => {
    mount(0)
    expect(scrollTo.mock.calls.every(c => (c[0] as { top: number }).top === 0)).toBe(true)
  })
})

describe('手动滚动后的自动恢复', () => {
  it('停手满 8 秒自己滚回当前行，不必等下一句换行', () => {
    mount(12)
    userScroll()
    scrollTo.mockClear()

    act(() => { vi.advanceTimersByTime(7_900) })
    expect(scrollTo, '8 秒内不抢用户的滚动').not.toHaveBeenCalled()

    act(() => { vi.advanceTimersByTime(200) })
    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect(lastScroll()?.top, '滚回当前行').toBeGreaterThan(0)
  })

  it('再次手动滚动重新计时：从最后一次滚动起算 8 秒', () => {
    mount(12)
    userScroll()
    act(() => { vi.advanceTimersByTime(5_000) })
    act(() => { container().dispatchEvent(new Event('scroll')) })
    scrollTo.mockClear()

    act(() => { vi.advanceTimersByTime(7_900) })
    expect(scrollTo, '第一次滚动起算的 8 秒已过，但第二次还没满').not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(200) })
    expect(scrollTo).toHaveBeenCalledTimes(1)
  })

  it('自动滚动自己触发的 scroll 事件不算手动滚动（不会给自己上锁）', () => {
    mount(12) // 挂上时 scrollToActive 已经滚了一次
    act(() => { container().dispatchEvent(new Event('scroll')) }) // 程序化滚动产生的事件
    scrollTo.mockClear()
    act(() => { vi.advanceTimersByTime(10_000) })
    expect(scrollTo, '没有手动滚动，也就没有恢复计时').not.toHaveBeenCalled()
  })

  it('点歌词行立即解锁并跳转：新的当前行马上被跟上，不必再等 8 秒', () => {
    mount(12)
    userScroll()
    scrollTo.mockClear()

    const third = [...host!.querySelectorAll('p')].find(p => p.textContent === '第三句')!
    act(() => { third.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(seekHowl).toHaveBeenCalledWith(15)
    expect(vi.getTimerCount(), '等着恢复的计时器随点击一起清掉').toBe(0)

    render(15) // seek 之后时间走到第三句
    expect(scrollTo).toHaveBeenCalledTimes(1)
  })

  it('组件卸载后计时器不再触发', () => {
    mount(12)
    userScroll()
    scrollTo.mockClear()
    expect(vi.getTimerCount(), '手动滚动之后有一个等着恢复的计时器').toBeGreaterThan(0)
    act(() => { root!.unmount() })
    root = createRoot(host!) // afterEach 还要卸载一次，补回一个空根
    expect(vi.getTimerCount(), '卸载时必须把它清掉').toBe(0)
    act(() => { vi.advanceTimersByTime(20_000) })
    expect(scrollTo).not.toHaveBeenCalled()
  })
})

describe('减少动态（面板：浏览器的平滑滚动）', () => {
  function mountPanel(currentTimeSec: number) {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    render(currentTimeSec, 'panel')
  }

  it('没开：容器带 scroll-behavior: smooth，自动滚动用 smooth', () => {
    mountPanel(12)
    expect(container().style.scrollBehavior).toBe('smooth')
    expect(lastScroll()?.behavior).toBe('smooth')
  })

  it('开了：容器不设 smooth（否则它会盖过 scrollTo 的 auto），直接跳过去', () => {
    reduceMotion = true
    mountPanel(12)
    expect(container().style.scrollBehavior).not.toBe('smooth')
    expect(lastScroll()?.behavior).toBe('auto')
  })
})

describe('全屏：滚动一步到位，各行自己滑过去', () => {
  const animate = vi.fn(() => ({ cancel: vi.fn(), pause: vi.fn() }))
  const originalAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate')

  beforeEach(() => {
    animate.mockClear()
    Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, writable: true, value: animate })
    // 这一组里 scrollTo 真的改 scrollTop：滚了多少，各行就要从多远的地方滑过来
    scrollTo.mockImplementation(function (this: HTMLElement, o: { top: number }) { this.scrollTop = o.top })
    // happy-dom 不排版：给每一行一个在视口里的位置（滚到七百多时，800 处的行在屏幕上），不然全被当成「不在屏幕上」跳过
    Object.defineProperty(HTMLElement.prototype, 'offsetTop', { configurable: true, get: () => 800 })
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 40 })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 })
  })
  afterEach(() => {
    scrollTo.mockReset()
    if (originalAnimate) Object.defineProperty(HTMLElement.prototype, 'animate', originalAnimate)
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>).animate
    for (const key of ['offsetTop', 'offsetHeight', 'clientHeight']) {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key]
    }
  })

  /** 行上发起的位移动画（不算逐字填色的那些） */
  const glides = () => animate.mock.calls.filter(c => String((c as unknown[])[0] && JSON.stringify((c as unknown[])[0])).includes('translateY'))

  it('容器不带 smooth，scrollTo 用 auto：位置瞬间到位', () => {
    mount(12)
    expect(container().style.scrollBehavior).not.toBe('smooth')
    expect(lastScroll()?.behavior).toBe('auto')
  })

  it('刚挂上不滑：打开歌词时整篇不该从别处飞过来', () => {
    mount(12)
    expect(container().scrollTop).toBeGreaterThan(0)
    expect(glides()).toHaveLength(0)
  })

  it('换行：每一行从原来的位置滑过来，当前行以下的依次慢半拍', () => {
    mount(7) // 第一句
    animate.mockClear()
    // 第二句的位置比第一句低：把「当前行」的假位置挪一下，滚动才有位移
    const rect = HTMLElement.prototype.getBoundingClientRect
    HTMLElement.prototype.getBoundingClientRect = function () {
      const r = rect.call(this)
      return this.classList.contains('is-active') ? { ...r, top: 560, y: 560, bottom: 600 } as DOMRect : r
    }
    render(12) // 第二句
    HTMLElement.prototype.getBoundingClientRect = rect

    const calls = glides() as unknown as Array<[Array<{ transform: string }>, { delay: number; composite: string; fill: string }]>
    expect(calls.length, '三行都在视口里，都要滑').toBe(3)
    expect(calls[0][0][0].transform, '起点是刚才滚过的那段距离').toMatch(/^translateY\(-?\d+(\.\d+)?px\)$/)
    expect(calls[0][0][1].transform).toBe('translateY(0)')
    expect(calls.every(c => c[1].composite === 'add' && c[1].fill === 'backwards'), '叠加式动画：没走完就来下一次也不会跳').toBe(true)
    // 第一句（唱过的）和第二句（当前行）不等；第三句晚一拍
    expect(calls.map(c => c[1].delay)).toEqual([0, 0, 40])
  })

  it('开了「减少动态」：滚动照样到位，但不滑', () => {
    reduceMotion = true
    mount(7)
    animate.mockClear()
    render(12)
    expect(lastScroll()?.behavior).toBe('auto')
    expect(glides()).toHaveLength(0)
  })

  it('换了一首歌：新歌词直接到位，不带着上一首的位移滑', () => {
    mount(12)
    animate.mockClear()
    render(0, 'fullscreen', [{ time: 4_000, text: '另一首的第一句' }, { time: 9_000, text: '另一首的第二句' }])
    expect(lastScroll()?.top).toBe(0)
    expect(glides()).toHaveLength(0)
  })
})
