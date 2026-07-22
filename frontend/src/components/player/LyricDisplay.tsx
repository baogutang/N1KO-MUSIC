/**
 * 歌词同步显示组件 — 杂志编辑风（docs/redesign/v2/DESIGN.md §4.3）
 * - 衬线歌词流：过去行 ink-faint / 当前行 ink 700 + 前导 accent 短红线 / 未来行 ink-soft
 * - 自动滚动、高亮当前行；手动滚动后暂停自动滚动 3 秒，然后恢复
 * - 高亮色统一跟随 accent（DESIGN §1.3 单一强调色）：
 *   settingsStore 的 lyricsHighlightColor 自定义字段按重构约定忽略
 * - 点击歌词行跳转到对应时间
 *
 * 性能优化：
 * - 自行订阅 playerStore.currentTime（不再由父组件 prop 传递，
 *   避免父组件因 currentTime 高频更新而重渲染）
 * - 只在 currentIndex 变化时更新 DOM 样式
 * - 纯 color/transform 过渡，无 per-line filter 等昂贵效果
 */

import { useRef, useEffect, useCallback, useMemo, memo } from 'react'
import { cn } from '@/lib/utils'
import { useLyrics } from '@/hooks/useLyrics'
import { seekHowl } from '@/hooks/useAudioEngine'
import { useSettingsStore } from '@/store/settingsStore'
import { usePlayerStore } from '@/store/playerStore'
import type { LyricLine } from '@/api/types'

/**
 * 清洗歌词行文本：剥离增强 LRC（A2 逐字时间戳）残留。
 * 服务器结构化歌词（如 Navidrome lyricsList）只摘掉了行首时间，
 * value 中可能残留 [mm:ss.xx] / <mm:ss.xx> 逐字标签，直接渲染会满屏括号
 */
function cleanLyricText(text: string): string {
  return text
    .replace(/[[<]\d{1,2}:\d{2}(?:[.:]\d{1,3})?[\]>]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

interface LyricDisplayProps {
  lines: LyricLine[]
  /** 外部传入的播放时间（秒）。省略则自行从 store 订阅 */
  currentTimeSec?: number
  /** 是否紧凑模式（全屏播放器用大字，侧边栏用小字）*/
  variant?: 'fullscreen' | 'panel'
  className?: string
}

export const LyricDisplay = memo(function LyricDisplay({
  lines,
  currentTimeSec: externalTime,
  variant = 'fullscreen',
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

  // 歌词字号设置（14–36px）仍然生效，基准改为衬线
  const lyricsFontSize = useSettingsStore(s => s.lyricsFontSize)

  // 展示用文本：剥离逐字时间戳残留；纯时间行（清洗后为空）显示 ♪ 占位
  const displayTexts = useMemo(
    () => lines.map(l => cleanLyricText(l.text) || '♪'),
    [lines]
  )

  const containerRef = useRef<HTMLDivElement>(null)
  const activeLineRef = useRef<HTMLParagraphElement>(null)
  // 手动滚动锁定：记录最后一次手动滚动时间
  const lastManualScrollRef = useRef<number>(0)
  const AUTO_SCROLL_RESUME_DELAY = 3000 // 3 秒后恢复自动滚动
  // 程序化滚动标志：scrollToActive 的平滑滚动同样会触发 scroll 事件，
  // 必须与用户手动滚动区分，否则每次自动滚动都会把自己锁定 3 秒
  const isProgrammaticScrollRef = useRef(false)
  const programmaticSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** 刷新程序化滚动的"结束"计时：平滑滚动停止约 150ms 后清除标志 */
  const armProgrammaticSettle = useCallback(() => {
    if (programmaticSettleTimerRef.current) clearTimeout(programmaticSettleTimerRef.current)
    programmaticSettleTimerRef.current = setTimeout(() => {
      isProgrammaticScrollRef.current = false
      programmaticSettleTimerRef.current = null
    }, 150)
  }, [])

  // 监听手动滚动
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleScroll = () => {
      if (isProgrammaticScrollRef.current) {
        // 自动滚动产生的事件：只顺延结束计时，不算作手动滚动
        armProgrammaticSettle()
        return
      }
      lastManualScrollRef.current = Date.now()
    }
    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      container.removeEventListener('scroll', handleScroll)
      if (programmaticSettleTimerRef.current) clearTimeout(programmaticSettleTimerRef.current)
    }
  }, [armProgrammaticSettle])

  // 自动滚动到当前歌词行（高亮行始终居中于容器可视区域）
  const scrollToActive = useCallback(() => {
    if (!isSynced || currentIndex < 0) return
    // 如果最近 3 秒内有手动滚动，跳过自动滚动
    if (Date.now() - lastManualScrollRef.current < AUTO_SCROLL_RESUME_DELAY) return

    const container = containerRef.current
    const activeLine = activeLineRef.current
    if (!container || !activeLine) return

    // 使用 getBoundingClientRect 而非 offsetTop，避免 offsetParent 差异导致计算不准
    const containerRect = container.getBoundingClientRect()
    const lineRect = activeLine.getBoundingClientRect()
    const lineCenter = (lineRect.top - containerRect.top) + lineRect.height / 2
    const desiredCenter = containerRect.height / 2
    const targetScrollTop = container.scrollTop + (lineCenter - desiredCenter)

    // 标记程序化滚动；即使滚动距离为 0 不触发 scroll 事件，计时器也会兜底清除标志
    isProgrammaticScrollRef.current = true
    armProgrammaticSettle()
    container.scrollTo({
      top: Math.max(0, targetScrollTop),
      behavior: 'smooth',
    })
  }, [currentIndex, isSynced, armProgrammaticSettle])

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
        <p className="font-serif text-[15px] text-ink-faint">纯音乐，或无歌词可用</p>
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
      style={{
        scrollBehavior: 'smooth',
        // 上下 22% 渐隐遮罩（DESIGN.md §4.3 正在播放页）
        ...(variant === 'fullscreen'
          ? {
              maskImage: 'linear-gradient(180deg, transparent, #000 22%, #000 78%, transparent)',
              WebkitMaskImage: 'linear-gradient(180deg, transparent, #000 22%, #000 78%, transparent)',
            }
          : {}),
      }}
    >
      <div className={cn(
        'space-y-4 px-6',
        variant === 'fullscreen' ? 'min-h-full flex flex-col justify-center' : ''
      )}>
        {lines.map((line, index) => {
          const isActive = isSynced && index === currentIndex
          const isClickable = isSynced && line.time >= 0

          return (
            <p
              key={index}
              ref={isActive ? activeLineRef : null}
              onClick={() => handleLineClick(line)}
              className={cn(
                'flex items-center font-serif leading-relaxed text-left origin-left',
                'transition-[color,transform] duration-300 ease-[var(--ease)]',
                // 过去行 ink-faint / 当前行 ink 700 / 未来行 ink-soft；未同步整体 ink-soft
                isActive
                  ? 'text-ink font-bold translate-x-1'
                  : isSynced && index < currentIndex
                    ? 'text-ink-faint'
                    : 'text-ink-soft',
                isClickable ? 'cursor-pointer select-none' : 'select-none',
                isClickable && !isActive && 'hover:text-ink hover:translate-x-1',
              )}
              style={{
                fontSize: variant === 'fullscreen' ? `${lyricsFontSize}px` : '14px',
              }}
            >
              {/* 前导 accent 短红线（2px × 18px），仅当前行可见；占位固定避免行间错位 */}
              <span
                aria-hidden="true"
                className="flex-none w-[18px] h-[2px] mr-3 rounded-full bg-primary transition-opacity duration-300"
                style={{ opacity: isActive ? 1 : 0 }}
              />
              <span className="min-w-0">{displayTexts[index]}</span>
            </p>
          )
        })}
      </div>
    </div>
  )
})
