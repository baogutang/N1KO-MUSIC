import { Suspense, lazy, useState, useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { PlayerBar } from './PlayerBar'
import { QueueDrawer } from '@/components/player/QueueDrawer'
import { useAudioEngine } from '@/hooks/useAudioEngine'
import { useMediaSession } from '@/hooks/useMediaSession'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { usePlayerStore } from '@/store/playerStore'
import { Toaster } from '@/components/ui/toaster'
import { TooltipProvider } from '@/components/ui/tooltip'
import {
  prefetchCommonAuthenticatedRoutes,
  prefetchFullscreenPlayer,
} from '@/routes/lazyRoutes'

const FullscreenPlayer = lazy(() =>
  import('@/components/player/FullscreenPlayer').then(mod => ({ default: mod.FullscreenPlayer }))
)

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)

export default function MainLayout() {
  useAudioEngine()
  useMediaSession()
  useKeyboardShortcuts()

  const isFullscreen = usePlayerStore(s => s.isFullscreen)

  const [shouldMount, setShouldMount] = useState(false)
  const [animateIn, setAnimateIn] = useState(false)

  useEffect(() => {
    if (isFullscreen) {
      setShouldMount(true)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setAnimateIn(true))
      })
    } else {
      setAnimateIn(false)
      const timer = setTimeout(() => setShouldMount(false), 350)
      return () => clearTimeout(timer)
    }
  }, [isFullscreen])

  useEffect(() => {
    const warmup = () => {
      prefetchCommonAuthenticatedRoutes()
      prefetchFullscreenPlayer()
    }
    const requestIdle = (globalThis as {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
    }).requestIdleCallback
    const cancelIdle = (globalThis as {
      cancelIdleCallback?: (handle: number) => void
    }).cancelIdleCallback
    if (requestIdle && cancelIdle) {
      const id = requestIdle(warmup, { timeout: 2200 })
      return () => cancelIdle(id)
    }
    const timer = globalThis.setTimeout(warmup, 1200)
    return () => globalThis.clearTimeout(timer)
  }, [])

  return (
    <TooltipProvider>
      <div className="relative flex flex-col h-screen bg-background text-foreground overflow-hidden">
        {isMac && (
          <div
            className="h-9 flex-shrink-0"
            data-tauri-drag-region
            style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
          />
        )}

        <div className="flex flex-1 min-h-0 overflow-hidden">
          <Sidebar />

          <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
            <TopBar />

            <div className="relative flex flex-1 min-h-0 overflow-hidden">
              {/* 底部预留 ~120px（--player-height + 12px），避免内容藏在悬浮控制台下 */}
              <main className="flex-1 overflow-y-auto min-w-0 pb-[calc(var(--player-height)+12px)]">
                <Outlet />
              </main>
              <QueueDrawer />
            </div>
          </div>
        </div>

        <PlayerBar />

        {shouldMount && (
          <div
            className="fixed inset-0 z-50 transition-all duration-300 ease-out"
            style={{
              opacity: animateIn ? 1 : 0,
              transform: animateIn ? 'translateY(0) scale(1)' : 'translateY(40px) scale(0.97)',
              pointerEvents: isFullscreen ? 'auto' : 'none',
            }}
          >
            <Suspense fallback={<div className="absolute inset-0 bg-background/70" />}>
              <FullscreenPlayer />
            </Suspense>
          </div>
        )}

        <Toaster />
      </div>
    </TooltipProvider>
  )
}
