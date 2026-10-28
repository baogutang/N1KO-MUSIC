/**
 * 切亮暗：新的明暗从按下的那个点向外扩散（View Transitions）；不支持时直接切。
 * themeStore 的 toggleTheme 会同步改 <html> 的 class 与 data-theme；
 * flushSync 让依赖 resolvedTheme 的图标也在同一帧换好，快照里不会混进旧图标。
 */
import { useCallback } from 'react'
import type { MouseEvent } from 'react'
import { flushSync } from 'react-dom'
import { useThemeStore } from '@/store/themeStore'
import { originOf, radialReveal } from '@/lib/viewTransition'

export function useThemeToggle() {
  const toggleTheme = useThemeStore(s => s.toggleTheme)
  return useCallback(
    (e?: MouseEvent<HTMLElement>) => {
      radialReveal(e ? originOf(e) : null, () => flushSync(() => toggleTheme()))
    },
    [toggleTheme]
  )
}
