import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePlayerStore } from '@/store/playerStore'
import { seekHowl } from '@/hooks/useAudioEngine'
import { isNativePlatform } from '@/lib/platform'

/** 不应被快捷键抢走按键的文本录入类型 */
const TEXT_INPUT_TYPES = new Set([
  'text', 'search', 'url', 'email', 'password', 'tel', 'number', 'date', 'time', 'datetime-local',
])

/**
 * 只有真正在录入文字时才让出按键。
 *
 * 旧实现把 BUTTON 以及任何 button 内部的元素也算作「正在输入」，于是点过一次
 * 播放键之后焦点停在按钮上，全部全局快捷键都失效——这是最容易被当成
 * 「快捷键时灵时不灵」的一条。
 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type?.toLowerCase() ?? 'text'
    return TEXT_INPUT_TYPES.has(type)
  }
  if (target.isContentEditable) return true
  return !!target.closest('textarea, select, [contenteditable="true"]')
}

/**
 * 空格键是否应当留给当前焦点元素自己处理。
 * 焦点在按钮、链接或滑块上时，浏览器本来就会用空格激活它，
 * 此时再 preventDefault 并切换播放，等于把用户的一次按键用作两件事。
 */
function spaceBelongsToFocusedControl(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return !!target.closest('button, a[href], [role="button"], [role="slider"], [role="switch"], [role="radio"], [role="menuitem"]')
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
        // 焦点在某个控件上时空格属于那个控件，不要无条件截走
        if (spaceBelongsToFocusedControl(e.target)) return
        e.preventDefault()
        if (store.currentSong) store.togglePlay()
        return
      }

      // s / r：随机与循环，与播放条上的两个开关一一对应
      if (e.key.toLowerCase() === 's' && !meta && !e.shiftKey) {
        e.preventDefault()
        store.toggleShuffle()
        return
      }
      if (e.key.toLowerCase() === 'r' && !meta && !e.shiftKey) {
        e.preventDefault()
        const order: Array<'none' | 'all' | 'one'> = ['none', 'all', 'one']
        const nextMode = order[(order.indexOf(store.repeatMode) + 1) % order.length]
        store.setRepeatMode(nextMode)
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
