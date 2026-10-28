/**
 * 底部播放条（v6）：浮在内容上方的一枚玻璃胶囊，按窗口档位换形态。
 *
 *   compact  胶囊：封面 + 曲名 + 播放键 + 下一首；左右滑切歌（曲名跟着手指走，松手按方向翻过去），
 *            上滑打开正在播放
 *   regular  一条：封面 / 上一首 播放 下一首 / 收藏 歌词 队列
 *   wide     完整：封面曲名收藏 / 随机 上一首 播放 下一首 循环 + 进度行 / 歌词 定时 队列 音量 全屏
 *
 * 封面带 data-np-anchor：全屏播放器打开时从它的位置飞出来、收起时飞回它这里（共享元素）。
 * 性能：细粒度 selector 订阅 store；进度行与进度线拆成独立 memo 子组件，
 * 播放中每秒四次的 currentTime 更新只重渲染它们。
 */

import { useCallback, useEffect, useMemo, memo, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent, PointerEvent } from 'react'
import {
  SkipBack, SkipForward, SpeakerHigh, SpeakerX,
  SpeakerLow, Queue, Repeat, RepeatOnce,
  Shuffle, MicrophoneStage, ArrowsOutSimple,
} from '@phosphor-icons/react'
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react'
import { cn } from '@/lib/utils'
import { type WindowClass } from '@/lib/platform'
import { haptic } from '@/lib/haptics'
import { SPRING_PRESS, SPRING_SNAPPY } from '@/lib/motion'
import { markSkip, skipDirection } from '@/lib/skipDirection'
import { usePlayerStore, type RepeatMode } from '@/store/playerStore'
import { useServerStore } from '@/store/serverStore'
import { SleepTimerMenu } from '@/components/player/SleepTimerMenu'
import { HeartGlyph, PlayPauseGlyph } from '@/components/player/glyphs'
import { SourceBadge } from '@/components/sources/SourceBadge'
import { VipTag } from '@/components/sources/VipTag'
import { seekHowl } from '@/hooks/useAudioEngine'
import { useToggleStar } from '@/hooks/useServerQueries'
import { useSourceCapabilities } from '@/hooks/useSourceQueries'
import { sourceSupportsFavorites } from '@/services/heartCapability'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'
import { Slider } from '@/components/ui/slider'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { findAdapterFor } from '@/api'
import { formatDuration } from '@/utils/formatters'
import { spaceCJK } from '@/utils/cjkTypography'
import { useT } from '@/i18n'
import { notePauseReason } from '@/lib/playbackTrail'

/** 次要键：40px 圆，44px 命中区由胶囊的内边距补足；hover 铺一层墨色的底 */
const iconBtnBase =
  'press-pop grid h-10 w-10 flex-none place-items-center rounded-pill text-ink-2 ' +
  'hover:bg-ink/[0.06] hover:text-ink disabled:cursor-not-allowed disabled:opacity-40'
/** 开关类（随机、循环、队列）按下时是叶绿；收藏不算「当前」，按下只是墨色 */
const iconBtn = `${iconBtnBase} aria-pressed:text-leaf`

/**
 * 进度行（宽窗口）：时间码 + 可拖动的进度轨。
 * 拖动期间只更新本地值，松手才 seek；松手后 500ms 内忽略回传的旧位置，避免进度条回跳。
 */
const ProgressRow = memo(function ProgressRow() {
  const { t } = useT()
  const currentTime = usePlayerStore(s => s.currentTime)
  const duration = usePlayerStore(s => s.duration)
  const buffered = usePlayerStore(s => s.buffered)

  const [dragValue, setDragValue] = useState<number | null>(null)
  const releaseGuardRef = useRef<{ target: number; until: number } | null>(null)

  const safeDuration = isFinite(duration) && duration > 0 ? duration : 1
  const guard = releaseGuardRef.current
  const displayTime = dragValue !== null
    ? dragValue
    : guard && performance.now() < guard.until && Math.abs(currentTime - guard.target) > 1
      ? guard.target
      : currentTime
  const playRatio = Math.min(1, displayTime / safeDuration)
  const bufferRatio = Math.min(1, buffered)

  const progressRef = useRef<HTMLDivElement>(null)
  const safeDurationRef = useRef(safeDuration)
  const dragMoveRef = useRef<((e: globalThis.PointerEvent) => void) | null>(null)
  const dragUpRef = useRef<((e: globalThis.PointerEvent) => void) | null>(null)
  safeDurationRef.current = safeDuration

  const clearDragListeners = useCallback(() => {
    if (dragMoveRef.current) {
      document.removeEventListener('pointermove', dragMoveRef.current)
      dragMoveRef.current = null
    }
    if (dragUpRef.current) {
      document.removeEventListener('pointerup', dragUpRef.current)
      document.removeEventListener('pointercancel', dragUpRef.current)
      dragUpRef.current = null
    }
  }, [])

  useEffect(() => {
    const onBlur = () => {
      clearDragListeners()
      setDragValue(null)
    }
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('blur', onBlur)
      clearDragListeners()
    }
  }, [clearDragListeners])

  /** Pointer Events：触屏与触控板、鼠标同一套；捕获指针，滑出轨道也不断 */
  const handlePointerDown = useCallback((e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const rect = progressRef.current?.getBoundingClientRect()
    if (!rect) return
    const getR = (cx: number) => Math.max(0, Math.min(1, (cx - rect.left) / rect.width))
    setDragValue(getR(e.clientX) * safeDurationRef.current)
    e.currentTarget.setPointerCapture?.(e.pointerId)

    const onMove = (me: globalThis.PointerEvent) => {
      setDragValue(getR(me.clientX) * safeDurationRef.current)
    }
    const onUp = (me: globalThis.PointerEvent) => {
      const target = getR(me.clientX) * safeDurationRef.current
      releaseGuardRef.current = { target, until: performance.now() + 500 }
      seekHowl(target)
      setDragValue(null)
      clearDragListeners()
    }
    clearDragListeners()
    dragMoveRef.current = onMove
    dragUpRef.current = onUp
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    document.addEventListener('pointercancel', onUp)
  }, [clearDragListeners])

  // 键盘 seek：←/→ ±5s（全局快捷键的方向键在焦点落在滑轨上时会让位）
  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const target = Math.max(
      0,
      Math.min(
        safeDurationRef.current,
        usePlayerStore.getState().currentTime + (e.key === 'ArrowRight' ? 5 : -5)
      )
    )
    releaseGuardRef.current = { target, until: performance.now() + 500 }
    seekHowl(target)
  }, [])

  return (
    <div className="flex w-full items-center gap-2.5">
      <span className="num w-10 flex-none text-right text-[11.5px] font-medium text-ink-3">
        {formatDuration(displayTime)}
      </span>
      <div
        ref={progressRef}
        onPointerDown={handlePointerDown}
        style={{ touchAction: 'none' }}
        onKeyDown={handleKeyDown}
        role="slider"
        tabIndex={0}
        aria-label={t('player.progress')}
        aria-valuemin={0}
        aria-valuemax={Math.round(safeDuration)}
        aria-valuenow={Math.round(displayTime)}
        aria-valuetext={t('player.progressAt', {
          current: formatDuration(Math.round(displayTime)),
          total: formatDuration(Math.round(safeDuration)),
        })}
        className="group/track relative flex h-5 flex-1 cursor-pointer select-none items-center"
      >
        {/* 拖动或悬停时轨道加粗一档：按住的东西要看得见 */}
        <div
          className={cn(
            'relative h-[4px] w-full overflow-hidden rounded-pill bg-ink/[0.1] transition-transform duration-3 ease-out group-hover/track:scale-y-150',
            dragValue !== null && 'scale-y-150'
          )}
        >
          <div
            className="absolute inset-0 origin-left bg-ink/[0.1] transition-transform duration-500"
            style={{ transform: `scaleX(${bufferRatio})` }}
          />
          <div className="absolute inset-0 origin-left rounded-pill bg-leaf" style={{ transform: `scaleX(${playRatio})` }} />
        </div>
        <div
          className={cn(
            'pointer-events-none absolute left-0 top-1/2 h-3.5 w-3.5 rounded-pill bg-surface shadow-md ring-[0.5px] ring-ink/10',
            'transition-[scale] duration-3 ease-press [@media(hover:hover)]:scale-0 group-hover/track:scale-100',
            dragValue !== null && '[@media(hover:hover)]:scale-110'
          )}
          style={{ transform: `translate(calc(${playRatio} * var(--track-w, 0px) - 50%), -50%)` }}
        />
      </div>
      <span className="num w-10 flex-none text-[11.5px] font-medium text-ink-3">
        {formatDuration(duration)}
      </span>
    </div>
  )
})

/** 进度线（窄、中两档）：贴在胶囊下缘内侧的一条细线，只读。细线用叶绿（文字的分量），青柠在亮底上细到看不见 */
const ProgressLine = memo(function ProgressLine({ className }: { className?: string }) {
  const currentTime = usePlayerStore(s => s.currentTime)
  const duration = usePlayerStore(s => s.duration)
  const safeDuration = isFinite(duration) && duration > 0 ? duration : 1
  const ratio = Math.min(1, currentTime / safeDuration)
  return (
    <div className={cn('pointer-events-none absolute h-[2px] overflow-hidden rounded-pill bg-ink/[0.08]', className)} aria-hidden>
      <div className="h-full origin-left rounded-pill bg-leaf transition-transform duration-300 ease-linear" style={{ transform: `scaleX(${ratio})` }} />
    </div>
  )
})

/**
 * 迷你播放条的横滑切歌：曲名和封面跟着手指走（越过阈值后阻尼变大），
 * 松手时按位移或速度判定：左滑下一首、右滑上一首；上滑打开正在播放；都不够就弹回原位。
 * 只接触屏与触控笔；鼠标在这里只点不拖。
 */
function useMiniSwipe(onNext: () => void, onPrev: () => void, onOpen: () => void) {
  const x = useMotionValue(0)
  const start = useRef<{ x: number; y: number; t: number; id: number; axis: 'x' | 'y' | null } | null>(null)
  const swiped = useRef(false)
  const crossed = useRef(false)
  const THRESHOLD = 64

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse') return
    start.current = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, axis: null }
    swiped.current = false
    crossed.current = false
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const s = start.current
    if (!s || s.id !== e.pointerId) return
    const dx = e.clientX - s.x
    const dy = e.clientY - s.y
    if (!s.axis && Math.hypot(dx, dy) > 8) s.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
    if (s.axis !== 'x') return
    // 过了阈值阻尼变大：告诉手指「够了，可以松了」
    const sign = Math.sign(dx)
    const mag = Math.abs(dx)
    x.set(sign * (mag < THRESHOLD ? mag : THRESHOLD + (mag - THRESHOLD) * 0.35))
    const over = mag > THRESHOLD
    if (over !== crossed.current) {
      crossed.current = over
      if (over) haptic('selection')
    }
  }
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const s = start.current
    start.current = null
    if (!s || s.id !== e.pointerId) return
    const dx = e.clientX - s.x
    const dy = e.clientY - s.y
    const dt = Math.max(1, performance.now() - s.t)
    const vx = (dx / dt) * 1000
    if (s.axis === 'x' && (Math.abs(dx) > THRESHOLD || Math.abs(vx) > 650)) {
      swiped.current = true
      haptic('light')
      markSkip(dx < 0 ? 1 : -1)
      if (dx < 0) onNext(); else onPrev()
      x.jump(0)
      return
    }
    if (s.axis === 'y' && dy < -44) {
      swiped.current = true
      onOpen()
    }
    animate(x, 0, SPRING_PRESS)
  }
  const onPointerCancel = () => {
    start.current = null
    animate(x, 0, SPRING_PRESS)
  }
  /** 刚滑过就吞掉随后的 click，免得一滑又点开了全屏 */
  const onClickCapture = (e: MouseEvent) => {
    if (swiped.current) {
      swiped.current = false
      e.preventDefault()
      e.stopPropagation()
    }
  }
  return { x, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onClickCapture }
}

/** 切歌时曲名按方向翻页：下一首从右边进来、旧的往左走；上一首反过来 */
const titleVariants = {
  enter: (d: number) => ({ x: d * 28, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (d: number) => ({ x: d * -28, opacity: 0 }),
}

export function PlayerBar({ wc }: { wc: WindowClass }) {
  const { t } = useT()
  const reduceMotion = useReducedMotion()
  const currentSong = usePlayerStore(s => s.currentSong)
  const isPlaying = usePlayerStore(s => s.isPlaying)
  const streamBuffering = usePlayerStore(s => s.streamBuffering)
  const volume = usePlayerStore(s => s.volume)
  const muted = usePlayerStore(s => s.muted)
  const repeatMode = usePlayerStore(s => s.repeatMode)
  const shuffle = usePlayerStore(s => s.shuffle)
  const isQueueOpen = usePlayerStore(s => s.isQueueOpen)
  const togglePlay = usePlayerStore(s => s.togglePlay)
  const next = usePlayerStore(s => s.next)
  const setVolume = usePlayerStore(s => s.setVolume)
  const toggleMute = usePlayerStore(s => s.toggleMute)
  const setRepeatMode = usePlayerStore(s => s.setRepeatMode)
  const toggleShuffle = usePlayerStore(s => s.toggleShuffle)
  const toggleFullscreen = usePlayerStore(s => s.toggleFullscreen)
  const setFullscreen = usePlayerStore(s => s.setFullscreen)
  const setQueueOpen = usePlayerStore(s => s.setQueueOpen)
  const updateCurrentSong = usePlayerStore(s => s.updateCurrentSong)

  const toggleStar = useToggleStar()
  /* B4：心形按 favorites 能力出现（与 SongList 一致），插件源没声明就不给入口 */
  const caps = useSourceCapabilities()
  const canFavoriteCurrent = sourceSupportsFavorites(caps, currentSong?.serverId)
  // 多源连接时曲目信息带来源徽标（PLAN 2.5）；单源保持原样
  const multiSource = useServerStore(s => s.connectedServerIds.length > 1)

  const coverUrl = currentSong?.coverArt
    ? (findAdapterFor(currentSong.serverId)?.getCoverUrl(currentSong.coverArt, 96) ?? undefined)
    : undefined

  const handleVolumeChange = useCallback((value: number[]) => { setVolume(value[0]) }, [setVolume])

  /** 上一首：播放超过 3 秒重播当前歌曲，否则切到上一首 */
  const handlePrev = useCallback(() => {
    const state = usePlayerStore.getState()
    if (state.currentTime > 3) seekHowl(0)
    else {
      markSkip(-1)
      state.prev()
    }
  }, [])

  const handleNext = useCallback(() => {
    haptic('light')
    markSkip(1)
    next()
  }, [next])

  const handleTogglePlay = useCallback(() => {
    haptic('light')
    notePauseReason('ui', 'player bar')
    togglePlay()
  }, [togglePlay])

  const cycleRepeatMode = useCallback(() => {
    const modes: RepeatMode[] = ['none', 'all', 'one']
    setRepeatMode(modes[(modes.indexOf(repeatMode) + 1) % modes.length])
  }, [repeatMode, setRepeatMode])

  const handleToggleStar = useCallback(() => {
    if (!currentSong) return
    if (!currentSong.starred) haptic('light')
    toggleStar.mutate(
      { id: currentSong.id, type: 'song', isStarred: !!currentSong.starred, song: currentSong },
      { onSuccess: () => updateCurrentSong({ starred: !currentSong.starred }) }
    )
  }, [currentSong, toggleStar, updateCurrentSong])

  const swipe = useMiniSwipe(() => next(), handlePrev, () => setFullscreen(true))
  // 甩的时候封面跟着手指，曲名多走一点，像被带着往前翻
  const coverDrag = useTransform(swipe.x, v => v * 0.55)

  // 宽进度轨的把手要知道轨道宽度才能按比例平移（transform 不接受百分比之外的宽度参照）
  const barRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = barRef.current
    if (!el || wc !== 'wide') return
    const track = el.querySelector<HTMLElement>('[role="slider"]')
    if (!track) return
    const ro = new ResizeObserver(() => el.style.setProperty('--track-w', `${track.clientWidth}px`))
    ro.observe(track)
    return () => ro.disconnect()
  }, [wc, currentSong])

  // 切歌方向在换歌那一刻读一次，曲名的翻页按它走
  const songKey = currentSong ? `${currentSong.serverId}:${currentSong.id}` : ''
  const direction = useMemo(() => (songKey ? skipDirection() : 1), [songKey])

  const VolumeIcon = muted || volume === 0 ? SpeakerX : volume < 0.5 ? SpeakerLow : SpeakerHigh
  const repeatLabel = repeatMode === 'one'
    ? t('player.repeatOne')
    : repeatMode === 'all' ? t('player.repeatAll') : t('player.repeatOff')
  const playLabel = t(isPlaying && streamBuffering ? 'player.buffering' : isPlaying ? 'player.pause' : 'player.play')

  if (!currentSong) {
    // 窄窗口没有歌就不占地方；中、宽两档留一条安静的胶囊，告诉人从哪开始
    if (wc === 'compact') return null
    return (
      <div className="glass pointer-events-auto flex h-[60px] items-center justify-center rounded-[22px] px-6">
        <p className="text-[14px] text-ink-3">{t('player.selectToStart')}</p>
      </div>
    )
  }

  const cover = (size: string, rounded = 'rounded-[10px]') => (
    <span data-np-anchor="" className={cn('cover-frame block flex-none shadow-md', rounded, size)}>
      <ImageWithFallback
        src={coverUrl}
        alt={currentSong.album}
        fallbackType="album"
        className="h-full w-full"
        eager
        songId={currentSong.id}
        customCoverParams={{ type: 'song', title: currentSong.title, artist: currentSong.artist, album: currentSong.album, path: currentSong.path }}
      />
    </span>
  )

  const titles = (withAlbum: boolean) => (
    <span className="relative grid min-w-0 overflow-hidden">
      <AnimatePresence initial={false} custom={direction} mode="popLayout">
        <motion.span
          key={songKey}
          custom={direction}
          variants={titleVariants}
          initial={reduceMotion ? false : 'enter'}
          animate="center"
          exit={reduceMotion ? undefined : 'exit'}
          transition={SPRING_SNAPPY}
          className="col-start-1 row-start-1 flex min-w-0 flex-col text-left leading-tight"
        >
          <span className="flex min-w-0 items-center gap-1.5 text-[14.5px] font-semibold text-ink">
            <span className="truncate">{spaceCJK(currentSong.title)}</span>
            <VipTag song={currentSong} />
            {multiSource && <SourceBadge serverId={currentSong.serverId} />}
          </span>
          <span className="mt-0.5 truncate text-[13px] text-ink-3">
            {spaceCJK(currentSong.artist)}
            {withAlbum && currentSong.album ? <span className="ml-2.5">{spaceCJK(currentSong.album)}</span> : null}
          </span>
        </motion.span>
      </AnimatePresence>
    </span>
  )

  const playKey = (size: 'sm' | 'md') => (
    <button
      onClick={handleTogglePlay}
      className={cn(
        'play-key flex-none',
        size === 'sm' ? 'h-10 w-10' : 'mx-1.5 h-11 w-11',
        isPlaying && streamBuffering && 'animate-buffering'
      )}
      aria-label={playLabel}
      aria-busy={isPlaying && streamBuffering}
    >
      <PlayPauseGlyph playing={isPlaying} size={size === 'sm' ? 17 : 19} />
    </button>
  )

  const favorite = canFavoriteCurrent && (
    <button
      onClick={handleToggleStar}
      disabled={toggleStar.isPending}
      className={cn(iconBtnBase, 'aria-pressed:text-ink')}
      aria-label={t(currentSong.starred ? 'player.unfavorite' : 'player.favorite')}
      aria-pressed={!!currentSong.starred}
    >
      <HeartGlyph on={!!currentSong.starred} size={18} />
    </button>
  )

  /* ===== 窄：胶囊 ===== */
  if (wc === 'compact') {
    return (
      <div
        data-np-bar=""
        className="glass pointer-events-auto relative flex h-[62px] items-center gap-2 overflow-hidden rounded-[22px] pl-2 pr-2.5"
        style={{ touchAction: 'pan-y' }}
        onPointerDown={swipe.onPointerDown}
        onPointerMove={swipe.onPointerMove}
        onPointerUp={swipe.onPointerUp}
        onPointerCancel={swipe.onPointerCancel}
        onClickCapture={swipe.onClickCapture}
      >
        <button
          onClick={toggleFullscreen}
          className="flex min-w-0 flex-1 items-center gap-3"
          aria-label={t('player.openNowPlaying')}
        >
          <motion.span style={{ x: coverDrag }} className="flex-none">
            {cover('h-11 w-11')}
          </motion.span>
          <motion.span style={{ x: swipe.x }} className="min-w-0 flex-1">
            {titles(false)}
          </motion.span>
        </button>
        {playKey('sm')}
        <button onClick={handleNext} className={iconBtn} aria-label={t('player.next')}>
          <SkipForward size={20} weight="fill" />
        </button>
        <ProgressLine className="bottom-[5px] left-5 right-5" />
      </div>
    )
  }

  /* ===== 中：一条 ===== */
  if (wc === 'regular') {
    return (
      <div data-np-bar="" className="glass pointer-events-auto relative grid h-[70px] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 rounded-[24px] px-3">
        <button
          onClick={toggleFullscreen}
          className="flex min-w-0 items-center gap-3"
          aria-label={t('player.openNowPlaying')}
        >
          {cover('h-12 w-12')}
          {titles(false)}
        </button>
        <div className="flex items-center">
          <button onClick={handlePrev} className={iconBtn} aria-label={t('player.previous')}>
            <SkipBack size={20} weight="fill" />
          </button>
          {playKey('md')}
          <button onClick={handleNext} className={iconBtn} aria-label={t('player.next')}>
            <SkipForward size={20} weight="fill" />
          </button>
        </div>
        <div className="flex items-center justify-end gap-0.5">
          {favorite}
          <button onClick={() => setFullscreen(true)} className={iconBtn} aria-label={t('player.lyrics')}>
            <MicrophoneStage size={18} />
          </button>
          <button
            onClick={() => setQueueOpen(!isQueueOpen)}
            className={iconBtn}
            aria-label={t('player.queue')}
            aria-pressed={isQueueOpen}
          >
            <Queue size={18} />
          </button>
        </div>
        <ProgressLine className="bottom-[6px] left-6 right-6" />
      </div>
    )
  }

  /* ===== 宽：完整 ===== */
  return (
    <div
      ref={barRef}
      data-np-bar=""
      className="glass pointer-events-auto grid h-[86px] grid-cols-[minmax(0,1.2fr)_minmax(300px,460px)_minmax(0,1fr)] items-center gap-5 rounded-[26px] px-3"
    >
      <div className="flex min-w-0 items-center gap-3">
        <button onClick={toggleFullscreen} className="press-pop flex-none" aria-label={t('player.openNowPlaying')}>
          {cover('h-[54px] w-[54px]')}
        </button>
        <button onClick={toggleFullscreen} className="min-w-0" aria-label={t('player.openNowPlaying')}>
          {titles(true)}
        </button>
        {favorite}
      </div>

      <div className="flex flex-col items-center gap-1 pb-0.5">
        <div className="flex items-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <button onClick={toggleShuffle} className={iconBtn} aria-label={t('player.shuffle')} aria-pressed={shuffle}>
                <Shuffle size={17} weight={shuffle ? 'bold' : 'regular'} />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t(shuffle ? 'player.shuffleOff' : 'player.shuffle')}</TooltipContent>
          </Tooltip>
          <button onClick={handlePrev} className={iconBtn} aria-label={t('player.previous')}>
            <SkipBack size={20} weight="fill" />
          </button>
          {playKey('md')}
          <button onClick={handleNext} className={iconBtn} aria-label={t('player.next')}>
            <SkipForward size={20} weight="fill" />
          </button>
          <Tooltip>
            <TooltipTrigger asChild>
              <button onClick={cycleRepeatMode} className={iconBtn} aria-label={repeatLabel} aria-pressed={repeatMode !== 'none'}>
                {repeatMode === 'one' ? <RepeatOnce size={17} weight="bold" /> : <Repeat size={17} weight={repeatMode === 'all' ? 'bold' : 'regular'} />}
              </button>
            </TooltipTrigger>
            <TooltipContent>{repeatLabel}</TooltipContent>
          </Tooltip>
        </div>
        <ProgressRow />
      </div>

      <div className="flex items-center justify-end gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <button onClick={() => setFullscreen(true)} className={iconBtn} aria-label={t('player.lyrics')}>
              <MicrophoneStage size={18} />
            </button>
          </TooltipTrigger>
          <TooltipContent>{t('player.lyrics')}</TooltipContent>
        </Tooltip>
        <SleepTimerMenu className={iconBtn} />
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setQueueOpen(!isQueueOpen)}
              className={iconBtn}
              aria-label={t('player.queue')}
              aria-pressed={isQueueOpen}
            >
              <Queue size={18} />
            </button>
          </TooltipTrigger>
          <TooltipContent>{t('player.queue')}</TooltipContent>
        </Tooltip>
        <div className="mx-1 flex w-28 items-center gap-1">
          <button onClick={toggleMute} className={iconBtn} aria-label={t('player.mute')} aria-pressed={muted}>
            <VolumeIcon size={17} />
          </button>
          <Slider
            value={[muted ? 0 : volume]}
            max={1}
            step={0.05}
            onValueChange={handleVolumeChange}
            className="flex-1"
            aria-label={t('player.volume')}
            aria-valuetext={`${Math.round((muted ? 0 : volume) * 100)}%`}
          />
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button onClick={toggleFullscreen} className={iconBtn} aria-label={t('player.fullscreen')}>
              <ArrowsOutSimple size={17} />
            </button>
          </TooltipTrigger>
          <TooltipContent>{t('player.fullscreen')}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
