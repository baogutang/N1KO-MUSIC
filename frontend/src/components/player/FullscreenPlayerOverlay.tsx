/**
 * 全屏播放器浮层（桌面/移动共用）
 * isFullscreen 时挂载 FullscreenPlayer（懒加载），带入场动画；
 * 关闭时播完 350ms 退场再卸载
 */

import { Suspense, lazy, useState, useEffect } from 'react'
import { usePlayerStore } from '@/store/playerStore'

const FullscreenPlayer = lazy(() =>
  import('@/components/player/FullscreenPlayer').then(mod => ({ default: mod.FullscreenPlayer }))
)

export function FullscreenPlayerOverlay() {
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

  if (!shouldMount) return null

  return (
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
  )
}
