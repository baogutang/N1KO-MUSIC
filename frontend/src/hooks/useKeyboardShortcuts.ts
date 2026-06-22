import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePlayerStore } from '@/store/playerStore'
import { seekHowl } from '@/hooks/useAudioEngine'

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable
}

export function useKeyboardShortcuts() {
  const navigate = useNavigate()

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return

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
