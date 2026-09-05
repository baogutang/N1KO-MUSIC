import { useCallback, useEffect, useRef } from 'react'
import { Outlet } from 'react-router-dom'
import { TopBar } from './TopBar'
import { Masthead } from './Masthead'
import { TopNav } from './TopNav'
import { ClaySidebar } from './ClaySidebar'
import { PlayerBar } from './PlayerBar'
import { ConnectionBanner } from './ConnectionBanner'
import { UpdatePrompt } from './UpdatePrompt'
import { Colophon, RunningHead } from './Colophon'
import { CommandPalette } from '@/components/CommandPalette'
import { ResumeOffer } from '@/components/player/ResumeOffer'
import { MobileLayout } from './MobileLayout'
import { QueueDrawer } from '@/components/player/QueueDrawer'
import { FullscreenPlayerOverlay } from '@/components/player/FullscreenPlayerOverlay'
import { useAudioEngine } from '@/hooks/useAudioEngine'
import { useMediaSession } from '@/hooks/useMediaSession'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useSleepTimer } from '@/hooks/useSleepTimer'
import { useQueueSync } from '@/hooks/useQueueSync'
import { useRadioRefill } from '@/hooks/useRadioRefill'
import { useLongTrackBookmark } from '@/hooks/useLongTrackBookmark'
import { useDirectScrobble } from '@/hooks/useDirectScrobble'
import { useAudioInterruptions } from '@/hooks/useAudioInterruptions'
import { useDeepLinks } from '@/hooks/useDeepLinks'
import { useOfflineLibraryCache } from '@/hooks/useOfflineLibraryCache'
import { useScrollMemory } from '@/hooks/useScrollMemory'
import { cn } from '@/lib/utils'
import { useIsMobileLayout } from '@/lib/platform'
import { useThemeStore } from '@/store/themeStore'
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
  useDocumentTitle()
  useSleepTimer()
  useQueueSync()
  useRadioRefill()
  useLongTrackBookmark()
  useDirectScrobble()
  useAudioInterruptions()
  useDeepLinks()
  useOfflineLibraryCache()

  return (
    <>
      {/* 命令面板对两种布局都可用（外接键盘的平板同样受益） */}
      <CommandPalette />
      {isMobile ? <MobileLayout /> : <DesktopLayout />}
    </>
  )
}

function DesktopLayout() {
  const isClay = useThemeStore(state => state.skin === 'clay')
  const mainRef = useRef<HTMLElement>(null)
  const getMain = useCallback(() => mainRef.current, [])
  useScrollMemory(getMain)

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
        {/*
          顶部工具条（含 macOS 拖拽区）/ 报头 / 主导航行（DESIGN v2 §3）。

          软陶把报头塞进顶栏的中间插槽（DESIGN v4 C1+C4）：
          原来的排法是「顶栏一行 + 报头横跨全宽一行 + 侧栏从报头下方开始」，
          三条横向切割把窗口切成了千层饼，侧栏也就不可能通高。
          软陶下这两行合成一条栏杆——返回/前进落在侧栏那一列的上方，
          报头面板从内容列的左缘开始、一直铺到右端，工具组坐在它的右端。
          于是侧栏从这条栏杆下面一路贯到播放条上方，中间不再有横切。

          为什么不是把 <Masthead/> 放进内容列里再用负边距提上来：
          内容列在 overflow-hidden 的那一行里（队列抽屉靠它裁剪），
          负边距会被裁掉；改用绝对定位又要把顶栏抬到内容之上，
          于是得给拖拽区补 pointer-events、给连接横幅让位——
          为了「看起来在一行」欠下三笔债。塞插槽是同一个结果、零债务。
        */}
        <TopBar>{isClay ? <Masthead /> : null}</TopBar>
        <UpdatePrompt />
        {/* 离线 / 音源登录失效 / 插件异常同走这一条（手机端在 MobileLayout 里挂同一个） */}
        <ConnectionBanner />
        <ResumeOffer />
        {/* 软陶的报头已经在顶栏的插槽里，这里不再渲染第二份 */}
        {isClay ? null : <Masthead />}
        {/*
          版面骨架按皮肤分叉，全站只此一处。
          编辑风 / 波普是「顶部一行横导航」的杂志骨架；软陶是「左侧一块竖面板」
          的仪表盘骨架（理由见 ClaySidebar.tsx 的文件头）。横竖两种导航的 DOM
          结构本就不同，用 CSS 互转只会得到两边都别扭的一份结构。
        */}
        {isClay ? null : <TopNav />}

        <div className="relative flex flex-1 min-h-0 overflow-hidden">
          {isClay && <ClaySidebar />}
          <main
            ref={mainRef}
            className={cn('flex-1 overflow-y-auto min-w-0', isClay && 'clay-main')}
          >
            <div
              className={cn(
                'pb-16 w-full',
                isClay ? 'max-w-[1180px] pr-8 pl-2' : 'max-w-[1180px] mx-auto px-10'
              )}
            >
              <RunningHead />
              {/* clay-page：软陶下「每一页本身就是一张卡片」的挂载点。
                  另外两张皮没有对应规则，它只是一层透明的 div。 */}
              <div className="clay-page">
                <Outlet />
              </div>
              <Colophon />
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
