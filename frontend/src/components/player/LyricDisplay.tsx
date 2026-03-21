/**
 * 歌词同步显示组件
 * - 自动滚动、高亮当前行（Apple Music 风格）
 * - 手动滚动后暂停自动滚动 3 秒，然后恢复
 * - 支持自定义高亮颜色（读取 settingsStore）
 * - 点击歌词行跳转到对应时间
 *
 * 性能优化：
 * - 自行订阅 playerStore.currentTime（不再由父组件 prop 传递，
 *   避免父组件因 currentTime 高频更新而重渲染）
 * - 只在 currentIndex 变化时更新 DOM 样式
 * - 移除昂贵的 per-line filter: blur()，改用纯 opacity 实现远近效果
 */

import { useRef, useEffect, useCallback, memo } from 'react'
import { cn } from '@/lib/utils'
import { useLyrics } from '@/hooks/useLyrics'
import { seekHowl } from '@/hooks/useAudioEngine'
import { useSettingsStore } from '@/store/settingsStore'
import { usePlayerStore } from '@/store/playerStore'
import type { LyricLine } from '@/api/types'

interface LyricDisplayProps {
  lines: LyricLine[]
  /** 外部传入的播放时间（秒）。省略则自行从 store 订阅 */
  currentTimeSec?: number
  /** 是否紧凑模式（全屏播放器用大字，侧边栏用小字）*/
  variant?: 'fullscreen' | 'panel'
  /** 非高亮行的基础颜色，全屏播放器传 'white'，普通模式不传 */
  baseColor?: 'white' | 'default'
  className?: string
}

export const LyricDisplay = memo(function LyricDisplay({
  lines,
  currentTimeSec: externalTime,
  variant = 'fullscreen',
  baseColor = 'default',
  className,
}: LyricDisplayProps) {
  // 自行从 store 订阅 currentTime（如果外部没传）
  const storeTime = usePlayerStore(s => s.currentTime)
  const currentTimeSec = externalTime ?? storeTime

  const { currentIndex, hasLyrics, isSynced } = useLyrics({
    currentTimeSec,
    lines,
    offset: 500,
  })

  const { lyricsHighlightColor, lyricsFontSize } = useSettingsStore()

  const containerRef = useRef<HTMLDivElement>(null)
  const activeLineRef = useRef<HTMLParagraphElement>(null)
  // 手动滚动锁定：记录最后一次手动滚动时间
  const lastManualScrollRef = useRef<number>(0)
  const AUTO_SCROLL_RESUME_DELAY = 3000 // 3 秒后恢复自动滚动

  // 监听手动滚动
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let scrollTimer: ReturnType<typeof setTimeout> | undefined
    const handleScroll = () => {
      lastManualScrollRef.current = Date.now()
    }
    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      container.removeEventListener('scroll', handleScroll)
      if (scrollTimer) clearTimeout(scrollTimer)
    }
  }, [])

  // 自动滚动到当前歌词行
  const scrollToActive = useCallback(() => {
    if (!isSynced || currentIndex < 0) return
    // 如果最近 3 秒内有手动滚动，跳过自动滚动
    if (Date.now() - lastManualScrollRef.current < AUTO_SCROLL_RESUME_DELAY) return

    const container = containerRef.current
    const activeLine = activeLineRef.current
    if (!container || !activeLine) return

    const containerHeight = container.clientHeight
    const lineTop = activeLine.offsetTop
    const lineHeight = activeLine.clientHeight
    const targetScrollTop = lineTop - containerHeight / 2 + lineHeight / 2

    container.scrollTo({
      top: Math.max(0, targetScrollTop),
      behavior: 'smooth',
    })
  }, [currentIndex, isSynced])

  useEffect(() => {
    scrollToActive()
  }, [scrollToActive])

  // 点击歌词行跳转到对应时间（毫秒 → 秒）
  function handleLineClick(line: LyricLine) {
    if (!isSynced || line.time < 0) return
    seekHowl(line.time / 1000)
    // 点击跳转后立刻取消手动滚动锁，允许自动滚动跟随
    lastManualScrollRef.current = 0
  }

  if (!hasLyrics) {
    return (
      <div className={cn('flex items-center justify-center h-full', className)}>
        <p className="text-muted-foreground text-sm">暂无歌词</p>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        'overflow-y-auto scrollbar-hide py-12',
        variant === 'fullscreen' ? 'h-full' : 'h-64',
        className
      )}
      style={{ scrollBehavior: 'smooth' }}
    >
      <div className={cn(
        'space-y-4 px-6',
        variant === 'fullscreen' ? 'min-h-full flex flex-col justify-center' : ''
      )}>
        {lines.map((line, index) => {
          const isActive = index === currentIndex
          const isPast = isSynced && index < currentIndex
          const isNear = Math.abs(index - currentIndex) <= 2
          const isClickable = isSynced && line.time >= 0

          // 纯 opacity 方案（移除昂贵的 per-line filter: blur()）
          const lineOpacity = isActive
            ? 1
            : isSynced
              ? isPast
                ? 0.3
                : isNear
                  ? 0.55
                  : 0.2
              : 0.85

          return (
            <p
              key={index}
              ref={isActive ? activeLineRef : null}
              onClick={() => handleLineClick(line)}
              className={cn(
                'leading-relaxed text-center',
                isClickable ? 'cursor-pointer select-none' : 'select-none',
                isClickable && !isActive && 'hover:scale-[1.02]',
              )}
              style={{
                fontSize: variant === 'fullscreen' ? `${lyricsFontSize}px` : undefined,
                fontWeight: variant === 'fullscreen' ? 600 : undefined,
                color: isActive
                  ? lyricsHighlightColor
                  : baseColor === 'white' ? 'rgba(255,255,255,0.85)' : undefined,
                opacity: lineOpacity,
                transform: isActive ? 'scale(1.05)' : undefined,
                transformOrigin: 'center center',
                transition: 'opacity 0.45s ease, transform 0.45s ease, color 0.45s ease',
              }}
            >
              {line.text}
            </p>
          )
        })}
      </div>
    </div>
  )
})
