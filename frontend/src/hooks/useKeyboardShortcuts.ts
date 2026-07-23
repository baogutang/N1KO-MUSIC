import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePlayerStore } from '@/store/playerStore'
import { seekHowl } from '@/hooks/useAudioEngine'
import { isNativePlatform } from '@/lib/platform'

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return true
  if (target.isContentEditable) return true
  // 焦点在按钮/下拉等交互元素内部（如图标 span）时，把按键留给该元素处理
  return !!target.closest('button, select, [contenteditable="true"]')
}

/** 模态对话框（Radix Dialog 等 role=dialog/alertdialog）打开时全局快捷键不生效 */
function isDialogOpen(): boolean {
  return !!document.querySelector('[role="dialog"], [role="alertdialog"]')
}

export function useKeyboardShortcuts() {
  const navigate = useNavigate()

  useEffect(() => {
    // 原生移动端无键盘快捷键场景，直接不注册
    if (isNativePlatform) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return
      if (isDialogOpen()) return

      const meta = e.metaKey || e.ctrlKey
      const store = usePlayerStore.getState()

      if (meta && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        navigate('/search')
        return
      }

      if (e.code === 'Space') {
        e.preventDefault()
        if (store.currentSong) store.togglePlay()
        return
      }

      if (e.key === 'ArrowRight' && meta) {
        e.preventDefault()
        store.next()
        return
      }

      if (e.key === 'ArrowLeft' && meta) {
        e.preventDefault()
        if (store.currentTime > 3) {
          seekHowl(0)
        } else {
          store.prev()
        }
        return
      }

      if (e.key.toLowerCase() === 'm' && !meta) {
        e.preventDefault()
        store.toggleMute()
        return
      }

      if (e.key === 'ArrowUp' && meta) {
        e.preventDefault()
        store.setVolume(Math.min(1, store.volume + 0.05))
        return
      }

      if (e.key === 'ArrowDown' && meta) {
        e.preventDefault()
        store.setVolume(Math.max(0, store.volume - 0.05))
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [navigate])
}
