/**
 * 底部播放条：浮在内容上方的一张纸片，按窗口档位换形态（原 PlayerBar + MiniPlayer 合一）。
 *
 *   compact  胶囊：封面 + 曲名 + 橡胶播放键 + 下一首；左右滑切歌，上滑打开正在播放
 *   regular  一条：封面 / 上一首 播放 下一首 / 歌词 队列
 *   wide     完整：封面曲名收藏 / 随机 上一首 播放 下一首 循环 + 进度行 / 歌词 定时 队列 音量 全屏
 *
 * 性能：细粒度 selector 订阅 store；进度行与进度线拆成独立 memo 子组件，
 * 播放中每秒四次的 currentTime 更新只重渲染它们。
 */

import { useCallback, useEffect, memo, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent, PointerEvent } from 'react'
import {
  Play, Pause, SkipBack, SkipForward, SpeakerHigh, SpeakerX,
  SpeakerLow, Heart, Queue, Repeat, RepeatOnce,
  Shuffle, MicrophoneStage, ArrowsOutSimple,
} from '@phosphor-icons/react'
import { Haptics, ImpactStyle } from '@capacitor/haptics'
import { cn } from '@/lib/utils'
import { isNativePlatform, type WindowClass } from '@/lib/platform'
import { usePlayerStore, type RepeatMode } from '@/store/playerStore'
import { useServerStore } from '@/store/serverStore'
import { SleepTimerMenu } from '@/components/player/SleepTimerMenu'
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

/** 次要键：44px 命中区，图标居中；hover 铺一层下沉底 */
const iconBtn =
  'w-10 h-10 rounded-pill flex flex-none items-center justify-center text-ink-soft ' +
  'hover:bg-paper-deep hover:text-ink transition-colors duration-150 active:scale-95 ' +
  'aria-pressed:text-primary'

/** 主控制轻触感（仅原生壳） */
function lightImpact() {
  if (isNativePlatform) Haptics.impact({ style: ImpactStyle.Light }).catch(() => {})
}

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
      <span className="num w-10 flex-none text-right text-[12px] text-ink-faint">
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
        className="group/track relative flex h-4 flex-1 cursor-pointer select-none items-center"
      >
        <div className="relative h-[4px] w-full overflow-hidden rounded-pill bg-paper-3">
          <div
            className="absolute inset-0 origin-left bg-ink-faint/25 transition-transform duration-500"
            style={{ transform: `scaleX(${bufferRatio})` }}
          />
          <div className="absolute inset-0 origin-left bg-primary" style={{ transform: `scaleX(${playRatio})` }} />
        </div>
        <div
          className="pointer-events-none absolute left-0 top-1/2 h-3 w-3 -translate-y-1/2 rounded-pill bg-sheet shadow-press"
          style={{ transform: `translate(calc(${playRatio} * var(--track-w, 0px) - 50%), -50%)` }}
        />
      </div>
      <span className="num w-10 flex-none text-[12px] text-ink-faint">
        {formatDuration(duration)}
      </span>
    </div>
  )
})

/** 进度线（窄、中两档）：贴在纸片下缘内侧的一条细线，只读 */
const ProgressLine = memo(function ProgressLine({ className }: { className?: string }) {
  const currentTime = usePlayerStore(s => s.currentTime)
  const duration = usePlayerStore(s => s.duration)
  const safeDuration = isFinite(duration) && duration > 0 ? duration : 1
  const ratio = Math.min(1, currentTime / safeDuration)
  return (
    <div className={cn('pointer-events-none absolute h-[3px] overflow-hidden rounded-pill bg-paper-3', className)} aria-hidden>
      <div className="h-full origin-left bg-primary" style={{ transform: `scaleX(${ratio})` }} />
    </div>
  )
})

/** 迷你播放条的横滑切歌：左滑下一首、右滑上一首、上滑打开正在播放 */
function useMiniSwipe(onNext: () => void, onPrev: () => void, onOpen: () => void) {
  const start = useRef<{ x: number; y: number; id: number } | null>(null)
  const swiped = useRef(false)
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse') return
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId }
    swiped.current = false
  }
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const s = start.current
    start.current = null
    if (!s || s.id !== e.pointerId) return
    const dx = e.clientX - s.x
    const dy = e.clientY - s.y
    if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      swiped.current = true
      lightImpact()
      if (dx < 0) onNext(); else onPrev()
    } else if (dy < -44 && Math.abs(dy) > Math.abs(dx)) {
      swiped.current = true
      onOpen()
    }
  }
  /** 刚滑过就吞掉随后的 click，免得一滑又点开了全屏 */
  const onClickCapture = (e: MouseEvent) => {
    if (swiped.current) {
      swiped.current = false
      e.preventDefault()
      e.stopPropagation()
    }
  }
  return { onPointerDown, onPointerUp, onClickCapture }
}

export function PlayerBar({ wc }: { wc: WindowClass }) {
  const { t } = useT()
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
    else state.prev()
  }, [])

  const cycleRepeatMode = useCallback(() => {
    const modes: RepeatMode[] = ['none', 'all', 'one']
    setRepeatMode(modes[(modes.indexOf(repeatMode) + 1) % modes.length])
  }, [repeatMode, setRepeatMode])

  const handleToggleStar = useCallback(() => {
    if (!currentSong) return
    toggleStar.mutate(
      { id: currentSong.id, type: 'song', isStarred: !!currentSong.starred, song: currentSong },
      { onSuccess: () => updateCurrentSong({ starred: !currentSong.starred }) }
    )
  }, [currentSong, toggleStar, updateCurrentSong])

  const swipe = useMiniSwipe(() => next(), handlePrev, () => setFullscreen(true))

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

  const VolumeIcon = muted || volume === 0 ? SpeakerX : volume < 0.5 ? SpeakerLow : SpeakerHigh
  const repeatLabel = repeatMode === 'one'
    ? t('player.repeatOne')
    : repeatMode === 'all' ? t('player.repeatAll') : t('player.repeatOff')
  const playLabel = t(isPlaying && streamBuffering ? 'player.buffering' : isPlaying ? 'player.pause' : 'player.play')

  if (!currentSong) {
    // 窄窗口没有歌就不占地方；中、宽两档留一条安静的纸片，告诉人从哪开始
    if (wc === 'compact') return null
    return (
      <div className="sheet pointer-events-auto flex h-[64px] items-center justify-center px-6">
        <p className="text-[14px] text-ink-faint">{t('player.selectToStart')}</p>
      </div>
    )
  }

  const cover = (size: string) => (
    <span className={cn('block flex-none overflow-hidden rounded-sm shadow-card', size)}>
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
    <span
      key={currentSong.id}
      className="flex min-w-0 flex-col text-left leading-tight animate-page-turn motion-reduce:animate-none"
    >
      <span className="flex min-w-0 items-center gap-1.5 text-[14.5px] font-semibold text-ink">
        <span className="truncate">{spaceCJK(currentSong.title)}</span>
        <VipTag song={currentSong} />
        {multiSource && <SourceBadge serverId={currentSong.serverId} />}
      </span>
      <span className="mt-0.5 truncate text-[13px] text-ink-faint">
        {spaceCJK(currentSong.artist)}
        {withAlbum && currentSong.album ? <span className="ml-2.5">{spaceCJK(currentSong.album)}</span> : null}
      </span>
    </span>
  )

  const playKey = (size: 'sm' | 'md') => (
    <button
      onClick={() => { lightImpact(); togglePlay() }}
      className={cn(
        'rubber-key flex-none',
        size === 'sm' ? 'is-compact h-10 w-10' : 'h-11 w-11 mx-1.5',
        isPlaying && streamBuffering && 'animate-buffering'
      )}
      aria-label={playLabel}
      aria-busy={isPlaying && streamBuffering}
    >
      {isPlaying ? <Pause size={size === 'sm' ? 17 : 19} weight="fill" /> : <Play size={size === 'sm' ? 17 : 19} weight="fill" className="ml-0.5" />}
    </button>
  )

  const favorite = canFavoriteCurrent && (
    <button
      onClick={handleToggleStar}
      disabled={toggleStar.isPending}
      className={cn(iconBtn, currentSong.starred && 'text-sem-fav')}
      aria-label={t(currentSong.starred ? 'player.unfavorite' : 'player.favorite')}
      aria-pressed={!!currentSong.starred}
    >
      <Heart size={18} weight={currentSong.starred ? 'fill' : 'regular'} />
    </button>
  )

  /* ===== 窄：胶囊 ===== */
  if (wc === 'compact') {
    return (
      <div
        className="sheet pointer-events-auto relative flex h-[60px] items-center gap-2 rounded-pill pl-2 pr-2.5"
        style={{ touchAction: 'pan-y' }}
        onPointerDown={swipe.onPointerDown}
        onPointerUp={swipe.onPointerUp}
        onClickCapture={swipe.onClickCapture}
      >
        <button
          onClick={toggleFullscreen}
          className="flex min-w-0 flex-1 items-center gap-3"
          aria-label={t('player.openNowPlaying')}
        >
          {cover('h-11 w-11 rounded-pill')}
          {titles(false)}
        </button>
        {playKey('sm')}
        <button onClick={() => { lightImpact(); next() }} className={iconBtn} aria-label={t('player.next')}>
          <SkipForward size={20} weight="fill" />
        </button>
        <ProgressLine className="bottom-1 left-6 right-6 h-[2px]" />
      </div>
    )
  }

  /* ===== 中：一条 ===== */
  if (wc === 'regular') {
    return (
      <div className="sheet pointer-events-auto relative grid h-[68px] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 px-3">
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
          <button onClick={() => next()} className={iconBtn} aria-label={t('player.next')}>
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
        <ProgressLine className="bottom-1.5 left-5 right-5 h-[2px]" />
      </div>
    )
  }

  /* ===== 宽：完整 ===== */
  return (
    <div
      ref={barRef}
      className="sheet pointer-events-auto grid h-[78px] grid-cols-[minmax(0,1.2fr)_minmax(300px,440px)_minmax(0,1fr)] items-center gap-5 px-3"
    >
      <div className="flex min-w-0 items-center gap-3">
        <button onClick={toggleFullscreen} className="flex-none transition-opacity hover:opacity-85" aria-label={t('player.openNowPlaying')}>
          {cover('h-[54px] w-[54px]')}
        </button>
        <button onClick={toggleFullscreen} className="min-w-0" aria-label={t('player.openNowPlaying')}>
          {titles(true)}
        </button>
        {favorite}
      </div>

      <div className="flex flex-col items-center gap-0.5">
        <div className="flex items-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <button onClick={toggleShuffle} className={iconBtn} aria-label={t('player.shuffle')} aria-pressed={shuffle}>
                <Shuffle size={17} />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t(shuffle ? 'player.shuffleOff' : 'player.shuffle')}</TooltipContent>
          </Tooltip>
          <button onClick={handlePrev} className={iconBtn} aria-label={t('player.previous')}>
            <SkipBack size={20} weight="fill" />
          </button>
          {playKey('md')}
          <button onClick={() => next()} className={iconBtn} aria-label={t('player.next')}>
            <SkipForward size={20} weight="fill" />
          </button>
          <Tooltip>
            <TooltipTrigger asChild>
              <button onClick={cycleRepeatMode} className={iconBtn} aria-label={repeatLabel} aria-pressed={repeatMode !== 'none'}>
                {repeatMode === 'one' ? <RepeatOnce size={17} /> : <Repeat size={17} />}
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
