/**
 * 歌词同步显示组件（v6.1）
 * - 全屏（舞台）：大字；当前行全亮，其余行离它越远越淡；换行时当前行从 97% 轻轻放大到 100%
 *   （只动 transform / opacity，字重不变，不重排）
 * - 全屏的换行滚动：滚动位置一步到位，再让每一行从原来的位置带着弹性滑过来、
 *   当前行以下的依次慢半拍跟上（只动 transform；上一次没落定就来了下一次，两段位移相加，不会跳）
 * - 逐字填色：这一行带逐字时间（LyricLine.words）时，唱到哪儿亮到哪儿；没有就整行高亮
 * - 间奏：两句之间空了 5 秒以上（要有逐字时间才知道上一句唱到哪儿）、或前奏 8 秒以上，放三个呼吸的点
 * - 面板：外壳里的小字版本，墨色分层，浏览器自带的平滑滚动
 * - 自动滚动、高亮当前行；手动滚动后暂停自动滚动，停手满 8 秒自己滚回当前行
 *   （回到第一句之前——重播、拖回 0:00——则滚回顶部）
 * - 高亮色统一跟随 accent（DESIGN §1.3 单一强调色）：
 *   settingsStore 的 lyricsHighlightColor 自定义字段按重构约定忽略
 * - 点击歌词行跳转到对应时间
 *
 * 性能优化：
 * - 自行订阅 playerStore.currentTime（不再由父组件 prop 传递，
 *   避免父组件因 currentTime 高频更新而重渲染）
 * - 只在 currentIndex 变化时更新 DOM：当前行前后各三行换一档透明度，其余不动
 * - 逐字填色不走 React、也不逐帧跑脚本：每个字两个 WAAPI 动画（遮罩往右、里面的字往左抵回去），
 *   都只动 transform，交给合成器；只有当前行挂着
 */

import { useRef, useEffect, useCallback, useMemo, memo, Fragment } from 'react'
import { cn } from '@/lib/utils'
import { spaceCJK } from '@/utils/cjkTypography'
import { useLyrics } from '@/hooks/useLyrics'
import { getAudioCurrentTime, seekHowl } from '@/hooks/useAudioEngine'
import { useSettingsStore } from '@/store/settingsStore'
import { usePlayerStore } from '@/store/playerStore'
import { SPRING_LYRIC, prefersReducedMotion, springEasing } from '@/lib/motion'
import type { LyricLine, LyricWord } from '@/api/types'
import { useT } from '@/i18n'

/**
 * 手动滚开后多久恢复自动跟随。
 *
 * 3 秒太短：想往回看几句歌词，还没读完就被拽回当前行，只能一遍遍地滚。
 * 8 秒够读完一小段，又不至于让人以为自动跟随坏了。
 */
const AUTO_SCROLL_RESUME_DELAY = 8000

/** 两句之间空出这么久算间奏（毫秒）；前奏要更长才提示，短前奏一晃就过 */
const GAP_MIN_MS = 5000
const INTRO_MIN_MS = 8000

/** 换行时当前行以下每一行比上一行晚多少动（毫秒），最多错开 8 行 */
const STAGGER_MS = 40
const STAGGER_MAX = 8

/**
 * 全屏：离当前行 1、2、3 行的透明度（下标 = 距离）；更远的用最后一档。
 * 唱过的比没唱的淡一档。没有时间戳的歌词（不知道唱到哪）整篇用 UNSYNCED。
 */
const NEXT_OPACITY = [1, 0.48, 0.36, 0.28, 0.2]
const PAST_OPACITY = [1, 0.36, 0.28, 0.22, 0.16]
const UNSYNCED_OPACITY = 0.72
const FAR = NEXT_OPACITY.length - 1

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

/** 屏幕上的一行：一句歌词，或者一段间奏 */
interface Row {
  /** 开始时间（毫秒）：间奏从上一句唱完算起 */
  time: number
  /** 歌词行；间奏没有 */
  line?: LyricLine
}

const lineEnd = (line: LyricLine): number | undefined => {
  const last = line.words?.[line.words.length - 1]
  return last ? last.time + last.duration : undefined
}

/** 歌词行之间插上间奏：只有全屏、有时间戳时才插 */
function buildRows(lines: LyricLine[], withGaps: boolean): Row[] {
  const rows: Row[] = []
  if (withGaps && lines.length && lines[0].time >= INTRO_MIN_MS) rows.push({ time: 0 })
  lines.forEach((line, i) => {
    rows.push({ time: line.time, line })
    const next = lines[i + 1]
    const end = lineEnd(line)
    if (withGaps && next && end !== undefined && next.time - end >= GAP_MIN_MS) rows.push({ time: end })
  })
  return rows
}

/** 一行里的一个字 / 词，连同它前后要补的空白 */
interface WordToken {
  text: string
  lead: string
  tail: string
  /** 和前一个词之间不许折行（一个西文词被拆成几个音节） */
  glued: boolean
}

const CJK_CHAR = /[⺀-⻿぀-ヿ㄀-ㄯ㐀-䶿一-鿿豈-﫿]/

/**
 * 逐字时间 → 可以排版的词：空格拿到词外面（行尾的空格才能照常被吃掉，折行位置和纯文本一致），
 * 中西文相接处补细空格（与 spaceCJK 同一个规矩）。
 */
function wordTokens(words: LyricWord[]): WordToken[] {
  const tokens: WordToken[] = []
  let prevCore = ''
  let prevSpaced = true
  for (const w of words) {
    const core = w.text.trim()
    if (!core) {
      if (tokens.length) tokens[tokens.length - 1].tail = ' '
      prevSpaced = true
      continue
    }
    const leadSpace = /^\s/.test(w.text)
    const spaced = prevSpaced || leadSpace
    let lead = !prevSpaced && leadSpace ? ' ' : ''
    let glued = false
    if (!spaced && prevCore) {
      const a = prevCore[prevCore.length - 1]
      const b = core[0]
      const joined = spaceCJK(a + b)
      if (joined.length > 2) lead = joined[1]
      else glued = !CJK_CHAR.test(a) && !CJK_CHAR.test(b)
    }
    const tailSpace = /\s$/.test(w.text)
    tokens.push({ text: core, lead, tail: tailSpace ? ' ' : '', glued })
    prevCore = core
    prevSpaced = tailSpace
  }
  return tokens
}

/** 元素当前被动画推开了多少（translateY，像素）：量位置时要减掉，不然量到的是半路上的位置 */
function translateYOf(el: Element): number {
  const t = getComputedStyle(el).transform
  if (!t || t === 'none') return 0
  const m = /^matrix(3d)?\(([^)]+)\)$/.exec(t)
  if (!m) return 0
  const v = m[2].split(',').map(Number)
  return (m[1] ? v[13] : v[5]) || 0
}

let lyricSpring: { easing: string; duration: number } | null = null

interface LyricDisplayProps {
  lines: LyricLine[]
  /** 外部传入的播放时间（秒）。省略则自行从 store 订阅 */
  currentTimeSec?: number
  /** 是否紧凑模式（全屏播放器用大字，侧边栏用小字）*/
  variant?: 'fullscreen' | 'panel'
  /** 全屏时字号是设置值的几倍（默认 1.4）。电视的歌词栏窄，用 1 倍左右 */
  fontScale?: number
  className?: string
}

export const LyricDisplay = memo(function LyricDisplay({
  lines,
  currentTimeSec: externalTime,
  variant = 'fullscreen',
  fontScale = 1.4,
  className,
}: LyricDisplayProps) {
  const { t } = useT()
  const stage = variant === 'fullscreen'
  // 自行从 store 订阅 currentTime（如果外部没传）
  const storeTime = usePlayerStore(s => s.currentTime)
  const currentTimeSec = externalTime ?? storeTime

  const synced = useMemo(() => lines.some(l => l.time > 0), [lines])
  const hasWords = useMemo(() => lines.some(l => l.words?.length), [lines])
  const rows = useMemo(() => buildRows(lines, stage && synced), [lines, stage, synced])
  // useLyrics 只看 time：间奏也是一行，轮到它时上一句退成「唱过的」
  const rowTimes = useMemo<LyricLine[]>(() => rows.map(r => r.line ?? { time: r.time, text: '' }), [rows])

  const { currentIndex, hasLyrics } = useLyrics({
    currentTimeSec,
    lines: rowTimes,
    // 播放时间每 200ms 才更新一次，提前一点高亮：行级时间戳提前半秒；
    // 有逐字时间的少提前一些——每个字什么时候亮由逐字动画自己按真实时间算，行只要赶在第一个字之前换过去
    offset: hasWords ? 300 : 500,
  })
  const isSynced = synced

  // 歌词字号设置（14–36px）仍然生效，基准改为衬线
  const lyricsFontSize = useSettingsStore(s => s.lyricsFontSize)

  // 展示用文本：剥离逐字时间戳残留；纯时间行（清洗后为空）显示 ♪ 占位
  const displayTexts = useMemo(
    () => rows.map(r => (r.line ? cleanLyricText(r.line.text) || '♪' : '')),
    [rows]
  )

  const containerRef = useRef<HTMLDivElement>(null)
  const activeLineRef = useRef<HTMLParagraphElement>(null)
  // 手动滚动锁定：记录最后一次手动滚动时间
  const lastManualScrollRef = useRef<number>(0)
  /**
   * 锁定到期的恢复计时器。scrollToActive 只在换行时跑，光靠「锁过期了」
   * 不会有人再叫它——慢歌里一句能唱十几秒，用户滚开后要干等到下一句才被拽回来，
   * 而且看不出怎么回去。所以最后一次手动滚动后起一个计时器，到点主动滚回当前行。
   */
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrollToActiveRef = useRef<() => void>(() => {})
  // 程序化滚动标志：scrollToActive 的滚动同样会触发 scroll 事件，
  // 必须与用户手动滚动区分，否则每次自动滚动都会把自己锁定 8 秒
  const isProgrammaticScrollRef = useRef(false)
  const programmaticSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 上一次自动滚动时的歌词：刚挂上、或换了一首歌时直接到位，不让整篇歌词从别处飞过来 */
  const scrolledLinesRef = useRef<LyricLine[] | null>(null)

  /** 刷新程序化滚动的"结束"计时：滚动停止约 150ms 后清除标志 */
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
      // 每次滚动都重新计时：从「最后一次」手动滚动起算满 8 秒才回去
      if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current)
      resumeTimerRef.current = setTimeout(() => {
        resumeTimerRef.current = null
        // 先解锁：计时器可能比 Date.now() 的差值早到 1ms，scrollToActive 里的锁判断会把自己挡掉
        lastManualScrollRef.current = 0
        scrollToActiveRef.current()
      }, AUTO_SCROLL_RESUME_DELAY)
    }
    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      container.removeEventListener('scroll', handleScroll)
      if (programmaticSettleTimerRef.current) clearTimeout(programmaticSettleTimerRef.current)
      if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current)
      resumeTimerRef.current = null
    }
    // hasLyrics：没歌词时容器不渲染，歌词后到时要重新挂上监听，否则手动滚动永远检测不到
  }, [armProgrammaticSettle, hasLyrics])

  /**
   * 全屏的换行滚动：位置已经一步到位（delta 是刚才滚了多少），每一行从原来的位置滑过来。
   * 叠加式动画（composite: add）：上一次的还没走完，新的直接叠上去，位移相加。
   */
  const glide = useCallback((container: HTMLElement, delta: number, activeIndex: number) => {
    const list = container.firstElementChild
    if (!list) return
    lyricSpring ??= springEasing(SPRING_LYRIC)
    const height = container.clientHeight
    // 隔得太远（拖进度、点很远的一行）就不错峰了，一起到位
    const far = Math.abs(delta) > height * 1.2
    const top = container.scrollTop - Math.abs(delta) - 80
    const bottom = container.scrollTop + height + Math.abs(delta) + 80
    Array.from(list.children).forEach((el, i) => {
      const row = el as HTMLElement
      if (typeof row.animate !== 'function') return
      if (row.offsetTop + row.offsetHeight < top || row.offsetTop > bottom) return
      row.animate(
        [{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }],
        {
          duration: lyricSpring!.duration,
          easing: lyricSpring!.easing,
          delay: far ? 0 : Math.min(STAGGER_MAX, Math.max(0, i - activeIndex)) * STAGGER_MS,
          fill: 'backwards',
          composite: 'add',
        },
      )
    })
  }, [])

  // 自动滚动到当前歌词行（高亮行始终居中于容器可视区域）
  const scrollToActive = useCallback(() => {
    if (!isSynced) return
    // 如果最近 8 秒内有手动滚动，跳过自动滚动
    if (Date.now() - lastManualScrollRef.current < AUTO_SCROLL_RESUME_DELAY) return

    const container = containerRef.current
    if (!container) return
    const reduce = prefersReducedMotion()
    const fresh = scrolledLinesRef.current !== lines
    scrolledLinesRef.current = lines

    /** 滚过去。全屏：瞬间到位再让各行滑过来；面板：浏览器的平滑滚动（开了「减少动态」就直跳） */
    const go = (top: number) => {
      // 标记程序化滚动；即使滚动距离为 0 不触发 scroll 事件，计时器也会兜底清除标志
      isProgrammaticScrollRef.current = true
      armProgrammaticSettle()
      if (!stage) {
        /* 前庭安全（阶段 7.6）：系统开了「减少动态」就直跳，不做平滑滚动 */
        container.scrollTo({ top, behavior: reduce ? 'auto' : 'smooth' })
        return
      }
      const before = container.scrollTop
      container.scrollTo({ top, behavior: 'auto' })
      const delta = container.scrollTop - before
      if (!reduce && !fresh && Math.abs(delta) >= 1) glide(container, delta, currentIndex)
    }

    // 第一句之前（单曲循环重新开始、拖回 0:00）：没有当前行，滚回顶部。
    // 此前直接 return，视图就停在上一遍的末尾
    if (currentIndex < 0) {
      go(0)
      return
    }

    const activeLine = activeLineRef.current
    if (!activeLine) return

    // 使用 getBoundingClientRect 而非 offsetTop，避免 offsetParent 差异导致计算不准；
    // 全屏的行可能正滑到半路，减掉它此刻被推开的位移，量的才是它落定后的位置
    const containerRect = container.getBoundingClientRect()
    const lineRect = activeLine.getBoundingClientRect()
    const shift = stage ? translateYOf(activeLine) : 0
    const lineCenter = (lineRect.top - shift - containerRect.top) + lineRect.height / 2
    // 全屏：当前行停在三分之一处（上面留两三行刚唱过的），面板里居中
    const desiredCenter = containerRect.height * (stage ? 0.32 : 0.5)
    go(Math.max(0, container.scrollTop + (lineCenter - desiredCenter)))
  }, [currentIndex, isSynced, armProgrammaticSettle, stage, lines, glide])
  // 恢复计时器到点时要调的是「最新」的 scrollToActive（拿的是当时的 currentIndex）
  scrollToActiveRef.current = scrollToActive

  useEffect(() => {
    scrollToActive()
  }, [scrollToActive])

  /**
   * 点击歌词行跳转到对应时间（毫秒 → 秒）。
   *
   * 必须是稳定引用：LyricRow 是 memo 的，onSelect 每次渲染都换新函数的话
   * memo 永远不会 bail out，「只重渲染几行」的优化等于没做。
   * isSynced 通过 ref 读取，保持依赖为空。
   */
  const isSyncedRef = useRef(isSynced)
  isSyncedRef.current = isSynced
  const handleLineClick = useCallback((line: LyricLine) => {
    if (!isSyncedRef.current || line.time < 0) return
    seekHowl(line.time / 1000)
    // 点击跳转后立刻取消手动滚动锁，允许自动滚动跟随（等着恢复的计时器也不用留了）
    lastManualScrollRef.current = 0
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current)
    resumeTimerRef.current = null
  }, [])

  if (!hasLyrics) {
    return (
      <div className={cn('flex items-center justify-center h-full', className)}>
        <p className="text-[15px] text-ink-3">{t('lyrics.none')}</p>
      </div>
    )
  }

  // 全屏的逐字填色要 WAAPI；开了「减少动态」就整行高亮
  const canWipe = stage && hasWords && !prefersReducedMotion()
    && typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function'

  return (
    <div
      ref={containerRef}
      className={cn(
        'overflow-y-auto scrollbar-hide',
        // 上下渐隐（lyric-fade，见 index.css）：全屏与面板都用，面板里那几行也不该被生硬切断
        // 全屏：第一句从顶上开始（不在三分之一处悬着一大片空），底下留够当前行滚到锚点的余量
        stage ? 'relative h-full pb-[48vh] pt-[7vh] lyric-fade-top' : 'h-64 py-12 lyric-fade',
        className
      )}
      /* 面板用浏览器的平滑滚动。开了「减少动态」不能再设 smooth：CSS 的 scroll-behavior 会盖过
         scrollTo 的 behavior: 'auto'，歌词照样平滑地滚。全屏的滚动是瞬间到位、各行自己滑，同样不能设 */
      style={stage || prefersReducedMotion() ? undefined : { scrollBehavior: 'smooth' }}
    >
      <div className={cn(
        stage ? 'flex flex-col gap-[0.62em] px-2' : 'space-y-3 px-4'
      )}
        style={stage ? { fontSize: `${Math.min(52, Math.round(lyricsFontSize * fontScale))}px` } : undefined}
      >
        {rows.map((row, index) => {
          const isActive = isSynced && index === currentIndex
          // 离当前行几行（带正负，封顶）：只有这个数变了的行才重渲染
          const near = !isSynced ? null : Math.max(-FAR, Math.min(FAR, index - currentIndex))
          if (!row.line) {
            return <GapRow key={index} isActive={isActive} near={near} activeRef={isActive ? activeLineRef : undefined} />
          }
          return (
            <LyricRow
              key={index}
              text={displayTexts[index]}
              fontSize={stage ? null : 14}
              stage={stage}
              isActive={isActive}
              isPast={isSynced && index < currentIndex}
              near={stage ? near : 0}
              wipe={canWipe}
              isClickable={isSynced && row.line.time >= 0}
              activeRef={isActive ? activeLineRef : undefined}
              onSelect={handleLineClick}
              line={row.line}
            />
          )
        })}
      </div>
    </div>
  )
})

/** 全屏那一行的透明度：当前行不设（交给 is-active），其余按离当前行的远近 */
function rowOpacity(near: number | null, isActive: boolean): number | undefined {
  if (isActive) return undefined
  if (near === null) return UNSYNCED_OPACITY
  return near < 0 ? PAST_OPACITY[Math.min(FAR, -near)] : NEXT_OPACITY[Math.min(FAR, near)]
}

/**
 * 单行歌词。
 *
 * 播放中 currentTime 每秒变化数次，整份歌词此前会跟着整体重渲染——
 * 全屏播放器打开时这是主线程上最大的一笔持续开销。
 * 拆成 memo 组件后，一次推进只有当前行前后几行（透明度换档的那几行）真正更新。
 */
const LyricRow = memo(function LyricRow({
  text,
  fontSize,
  stage,
  isActive,
  isPast,
  near,
  wipe,
  isClickable,
  activeRef,
  onSelect,
  line,
}: {
  text: string
  /** null：跟随容器的字号（全屏按设置放大） */
  fontSize: number | null
  stage: boolean
  isActive: boolean
  isPast: boolean
  /** 全屏：离当前行几行（带正负）；没有时间戳是 null。面板不用，恒为 0 */
  near: number | null
  /** 这份歌词做不做逐字填色（全屏、有逐字时间、没开「减少动态」） */
  wipe: boolean
  isClickable: boolean
  activeRef?: React.RefObject<HTMLParagraphElement>
  onSelect: (line: LyricLine) => void
  line: LyricLine
}) {
  // 全屏、有逐字时间的行一直按词排（不只是唱到的时候）：不然换成当前行那一下折行位置会变，整列跟着跳
  const tokens = useMemo(
    () => (stage && wipe && line.words?.length ? wordTokens(line.words) : null),
    [stage, wipe, line.words]
  )
  const wiping = isActive && !!tokens
  const opacity = stage ? rowOpacity(near, isActive) : undefined

  let body: React.ReactNode
  if (!tokens) {
    /* 歌词是全站最大的一块中文文字面，CJK 与拉丁混排（歌名、Cover、feat.、
       英文副歌）在这里最显眼。设计契约要求两种文字之间加细空格，
       此前唯独这里漏了。 */
    body = spaceCJK(text)
  } else {
    // 被拆成音节的西文词包进一个不折行的组里
    const groups: WordToken[][] = []
    for (const tk of tokens) {
      if (tk.glued && groups.length) groups[groups.length - 1].push(tk)
      else groups.push([tk])
    }
    const word = (tk: WordToken, key: number) => (
      <Fragment key={key}>
        {tk.lead}
        <span className="lyric-w">
          {tk.text}
          {/* 亮的那一层只在唱到这一行时挂上：绝对定位，不占位置，挂上摘下都不重排 */}
          {wiping && (
            <span className="lyric-w-clip" aria-hidden="true">
              <span className="lyric-w-lit">{tk.text}</span>
            </span>
          )}
        </span>
        {tk.tail}
      </Fragment>
    )
    let n = 0
    body = groups.map((group, gi) => (
      group.length === 1
        ? word(group[0], n++)
        : <span key={`g${gi}`} className="whitespace-nowrap">{group.map(tk => word(tk, n++))}</span>
    ))
  }

  return (
    <p
      ref={activeRef}
      onClick={() => onSelect(line)}
      className={cn(
        'lyric-line text-left font-display text-ink',
        stage
          ? 'origin-left font-bold leading-[1.3] tracking-[-0.02em] transition-[opacity,transform] duration-5 ease-smooth'
          : 'font-semibold leading-[1.4] transition-opacity duration-300 ease-out',
        // 字重恒定、只换透明度与一点点缩放：换行时不重排。
        // 全屏的透明度写在 style 里（按离当前行的远近分档）；面板两档：唱过的最淡，未唱的在中间
        isActive
          ? 'is-active scale-100 opacity-100'
          : stage
            ? 'scale-[0.97]'
            : isPast ? 'opacity-[var(--lyric-past,0.36)]' : 'opacity-[var(--lyric-next,0.52)]',
        wiping && 'is-wiping',
        isClickable ? 'cursor-pointer select-none' : 'select-none',
        isClickable && !isActive && !stage && 'hover:opacity-70',
      )}
      style={fontSize ? { fontSize: `${fontSize}px` } : opacity !== undefined ? { opacity } : undefined}
    >
      {body}
      {wiping && line.words && <WordWipe words={line.words} />}
    </p>
  )
})

/** 间奏：三个呼吸的点。轮到它时才动；点不了 */
const GapRow = memo(function GapRow({
  isActive,
  near,
  activeRef,
}: {
  isActive: boolean
  near: number | null
  activeRef?: React.RefObject<HTMLParagraphElement>
}) {
  return (
    <p
      ref={activeRef}
      aria-hidden="true"
      className={cn(
        'lyric-line lyric-gap origin-left text-ink transition-[opacity,transform] duration-5 ease-smooth',
        isActive ? 'is-active scale-100 opacity-100' : 'scale-[0.97]',
      )}
      style={isActive ? undefined : { opacity: rowOpacity(near, false) }}
    >
      <i /><i /><i />
    </p>
  )
})

const CLIP_FRAMES = [{ transform: 'translateX(-101%)' }, { transform: 'translateX(0)' }]
const LIT_FRAMES = [{ transform: 'translateX(101%)' }, { transform: 'translateX(0)' }]

/**
 * 逐字填色的驱动：只挂在当前行里，自己不画东西。
 *
 * 每个字两个动画：遮罩（lyric-w-clip）从左往右移进来，里面亮的字（lyric-w-lit）反方向抵回去——
 * 字看起来不动，只是被从左到右揭开。开始时间按音频的真实位置算（delay = 这个字的开始 − 现在，
 * 已经唱过的是负数，动画直接从半路或终点开始）。
 *
 * 每 250ms 对一次表：暂停 / 继续、拖了进度、缓冲卡住（音频位置不走了）都重排一遍。
 * 动画跑在合成器上，对表只是偶尔重建，不是逐帧驱动。
 */
function WordWipe({ words }: { words: LyricWord[] }) {
  const markerRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const host = markerRef.current?.parentElement
    if (!host) return
    const clips = Array.from(host.querySelectorAll<HTMLElement>('.lyric-w-clip'))
    // 排版时丢掉了纯空白的词：按「有字」的词对回去
    const voiced = words.filter(w => w.text.trim())
    if (!clips.length || clips.length !== voiced.length) return

    let anims: Animation[] = []
    let running = false
    let baseAudio = 0
    let basePerf = 0
    let lastAudio = -1

    const build = (run: boolean) => {
      for (const a of anims) a.cancel()
      anims = []
      const now = getAudioCurrentTime() * 1000
      baseAudio = now
      basePerf = performance.now()
      running = run
      voiced.forEach((w, i) => {
        const clip = clips[i]
        const lit = clip.firstElementChild
        if (!lit) return
        const timing: KeyframeAnimationOptions = {
          duration: Math.max(40, w.duration),
          delay: w.time - now,
          easing: 'linear',
          fill: 'both',
        }
        const pair = [clip.animate(CLIP_FRAMES, timing), lit.animate(LIT_FRAMES, timing)]
        if (!run) pair.forEach(a => a.pause())
        anims.push(...pair)
      })
    }

    /** stallCheck：只在定时对表时判断「音频位置没走」——两次读数隔得够远，相等才说明真卡住了 */
    const sync = (stallCheck: boolean) => {
      const now = getAudioCurrentTime() * 1000
      const stalled = stallCheck && now === lastAudio
      if (stallCheck) lastAudio = now
      const playing = usePlayerStore.getState().isPlaying && !stalled
      if (playing !== running) {
        build(playing)
        return
      }
      // 拖了进度、或者时钟漂了：音频的位置和动画以为的位置差出一截，重排
      if (running && Math.abs(now - (baseAudio + performance.now() - basePerf)) > 120) build(true)
    }

    build(usePlayerStore.getState().isPlaying)
    const timer = setInterval(() => sync(true), 250)
    const unsubscribe = usePlayerStore.subscribe((s, prev) => {
      if (s.isPlaying !== prev.isPlaying) sync(false)
    })
    return () => {
      clearInterval(timer)
      unsubscribe()
      for (const a of anims) a.cancel()
    }
  }, [words])

  return <span ref={markerRef} hidden />
}
