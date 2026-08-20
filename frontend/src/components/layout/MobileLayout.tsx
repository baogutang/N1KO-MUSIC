/**
 * 移动端布局外壳（复刻 MainLayout 的 hook 装配，壳体为移动端交互）
 * 结构：MobileHeader（安全区顶栏）→ 内容区 → MiniPlayer → BottomNav（安全区底栏）
 * 全部页面/播放器组件与桌面共用，仅外壳不同
 */

import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { MobileHeader } from './MobileHeader'
import { BottomNav } from './BottomNav'
import { MiniPlayer } from './MiniPlayer'
import { QueueDrawer } from '@/components/player/QueueDrawer'
import { FullscreenPlayerOverlay } from '@/components/player/FullscreenPlayerOverlay'
import { useNativeMediaControls } from '@/services/nativeMediaControls'
import { useNativeAppIntegration } from '@/hooks/useNativeAppIntegration'
import { Toaster } from '@/components/ui/toaster'
import { TooltipProvider } from '@/components/ui/tooltip'
import {
  prefetchCommonAuthenticatedRoutes,
  prefetchFullscreenPlayer,
} from '@/routes/lazyRoutes'

export function MobileLayout() {
  // 音频引擎与媒体会话已提升到 MainLayout，避免跨断点重挂导致当前曲重播
  useNativeMediaControls()
  useNativeAppIntegration()

  useEffect(() => {
    const warmup = () => {
      prefetchCommonAuthenticatedRoutes()
      prefetchFullscreenPlayer()
    }
    const timer = globalThis.setTimeout(warmup, 1200)
    return () => globalThis.clearTimeout(timer)
  }, [])

  return (
    <TooltipProvider>
      <div className="relative flex flex-col h-screen bg-background text-foreground overflow-hidden">
        <MobileHeader />

        <div className="relative flex flex-1 min-h-0 overflow-hidden">
          <main className="flex-1 overflow-y-auto min-w-0">
            <div className="mx-auto px-4 pb-6 w-full max-w-[1180px]">
              <Outlet />
            </div>
          </main>
          <QueueDrawer />
        </div>

        <MiniPlayer />
        <BottomNav />

        <FullscreenPlayerOverlay />
        <Toaster />
      </div>
    </TooltipProvider>
  )
}
