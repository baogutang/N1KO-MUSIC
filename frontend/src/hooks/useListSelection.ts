/**
 * 列表多选。
 *
 * 单机端已有的模型（⌘/Ctrl 点选、Shift 连选）在这里照搬，因为用户在
 * Finder / 资源管理器里已经会了；触摸端没有修饰键，改成长按进入选择态、
 * 之后普通点击即勾选——这是移动端通行的做法，也让选择条自己成为提示。
 *
 * 选择集按 id 存，不按下标：翻页、加载更多、乐观更新都会让下标漂移，
 * 而 id 不会。
 */

import { useCallback, useMemo, useRef, useState } from 'react'

export interface ListSelection<T> {
  /** 已选中的 id */
  ids: ReadonlySet<string>
  count: number
  active: boolean
  isSelected: (id: string) => boolean
  /** 普通点击：选择态下即勾选，非选择态返回 false 交回调用方（去播放） */
  handleClick: (index: number, event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => boolean
  /** 长按：无条件进入选择态（触摸端唯一的入口） */
  beginAt: (index: number) => void
  toggleAt: (index: number) => void
  selectAll: () => void
  clear: () => void
  /** 按当前列表顺序取出选中项 */
  selectedItems: () => T[]
}

export function useListSelection<T>(
  items: T[],
  getId: (item: T, index: number) => string
): ListSelection<T> {
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set())
  /**
   * 选择集的同步镜像。
   *
   * 事件处理里需要「此刻选了几个」这个事实，而 state 在同一轮事件里读到的
   * 可能还是上一帧的值。镜像在每次渲染时更新，读它总是当前这一帧的真相。
   */
  const idsRef = useRef(ids)
  idsRef.current = ids
  /** Shift 连选的锚点 */
  const anchorRef = useRef<number | null>(null)

  // items 每次渲染多是新数组引用，用 ref 读最新值，回调引用才能保持稳定
  const itemsRef = useRef(items)
  itemsRef.current = items
  const getIdRef = useRef(getId)
  getIdRef.current = getId

  const toggleAt = useCallback((index: number) => {
    const item = itemsRef.current[index]
    if (!item) return
    const id = getIdRef.current(item, index)
    anchorRef.current = index
    setIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  /** 长按：无条件把这一行选中并进入选择态 */
  const beginAt = useCallback((index: number) => {
    const item = itemsRef.current[index]
    if (!item) return
    anchorRef.current = index
    setIds(prev => {
      const id = getIdRef.current(item, index)
      if (prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }, [])

  const selectRangeTo = useCallback((index: number) => {
    const list = itemsRef.current
    const from = anchorRef.current ?? index
    const [lo, hi] = from <= index ? [from, index] : [index, from]
    setIds(prev => {
      const next = new Set(prev)
      for (let i = lo; i <= hi; i++) {
        const item = list[i]
        if (item) next.add(getIdRef.current(item, i))
      }
      return next
    })
  }, [])

  const handleClick = useCallback((
    index: number,
    event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }
  ) => {
    if (event.shiftKey) {
      selectRangeTo(index)
      return true
    }
    if (event.metaKey || event.ctrlKey) {
      toggleAt(index)
      return true
    }
    /**
     * 已经在选择态时，普通点击继续勾选（触摸端唯一的可用手势）。
     *
     * 判断走 ref 而不是 setState 的 updater 返回值。
     * 之前是在 updater 里置一个外部变量再读出来——那只在 React 恰好同步执行
     * reducer 时成立（当前 fiber 上没有其它待处理更新）。哪天这个 handler 里
     * 多一个 setState，它就会静默返回 false，于是选择态下点一行**开始播放**。
     * 这种「今天碰巧对」的写法不该留在决定用户听不听得到声音的路径上。
     */
    if (idsRef.current.size === 0) return false
    toggleAt(index)
    return true
  }, [selectRangeTo, toggleAt])

  const selectAll = useCallback(() => {
    setIds(new Set(itemsRef.current.map((item, i) => getIdRef.current(item, i))))
  }, [])

  const clear = useCallback(() => {
    anchorRef.current = null
    setIds(prev => (prev.size === 0 ? prev : new Set()))
  }, [])

  const selectedItems = useCallback(
    () => itemsRef.current.filter((item, i) => ids.has(getIdRef.current(item, i))),
    [ids]
  )

  const isSelected = useCallback((id: string) => ids.has(id), [ids])

  return useMemo(() => ({
    ids,
    count: ids.size,
    active: ids.size > 0,
    isSelected,
    handleClick,
    beginAt,
    toggleAt,
    selectAll,
    clear,
    selectedItems,
  }), [ids, isSelected, handleClick, beginAt, toggleAt, selectAll, clear, selectedItems])
}
