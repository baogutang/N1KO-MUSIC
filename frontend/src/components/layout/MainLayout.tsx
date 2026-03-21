import { useState, useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { PlayerBar } from './PlayerBar'
import { FullscreenPlayer } from '@/components/player/FullscreenPlayer'
import { useAudioEngine } from '@/hooks/useAudioEngine'
import { usePlayerStore } from '@/store/playerStore'

/** macOS 检测（hiddenInset 模式下需要为红黄绿按钮预留安全区域）*/
const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)

export default function MainLayout() {
  // 在布局顶层挂载音频引擎，确保整个应用生命周期内只有一个 Howl 实例
  useAudioEngine()

  // 只在全屏时才挂载 FullscreenPlayer，避免始终订阅 store 导致无意义重渲染
  const isFullscreen = usePlayerStore(s => s.isFullscreen)

  // 过渡动画：延迟卸载组件以播放退出动画
  const [shouldMount, setShouldMount] = useState(false)
  const [animateIn, setAnimateIn] = useState(false)

  useEffect(() => {
    if (isFullscreen) {
      setShouldMount(true)
      // 下一帧启动进入动画
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setAnimateIn(true))
      })
    } else {
      setAnimateIn(false)
      // 退出动画结束后卸载
      const timer = setTimeout(() => setShouldMount(false), 350)
      return () => clearTimeout(timer)
    }
  }, [isFullscreen])

  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">
      {/* macOS: 标题栏安全区域，为红黄绿按钮留空 + 窗口拖拽区域 */}
      {isMac && (
        <div
          className="h-9 flex-shrink-0"
          data-tauri-drag-region
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        />
      )}

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Sidebar */}
        <Sidebar />

        {/* Main content area */}
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          {/* Top bar */}
          <TopBar />

          {/* Page content */}
          <main className="flex-1 overflow-y-auto">
            <Outlet />
          </main>
        </div>
      </div>

      {/* Bottom player bar */}
      <PlayerBar />

      {/* 全屏播放器（覆盖层）— 带过渡动画 */}
      {shouldMount && (
        <div
          className="fixed inset-0 z-50 transition-all duration-300 ease-out"
          style={{
            opacity: animateIn ? 1 : 0,
            transform: animateIn ? 'translateY(0) scale(1)' : 'translateY(40px) scale(0.97)',
          }}
        >
          <FullscreenPlayer />
        </div>
      )}
    </div>
  )
}
