/**
 * 歌词同步显示组件（v6）
 * - 全屏（舞台）：大字，当前行全亮、其余行退到四成；换行时当前行从 97% 轻轻放大到 100%
 *   （只动 transform / opacity，字重不变，不重排）
 * - 面板：外壳里的小字版本，墨色分层
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
import { spaceCJK } from '@/utils/cjkTypography'
import { useLyrics } from '@/hooks/useLyrics'
import { seekHowl } from '@/hooks/useAudioEngine'
import { useSettingsStore } from '@/store/settingsStore'
import { usePlayerStore } from '@/store/playerStore'
import type { LyricLine } from '@/api/types'
import { useT } from '@/i18n'

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
  const { t } = useT()
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
  /**
   * 手动滚开后多久恢复自动跟随。
   *
   * 3 秒太短：想往回看几句歌词，还没读完就被拽回当前行，只能一遍遍地滚。
   * 8 秒够读完一小段，又不至于让人以为自动跟随坏了。
   */
  const AUTO_SCROLL_RESUME_DELAY = 8000
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
    // 全屏：当前行停在三分之一处（上面留两三行刚唱过的），面板里居中
    const desiredCenter = containerRect.height * (variant === 'fullscreen' ? 0.32 : 0.5)
    const targetScrollTop = container.scrollTop + (lineCenter - desiredCenter)

    // 标记程序化滚动；即使滚动距离为 0 不触发 scroll 事件，计时器也会兜底清除标志
    isProgrammaticScrollRef.current = true
    armProgrammaticSettle()
    container.scrollTo({
      top: Math.max(0, targetScrollTop),
      /* 前庭安全（阶段 7.6）：系统开了「减少动态」就直跳，不做平滑滚动 */
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
    })
  }, [currentIndex, isSynced, armProgrammaticSettle, variant])

  useEffect(() => {
    scrollToActive()
  }, [scrollToActive])

  /**
   * 点击歌词行跳转到对应时间（毫秒 → 秒）。
   *
   * 必须是稳定引用：LyricRow 是 memo 的，onSelect 每次渲染都换新函数的话
   * memo 永远不会 bail out，「只重渲染两行」的优化等于没做。
   * isSynced 通过 ref 读取，保持依赖为空。
   */
  const isSyncedRef = useRef(isSynced)
  isSyncedRef.current = isSynced
  const handleLineClick = useCallback((line: LyricLine) => {
    if (!isSyncedRef.current || line.time < 0) return
    seekHowl(line.time / 1000)
    // 点击跳转后立刻取消手动滚动锁，允许自动滚动跟随
    lastManualScrollRef.current = 0
  }, [])

  if (!hasLyrics) {
    return (
      <div className={cn('flex items-center justify-center h-full', className)}>
        <p className="text-[15px] text-ink-3">{t('lyrics.none')}</p>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        'overflow-y-auto scrollbar-hide',
        // 上下渐隐（lyric-fade，见 index.css）：全屏与面板都用，面板里那几行也不该被生硬切断
        // 全屏：第一句从顶上开始（不在三分之一处悬着一大片空），底下留够当前行滚到锚点的余量
        variant === 'fullscreen' ? 'h-full pb-[48vh] pt-[7vh] lyric-fade-top' : 'h-64 py-12 lyric-fade',
        className
      )}
      style={{ scrollBehavior: 'smooth' }}
    >
      <div className={cn(
        variant === 'fullscreen' ? 'flex flex-col gap-[0.55em] px-2' : 'space-y-3 px-4'
      )}
        style={variant === 'fullscreen' ? { fontSize: `${Math.min(44, Math.round(lyricsFontSize * 1.4))}px` } : undefined}
      >
        {lines.map((line, index) => (
          <LyricRow
            key={index}
            text={displayTexts[index]}
            fontSize={variant === 'fullscreen' ? null : 14}
            stage={variant === 'fullscreen'}
            isActive={isSynced && index === currentIndex}
            isPast={isSynced && index < currentIndex}
            isClickable={isSynced && line.time >= 0}
            activeRef={isSynced && index === currentIndex ? activeLineRef : undefined}
            onSelect={handleLineClick}
            line={line}
          />
        ))}
      </div>
    </div>
  )
})


/**
 * 单行歌词。
 *
 * 播放中 currentTime 每秒变化数次，整份歌词此前会跟着整体重渲染——
 * 全屏播放器打开时这是主线程上最大的一笔持续开销。
 * 拆成 memo 组件后，一次推进只有「原当前行」和「新当前行」两行真正更新。
 */
const LyricRow = memo(function LyricRow({
  text,
  fontSize,
  stage,
  isActive,
  isPast,
  isClickable,
  activeRef,
  onSelect,
  line,
}: {
  text: string
  /** null：跟随容器的字号（全屏按设置放大 1.4 倍） */
  fontSize: number | null
  stage: boolean
  isActive: boolean
  isPast: boolean
  isClickable: boolean
  activeRef?: React.RefObject<HTMLParagraphElement>
  onSelect: (line: LyricLine) => void
  line: LyricLine
}) {
  return (
    <p
      ref={activeRef}
      onClick={() => onSelect(line)}
      className={cn(
        'lyric-line text-left font-display text-ink',
        stage
          ? 'origin-left font-bold leading-[1.28] tracking-[-0.02em] transition-[opacity,transform] duration-5 ease-smooth'
          : 'font-semibold leading-[1.4] transition-opacity duration-300 ease-out',
        // 字重恒定、只换透明度与一点点缩放：换行时不重排。唱过的最淡，当前行全亮，未唱的在中间
        isActive
          ? 'is-active scale-100 opacity-100'
          : isPast
            ? cn(stage && 'scale-[0.97]', 'opacity-[0.36]')
            : cn(stage && 'scale-[0.97]', 'opacity-[0.52]'),
        isClickable ? 'cursor-pointer select-none' : 'select-none',
        isClickable && !isActive && 'hover:opacity-70',
      )}
      style={fontSize ? { fontSize: `${fontSize}px` } : undefined}
    >
      {/* 歌词是全站最大的一块中文文字面，CJK 与拉丁混排（歌名、Cover、feat.、
          英文副歌）在这里最显眼。设计契约要求两种文字之间加细空格，
          此前唯独这里漏了。 */}
      {spaceCJK(text)}
    </p>
  )
})
