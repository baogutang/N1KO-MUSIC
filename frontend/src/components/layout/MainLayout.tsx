import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { TopBar } from './TopBar'
import { Masthead } from './Masthead'
import { TopNav } from './TopNav'
import { PlayerBar } from './PlayerBar'
import { ConnectionBanner } from './ConnectionBanner'
import { MobileLayout } from './MobileLayout'
import { QueueDrawer } from '@/components/player/QueueDrawer'
import { FullscreenPlayerOverlay } from '@/components/player/FullscreenPlayerOverlay'
import { useAudioEngine } from '@/hooks/useAudioEngine'
import { useMediaSession } from '@/hooks/useMediaSession'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { useSleepTimer } from '@/hooks/useSleepTimer'
import { useQueueSync } from '@/hooks/useQueueSync'
import { useRadioRefill } from '@/hooks/useRadioRefill'
import { useIsMobileLayout } from '@/lib/platform'
import { Toaster } from '@/components/ui/toaster'
import { TooltipProvider } from '@/components/ui/tooltip'
import {
  prefetchCommonAuthenticatedRoutes,
  prefetchFullscreenPlayer,
} from '@/routes/lazyRoutes'

export default function MainLayout() {
  const isMobile = useIsMobileLayout()

  // 音频引擎必须挂在分支之上，只挂一次。
  // 此前它挂在 DesktopLayout / MobileLayout 内部，把窗口拖过 768px 断点会让
  // 组件树整个换掉、引擎重新挂载，当前曲跳回 0:00 并重新拉流。
  useAudioEngine()
  useMediaSession()
  useKeyboardShortcuts()
  useSleepTimer()
  useQueueSync()
  useRadioRefill()

  return isMobile ? <MobileLayout /> : <DesktopLayout />
}

function DesktopLayout() {
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
      <div className="relative flex flex-col h-screen h-[100dvh] bg-background text-foreground overflow-hidden">
        {/* 顶部工具条（含 macOS 拖拽区）/ 报头 / 主导航行（DESIGN v2 §3） */}
        <TopBar />
        <ConnectionBanner />
        <Masthead />
        <TopNav />

        <div className="relative flex flex-1 min-h-0 overflow-hidden">
          <main className="flex-1 overflow-y-auto min-w-0">
            <div className="max-w-[1180px] mx-auto px-10 pb-16 w-full">
              <Outlet />
            </div>
          </main>
          <QueueDrawer />
        </div>

        {/* 底部播放条：docked 在布局流内，不再浮空 */}
        <PlayerBar />

        <FullscreenPlayerOverlay />

        <Toaster />
      </div>
    </TooltipProvider>
  )
}
