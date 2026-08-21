/**
 * 滚动位置记忆。
 *
 * 之前两件事都没做：前进到新页面时滚动条留在上一页的位置（点开一张专辑
 * 却看到半截页面），后退回列表时又回到顶部（翻了三百首找到的位置全没了）。
 * 两个方向恰好都反了。
 *
 * 规则很简单：PUSH / REPLACE 归零，POP（浏览器后退、手势返回）还原。
 * 位置按 history 的 location.key 存，同一个 URL 的两次访问互不干扰。
 */

import { useEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

const STORE_KEY = 'msp-scroll-memory'
/** 记住多少个历史条目——远超正常的后退深度，又不至于把 sessionStorage 撑爆 */
const MAX_ENTRIES = 60
/** 内容异步到位，还原要在这个窗口内反复守住目标位置 */
const RESTORE_WINDOW_MS = 1500
const RESTORE_INTERVAL_MS = 60

type Positions = Record<string, number>

function readPositions(): Positions {
  try {
    const raw = sessionStorage.getItem(STORE_KEY)
    return raw ? (JSON.parse(raw) as Positions) : {}
  } catch {
    return {}
  }
}

function writePositions(positions: Positions): void {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(positions))
  } catch {
    // 无痕模式 / 配额满：记忆退化成本次会话内存副本，不影响使用
  }
}

/**
 * @param getScrollElement 返回滚动容器；布局挂载后才有值，所以传函数不传元素
 */
export function useScrollMemory(getScrollElement: () => HTMLElement | null): void {
  const location = useLocation()
  const navigationType = useNavigationType()
  const positionsRef = useRef<Positions>(readPositions())
  /** 当前条目的 key，卸载/切换前用它落盘 */
  const keyRef = useRef(location.key)

  /**
   * 记录滚动。
   *
   * 位置必须在滚动发生的当下就记进内存，不能等到离开页面时再读一次 scrollTop：
   * 切路由时 React 先把新页面提交进 DOM，容器随即变矮，浏览器当场把 scrollTop
   * 夹到新的上限——等 effect 清理跑起来，那个值早就是 0 了。
   * 清理里只负责落盘和裁剪，一个字节的 scrollTop 都不再读。
   */
  useEffect(() => {
    const el = getScrollElement()
    if (!el) return
    keyRef.current = location.key

    const onScroll = () => {
      positionsRef.current[keyRef.current] = el.scrollTop
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      const entries = Object.entries(positionsRef.current)
      if (entries.length > MAX_ENTRIES) {
        positionsRef.current = Object.fromEntries(entries.slice(-MAX_ENTRIES))
      }
      writePositions(positionsRef.current)
    }
  }, [location.key, getScrollElement])

  // 还原 / 归零
  useEffect(() => {
    const el = getScrollElement()
    if (!el) return

    if (navigationType !== 'POP') {
      el.scrollTop = 0
      // 新页面从头开始，同时把这条历史记录的旧位置清掉（同一个 key 会被复用）
      delete positionsRef.current[location.key]
      return
    }

    const target = positionsRef.current[location.key]
    if (!target) {
      el.scrollTop = 0
      return
    }

    /**
     * 列表是异步来的，位置得「守」而不是「设」。
     *
     * 只设一次不够：内容先到一半、容器够高、我们落位，接着骨架换成真列表、
     * 容器瞬间变矮，浏览器当场把 scrollTop 夹掉，等它再长回来位置早没了。
     * 所以在一个短窗口里持续把目标顶回去。
     *
     * 「用户自己动了」不能靠位置反推——夹回来和人滚上去在数值上是一回事，
     * 而且等我们下一拍去量的时候容器往往已经长回来了。只认真实输入事件。
     */
    const started = Date.now()
    let timer = 0
    let aborted = false
    const abort = () => { aborted = true }
    const inputs = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const
    for (const type of inputs) {
      window.addEventListener(type, abort, { passive: true, capture: true })
    }

    const tick = () => {
      if (aborted) return
      const reachable = Math.max(0, el.scrollHeight - el.clientHeight)
      const wanted = Math.min(target, reachable)
      if (el.scrollTop !== wanted) el.scrollTop = wanted
      if (Date.now() - started > RESTORE_WINDOW_MS) return
      timer = window.setTimeout(tick, RESTORE_INTERVAL_MS)
    }
    tick()

    return () => {
      if (timer) window.clearTimeout(timer)
      for (const type of inputs) {
        window.removeEventListener(type, abort, { capture: true })
      }
    }
  }, [location.key, navigationType, getScrollElement])
}
