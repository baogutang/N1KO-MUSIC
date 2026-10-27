/**
 * 外壳级快捷键：导航、侧栏、面板、快捷键表。
 * 播放相关的（空格、方向键、⌘←→ 等）在 useKeyboardShortcuts，⌘K 归 CommandPalette。
 *
 *   ⌘1 / ⌘2 / ⌘3   首页 / 推荐 / 音乐库
 *   ⌘F             搜索
 *   ⌘L             打开或收起正在播放（歌词）
 *   ⌘[ / ⌘]        后退 / 前进
 *   ⌃⌘S            显示或隐藏侧栏（宽窗口）
 *   ⌥⌘P            显示或隐藏正在播放面板（宽窗口）
 *   ⌘/             快捷键表；按住 ⌘ 0.65 秒同样浮现，松开即收
 *
 * 一律按物理键（e.code）判断：macOS 上 ⌥ 会改写 e.key（⌥P 是 π）。
 */

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePlayerStore } from '@/store/playerStore'
import { useThemeStore } from '@/store/themeStore'
import { isDialogOpen, isTypingTarget } from '@/hooks/useKeyboardShortcuts'

const HOLD_MS = 650

export function useShellShortcuts(panelVisible: boolean) {
  const navigate = useNavigate()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [sheetHeld, setSheetHeld] = useState(false)

  useEffect(() => {
    let holdTimer = 0
    const cancelHold = () => {
      window.clearTimeout(holdTimer)
      holdTimer = 0
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Meta' && !e.repeat) {
        cancelHold()
        holdTimer = window.setTimeout(() => setSheetHeld(true), HOLD_MS)
        return
      }
      // 按下了别的键：这是一次组合键，不是「按住 ⌘ 看一眼」
      cancelHold()
      setSheetHeld(false)

      if (e.key === 'Escape') {
        setSheetOpen(false)
        return
      }
      if (!e.metaKey || isTypingTarget(e.target) || isDialogOpen()) return

      const run = (fn: () => void) => {
        e.preventDefault()
        fn()
      }
      const theme = useThemeStore.getState()
      switch (e.code) {
        case 'Digit1': return run(() => navigate('/'))
        case 'Digit2': return run(() => navigate('/recommendations'))
        case 'Digit3': return run(() => navigate('/library'))
        case 'KeyF': return run(() => navigate('/search'))
        case 'BracketLeft': return run(() => navigate(-1))
        case 'BracketRight': return run(() => navigate(1))
        case 'Slash': return run(() => setSheetOpen(open => !open))
        case 'KeyL': {
          const player = usePlayerStore.getState()
          if (!player.currentSong) return
          return run(() => player.setFullscreen(!player.isFullscreen))
        }
        case 'KeyS':
          if (e.ctrlKey) return run(() => theme.toggleSidebar())
          return
        case 'KeyP':
          if (e.altKey) return run(() => theme.setNowPlayingPanel(!panelVisible))
          return
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Meta') {
        cancelHold()
        setSheetHeld(false)
      }
    }
    const onBlur = () => {
      cancelHold()
      setSheetHeld(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      cancelHold()
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [navigate, panelVisible])

  return {
    sheetOpen: sheetOpen || sheetHeld,
    closeSheet: () => {
      setSheetOpen(false)
      setSheetHeld(false)
    },
  }
}
