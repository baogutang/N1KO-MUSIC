/**
 * 内容区的滚动容器（MainLayout 的 <main>）。页面里做滚动联动（大封面随滚动缩小、
 * 标题飞进工具栏）时从这里拿，而不是去监听 window——整个应用是一块固定框架，window 不滚。
 */
import { createContext, useContext, type RefObject } from 'react'

export const ScrollContainerContext = createContext<RefObject<HTMLElement> | null>(null)

export function useScrollContainer(): RefObject<HTMLElement> | null {
  return useContext(ScrollContainerContext)
}
