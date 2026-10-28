/**
 * 主布局：v5 只有一个外壳，按**窗口宽度**换导航形态（见 lib/platform 的 useWindowClass）。
 *
 *   compact  <600     内容 + 底部（迷你播放条 + 标签栏）
 *   regular  600–1023 侧边导航条 | 内容 + 底部播放条
 *   wide     ≥1024    侧栏 | 内容 | 正在播放面板，底部播放条横跨内容与面板
 *
 * 以前是「原生壳一律走手机外壳」，13 寸 iPad 也只有底部标签栏；而且两套外壳是两棵树，
 * 窗口拖过断点就整棵换掉。现在 iPhone Duo 开合、iPad 分屏 / 台前调度改窗口大小，
 * 只是同一棵树换几块导航，页面、滚动位置、播放状态都不动。
 *
 * 底部播放区浮在内容上方：内容滚到它下面去，滚动区底部留出它的实际高度（--dock-h，实测）。
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { AppSidebar } from './AppSidebar'
import { AppRail } from './AppRail'
import { AppToolbar } from './AppToolbar'
import { TabBar } from './TabBar'
import { PlayerBar } from './PlayerBar'
import { NowPlayingPanel } from './NowPlayingPanel'
import { ShortcutSheet } from './ShortcutSheet'
import { ConnectionBanner } from './ConnectionBanner'
import { UpdatePrompt } from './UpdatePrompt'
import { useShellLayout } from './useShellLayout'
import { CommandPalette } from '@/components/CommandPalette'
import { ResumeOffer } from '@/components/player/ResumeOffer'
import { QueueDrawer } from '@/components/player/QueueDrawer'
import { FullscreenPlayerOverlay } from '@/components/player/FullscreenPlayerOverlay'
import { useAudioEngine } from '@/hooks/useAudioEngine'
import { useMediaSession } from '@/hooks/useMediaSession'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { useShellShortcuts } from '@/hooks/useShellShortcuts'
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
import { useNativeAppIntegration } from '@/hooks/useNativeAppIntegration'
import { useArtLight } from '@/hooks/useArtLight'
import { useWheelInertia } from '@/hooks/useWheelInertia'
import { usePlayerStore } from '@/store/playerStore'
import { ArtWash } from '@/components/art/ArtWash'
import { ScrollContainerContext } from './scrollContainer'
import { useNativeMediaControls } from '@/services/nativeMediaControls'
import { Toaster } from '@/components/ui/toaster'
import { TooltipProvider } from '@/components/ui/tooltip'
import {
  prefetchCommonAuthenticatedRoutes,
  prefetchFullscreenPlayer,
} from '@/routes/lazyRoutes'

/** 页面大标题大约这么高：滚过它，工具栏才浮现栏目名 */
const TITLE_REVEAL_PX = 56

export default function MainLayout() {
  // 音频引擎与各类会话只挂一次，挂在所有布局分支之上：换布局不会让当前曲重新拉流
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
  // 原生壳集成：锁屏控制、状态栏、返回键……两者内部都先判断是否原生，网页上是空操作
  useNativeMediaControls()
  useNativeAppIntegration()
  // 房间的光：当前封面的色相写进根元素的 --art-*
  useArtLight()

  const { wc, sidebarVisible, panelVisible } = useShellLayout()
  const { sheetOpen, closeSheet } = useShellShortcuts(panelVisible)
  const location = useLocation()

  const shellRef = useRef<HTMLDivElement>(null)
  const mainRef = useRef<HTMLElement>(null)
  const dockRef = useRef<HTMLDivElement>(null)
  const getMain = useCallback(() => mainRef.current, [])
  useScrollMemory(getMain)
  // 鼠标滚轮一格一格地跳时补一段滑行（触控板、触屏不碰）
  useWheelInertia(getMain)
  // 没有歌的时候不留一整栏空面板：第一首歌开始放，面板才出现
  const hasSong = usePlayerStore(s => !!s.currentSong)
  const showPanel = panelVisible && hasSong

  /* 滚动边缘：内容滚到工具栏底下才铺纸色；大标题滚走才浮现栏目名 */
  const [scrolled, setScrolled] = useState(false)
  const [titled, setTitled] = useState(false)
  const syncScroll = useCallback(() => {
    const top = mainRef.current?.scrollTop ?? 0
    setScrolled(top > 4)
    setTitled(top > TITLE_REVEAL_PX)
  }, [])
  useEffect(() => {
    // 换页后滚动位置由 useScrollMemory 还原（或归零），不一定会触发 scroll 事件
    const id = requestAnimationFrame(syncScroll)
    return () => cancelAnimationFrame(id)
  }, [location.key, syncScroll])

  /* 底部播放区的实际高度：内容区留白、面板底边、toast 的位置都按它来 */
  useLayoutEffect(() => {
    const dock = dockRef.current
    const shell = shellRef.current
    if (!dock || !shell) return
    const apply = () => shell.style.setProperty('--dock-h', `${Math.ceil(dock.getBoundingClientRect().height)}px`)
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(dock)
    return () => ro.disconnect()
  }, [wc])

  /* 空闲时预取常用路由与全屏播放器 */
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

  const leftColumn = sidebarVisible ? 'minmax(244px, 272px)' : wc === 'regular' ? '96px' : '0px'
  const rightColumn = showPanel ? 'minmax(312px, 356px)' : '0px'

  return (
    <TooltipProvider delayDuration={850} skipDelayDuration={300}>
      <ScrollContainerContext.Provider value={mainRef}>
      {/* 命令面板对所有宽度都可用（接键盘的 iPad 同样受益） */}
      <CommandPalette />
      <div
        ref={shellRef}
        data-window-class={wc}
        className="relative isolate grid h-full overflow-clip text-ink"
        style={{ gridTemplateColumns: `${leftColumn} minmax(0, 1fr) ${rightColumn}`, gridTemplateRows: 'minmax(0, 1fr)' }}
      >
        {/* 房间的光：铺在最底下，侧栏与面板是半透明的，光从它们底下透出来 */}
        <ArtWash className="absolute inset-x-0 top-0 -z-10 h-[96vh]" />
        {sidebarVisible && <AppSidebar />}
        {wc === 'regular' && <AppRail />}

        <div className="relative col-start-2 row-start-1 min-h-0 min-w-0">
          <main
            ref={mainRef}
            onScroll={syncScroll}
            className="absolute inset-0 overflow-y-auto overscroll-contain"
            style={{ paddingBottom: 'calc(var(--dock-h, 96px) + 24px)' }}
          >
            <AppToolbar scrolled={scrolled} titled={titled}>
              <UpdatePrompt />
              {/* 离线 / 音源登录失效 / 插件异常同走这一条 */}
              <ConnectionBanner />
              <ResumeOffer />
            </AppToolbar>
            <div
              className="mx-auto w-full max-w-[1240px] px-4 regular:px-6 wide:px-8"
              style={wc === 'compact' ? {
                paddingLeft: 'max(16px, env(safe-area-inset-left))',
                paddingRight: 'max(16px, env(safe-area-inset-right))',
              } : undefined}
            >
              {/* 换页：新页面淡入（只动透明度——位移会打乱详情页「封面从卡片飞过来」的落点测量） */}
              <div key={location.pathname} className="animate-route-in motion-reduce:animate-none">
                <Outlet />
              </div>
            </div>
          </main>
          <QueueDrawer />
        </div>

        {showPanel && <NowPlayingPanel />}

        {/* 底部播放区：横跨内容列与面板列，浮在内容上方。
            绝对定位在网格区域里（网格项的包含块就是它的网格区域），不用 sticky：
            外壳本来就不滚动，sticky 只会多出一层要由 WebKit 在界面进程里摆位置的吸附层 */}
        <div
          ref={dockRef}
          className="pointer-events-none absolute inset-x-0 bottom-0 z-40 col-start-2 col-end-[-1] row-start-1 flex flex-col gap-2 px-2 regular:px-3"
          style={{
            paddingBottom: 'calc(env(safe-area-inset-bottom) + 8px)',
            paddingRight: 'calc(env(safe-area-inset-right) + 8px)',
            paddingLeft: wc === 'compact' ? 'calc(env(safe-area-inset-left) + 8px)' : undefined,
          }}
        >
          {/* 底部的一层渐隐：内容滚到玻璃胶囊底下时仍然看得见，但不抢字 */}
          <div
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 -z-10 h-[calc(100%+32px)] bg-gradient-to-t from-ground via-ground/80 to-ground/0"
          />
          <PlayerBar wc={wc} />
          {wc === 'compact' && <TabBar />}
        </div>

        <FullscreenPlayerOverlay />
        <Toaster />
        <ShortcutSheet open={sheetOpen} onClose={closeSheet} />
      </div>
      </ScrollContainerContext.Provider>
    </TooltipProvider>
  )
}
