/**
 * 全屏播放器浮层（桌面/移动共用）
 * isFullscreen 变 true 时挂载 FullscreenPlayer（懒加载）；变 false 时不立刻卸载，
 * 等 FullscreenPlayer 把「收起」动画播完（封面飞回迷你条、舞台缩回播放条）回调 onExited 再卸。
 *
 * 阶段 1.7：外壳是 Radix Dialog 原语（不走 ui/dialog 的 DialogContent——
 * 那套是居中卡片样式，全屏播放器要的是铺满视口）。换来三件事：
 * - Esc 关闭；
 * - 焦点圈在浮层内（Tab 不会穿透到底下的页面）；
 * - 背景内容 inert + aria-hidden（读屏不会把底下的页面一起念出来）。
 * forceMount：收起动画的这几百毫秒里 Radix 不能先把它卸载了。
 */

import { Suspense, lazy, useState, useEffect, useRef, useCallback } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { usePlayerStore } from '@/store/playerStore'
import { useT } from '@/i18n'

const FullscreenPlayer = lazy(() =>
  import('@/components/player/FullscreenPlayer').then(mod => ({ default: mod.FullscreenPlayer }))
)

const CarMode = lazy(() =>
  import('@/components/player/CarMode').then(mod => ({ default: mod.CarMode }))
)

export function FullscreenPlayerOverlay() {
  const { t } = useT()
  const isFullscreen = usePlayerStore(s => s.isFullscreen)
  const isCarMode = usePlayerStore(s => s.isCarMode)
  const setCarMode = usePlayerStore(s => s.setCarMode)
  const setFullscreen = usePlayerStore(s => s.setFullscreen)

  const contentRef = useRef<HTMLDivElement>(null)
  const [shouldMount, setShouldMount] = useState(isFullscreen)

  useEffect(() => {
    if (isFullscreen) setShouldMount(true)
  }, [isFullscreen])

  // 收起动画播完才卸载；万一动画没回调（比如内容还没懒加载出来就被关了），900ms 兜底
  const handleExited = useCallback(() => setShouldMount(false), [])
  useEffect(() => {
    if (isFullscreen || !shouldMount) return
    const timer = setTimeout(() => setShouldMount(false), 900)
    return () => clearTimeout(timer)
  }, [isFullscreen, shouldMount])

  // 车载模式盖在最上层：它是一个独立的、面向开车场景的完整界面，
  // 不是全屏播放器的一种皮肤，所以不共用那套开合动画。
  if (isCarMode) {
    return (
      <Suspense fallback={<div className="stage fixed inset-0 z-[100] bg-stage-deep" />}>
        <CarMode onExit={() => setCarMode(false)} />
      </Suspense>
    )
  }

  if (!shouldMount) return null

  return (
    <DialogPrimitive.Root
      open={isFullscreen}
      onOpenChange={open => {
        if (!open) setFullscreen(false)
      }}
    >
      <DialogPrimitive.Portal forceMount>
        {/* 全屏播放器是「页面级」界面不是模态卡片：全局快捷键（空格/方向键等）
            不因它让位（复审 A1）。快捷键选择器用 data-fullscreen-player 把它从
            [role=dialog] 里排除。 */}
        <DialogPrimitive.Content
          ref={contentRef}
          tabIndex={-1}
          forceMount
          aria-label={t('player.nowPlaying')}
          /* Radix 需要 Title（复审 B12）：没有它开发态每次打开都
             console.error「Missing Title」。视觉隐藏，不参与排版；
             aria-label 已在 Content 上，Description 显式置空。 */
          aria-describedby={undefined}
          data-fullscreen-player=""
          className="fixed inset-0 z-50 outline-none"
          style={{ pointerEvents: isFullscreen ? 'auto' : 'none' }}
          /* 全屏铺满视口，不存在「浮层外部」——别让边缘点击误关 */
          onInteractOutside={e => e.preventDefault()}
          /* 打开时焦点落在浮层本身，而不是第一个按钮：Radix 默认聚焦「收起」键，
             iPad 接着键盘或触控板时它的提示气泡会随每次打开弹出来。
             焦点仍在浮层里，Tab 照常进入按钮，Esc 照常收起 */
          onOpenAutoFocus={e => {
            e.preventDefault()
            contentRef.current?.focus({ preventScroll: true })
          }}
        >
          <DialogPrimitive.Title className="sr-only">{t('player.nowPlaying')}</DialogPrimitive.Title>
          <Suspense fallback={<div className="stage absolute inset-0 bg-stage-deep" />}>
            <FullscreenPlayer onExited={handleExited} />
          </Suspense>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
