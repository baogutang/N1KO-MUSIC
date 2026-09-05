/**
 * 移动端布局外壳（复刻 MainLayout 的 hook 装配，壳体为移动端交互）
 * 结构：MobileHeader（安全区顶栏）→ 内容区 → MiniPlayer → BottomNav（安全区底栏）
 * 全部页面/播放器组件与桌面共用，仅外壳不同
 */

import { useCallback, useEffect, useRef } from 'react'
import { Outlet } from 'react-router-dom'
import { MobileHeader } from './MobileHeader'
import { BottomNav } from './BottomNav'
import { MiniPlayer } from './MiniPlayer'
import { QueueDrawer } from '@/components/player/QueueDrawer'
import { FullscreenPlayerOverlay } from '@/components/player/FullscreenPlayerOverlay'
import { useNativeMediaControls } from '@/services/nativeMediaControls'
import { useNativeAppIntegration } from '@/hooks/useNativeAppIntegration'
import { useScrollMemory } from '@/hooks/useScrollMemory'
import { Toaster } from '@/components/ui/toaster'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ConnectionBanner } from './ConnectionBanner'
import { UpdatePrompt } from './UpdatePrompt'
import { Colophon, RunningHead } from './Colophon'
import { ResumeOffer } from '@/components/player/ResumeOffer'
import {
  prefetchCommonAuthenticatedRoutes,
  prefetchFullscreenPlayer,
} from '@/routes/lazyRoutes'

export function MobileLayout() {
  // 音频引擎与媒体会话已提升到 MainLayout，避免跨断点重挂导致当前曲重播
  useNativeMediaControls()
  useNativeAppIntegration()

  const mainRef = useRef<HTMLElement>(null)
  const getMain = useCallback(() => mainRef.current, [])
  useScrollMemory(getMain)

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
      <div className="relative flex flex-col h-screen h-[100dvh] bg-background text-foreground overflow-hidden">
        <MobileHeader />
        <UpdatePrompt />
        {/* 离线 / 音源登录失效 / 插件异常同走这一条。
            过期提示此前只有桌面那条 SourceAccountBanner 有，手机端从来看不到；
            那条已并进 ConnectionBanner，两种布局挂的是同一个组件。 */}
        <ConnectionBanner />
        <ResumeOffer />

        <div className="relative flex flex-1 min-h-0 overflow-hidden">
          <main ref={mainRef} className="flex-1 overflow-y-auto min-w-0">
            <div className="mx-auto px-4 pb-6 w-full max-w-[1180px]">
              <RunningHead />
              <Outlet />
              <Colophon />
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
