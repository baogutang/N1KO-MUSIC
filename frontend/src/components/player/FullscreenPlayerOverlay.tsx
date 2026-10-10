/**
 * 全屏播放器浮层（桌面/移动共用）
 * isFullscreen 时挂载 FullscreenPlayer（懒加载），带入场动画；
 * 关闭时播完 350ms 退场再卸载
 *
 * 阶段 1.7：外壳换成 Radix Dialog 原语（不走 ui/dialog 的 DialogContent——
 * 那套是居中卡片样式，全屏播放器要的是铺满视口）。换来三件事：
 * - Esc 关闭（原先 Esc 无效）；
 * - 焦点圈在浮层内（原先 Tab 能穿透到底下的页面）；
 * - 背景内容 inert + aria-hidden（读屏不会把底下的页面一起念出来）。
 * forceMount + 自管动画：退场的 350ms 里 Radix 不能先把它卸载了。
 */

import { Suspense, lazy, useState, useEffect } from 'react'
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

  // 车载模式盖在最上层：它是一个独立的、面向开车场景的完整界面，
  // 不是全屏播放器的一种皮肤，所以不共用那套入场动画。
  if (isCarMode) {
    return (
      <Suspense fallback={<div className="fixed inset-0 z-[100] bg-paper" />}>
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
        <DialogPrimitive.Content
          forceMount
          aria-label={t('player.nowPlaying')}
          className="fixed inset-0 z-50 outline-none transition-all duration-300 ease-out"
          style={{
            opacity: animateIn ? 1 : 0,
            transform: animateIn ? 'translateY(0) scale(1)' : 'translateY(40px) scale(0.97)',
            pointerEvents: isFullscreen ? 'auto' : 'none',
          }}
          /* 全屏铺满视口，不存在「浮层外部」——别让边缘点击误关 */
          onInteractOutside={e => e.preventDefault()}
        >
          <Suspense fallback={<div className="absolute inset-0 bg-background/70" />}>
            <FullscreenPlayer />
          </Suspense>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
