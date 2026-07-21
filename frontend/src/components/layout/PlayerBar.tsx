/**
 * 播放控制台 — 悬浮式玻璃控制台（现代 Hi-Fi 设计，见 DESIGN.md §4）
 * 三段 grid 布局：封面+歌名+爱心 | 传输键+进度行 | 歌词/队列/音量/全屏
 *
 * 性能优化：
 * - 细粒度 selector 订阅 store，避免 currentTime 高频更新触发整体重渲染
 * - 进度行（时间码+进度条）拆成独立 memo 子组件
 * - hover 状态用 CSS group-hover 实现，零 re-render 开销
 */

import { useCallback, useEffect, memo, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import {
  Play, Pause, SkipBack, SkipForward, SpeakerHigh, SpeakerX,
  SpeakerLow, Heart, Queue, Repeat, RepeatOnce,
  Shuffle, MicrophoneStage, ArrowsOutSimple
} from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { usePlayerStore, type RepeatMode } from '@/store/playerStore'
import { seekHowl } from '@/hooks/useAudioEngine'
import { useToggleStar } from '@/hooks/useServerQueries'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'
import { Slider } from '@/components/ui/slider'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { getAdapter, hasAdapter } from '@/api'
import { formatDuration } from '@/utils/formatters'

/** 悬浮控制台定位：左 = 侧边栏宽 + 8px，右 16px，下 16px，高 76px */
const consoleShell =
  'absolute bottom-4 right-4 left-[calc(var(--sidebar-width)+8px)] z-40 h-[76px] ' +
  'rounded-[20px] glass shadow-[0_18px_46px_-18px_rgba(0,0,0,0.55)]'

/**
 * 进度行子组件 — 独立订阅 currentTime / duration / buffered
 * 播放中每秒更新 4 次，只有这个组件重渲染，不影响控制按钮区域
 * 使用自定义双层进度条：浅色层=缓冲进度，深色层=播放进度
 */
const ProgressBar = memo(function ProgressBar() {
  const currentTime = usePlayerStore(s => s.currentTime)
  const duration = usePlayerStore(s => s.duration)
  const buffered = usePlayerStore(s => s.buffered)

  // 拖动中的本地进度值：拖动期间忽略 store currentTime，松开时才真正 seek
  const [dragValue, setDragValue] = useState<number | null>(null)
  // 松开后的短暂保护窗口：seek 前排队的 timeupdate 会带回旧位置，此窗口内仍渲染 seek 目标
  const releaseGuardRef = useRef<{ target: number; until: number } | null>(null)

  const safeDuration = isFinite(duration) && duration > 0 ? duration : 1
  const guard = releaseGuardRef.current
  const displayTime = dragValue !== null
    ? dragValue
    : guard && performance.now() < guard.until && Math.abs(currentTime - guard.target) > 1
      ? guard.target
      : currentTime
  const playPercent = Math.min(100, (displayTime / safeDuration) * 100)
  const bufferPercent = Math.min(100, buffered * 100)

  const progressRef = useRef<HTMLDivElement>(null)
  const safeDurationRef = useRef(safeDuration)
  const dragMoveRef = useRef<((e: globalThis.MouseEvent) => void) | null>(null)
  const dragUpRef = useRef<((e: globalThis.MouseEvent) => void) | null>(null)
  safeDurationRef.current = safeDuration

  const clearDragListeners = useCallback(() => {
    if (dragMoveRef.current) {
      document.removeEventListener('mousemove', dragMoveRef.current)
      dragMoveRef.current = null
    }
    if (dragUpRef.current) {
      document.removeEventListener('mouseup', dragUpRef.current)
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

  const handleMouseDown = useCallback((e: MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    const rect = progressRef.current?.getBoundingClientRect()
    if (!rect) return
    const getR = (cx: number) => Math.max(0, Math.min(1, (cx - rect.left) / rect.width))
    // 按下时只更新本地拖动值，不 seek 音频，避免 timeupdate 与拖动位置互相覆盖
    setDragValue(getR(e.clientX) * safeDurationRef.current)

    const onMove = (me: globalThis.MouseEvent) => {
      setDragValue(getR(me.clientX) * safeDurationRef.current)
    }
    const onUp = (me: globalThis.MouseEvent) => {
      const target = getR(me.clientX) * safeDurationRef.current
      releaseGuardRef.current = { target, until: performance.now() + 500 }
      seekHowl(target)
      setDragValue(null)
      clearDragListeners()
    }
    clearDragListeners()
    dragMoveRef.current = onMove
    dragUpRef.current = onUp
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [clearDragListeners])

  return (
    <div className="flex items-center gap-2.5 w-[clamp(240px,32vw,420px)]">
      <span className="font-num text-[10.5px] text-muted-foreground flex-none w-9">
        {formatDuration(displayTime)}
      </span>

      {/* 3px 细进度轨，hover 浮现 thumb */}
      <div
        ref={progressRef}
        onMouseDown={handleMouseDown}
        className="group/track relative flex-1 h-3.5 flex items-center cursor-pointer select-none"
      >
        <div className="relative w-full h-[3px] rounded-full overflow-hidden bg-border">
          {/* 缓冲进度层（浅色）*/}
          <div
            className="absolute left-0 top-0 h-full rounded-full bg-muted-foreground/25 transition-[width] duration-500"
            style={{ width: `${bufferPercent}%` }}
          />
          {/* 播放进度层（主色）*/}
          <div
            className="absolute left-0 top-0 h-full rounded-full bg-primary transition-[width] duration-200"
            style={{ width: `${playPercent}%` }}
          />
        </div>
        <div
          className="absolute top-1/2 w-2.5 h-2.5 rounded-full bg-foreground shadow-md -translate-x-1/2 -translate-y-1/2 scale-0 group-hover/track:scale-100 transition-transform duration-150 pointer-events-none"
          style={{ left: `${playPercent}%` }}
        />
      </div>

      <span className="font-num text-[10.5px] text-muted-foreground flex-none w-9 text-right">
        {formatDuration(duration)}
      </span>
    </div>
  )
})

export function PlayerBar() {
  // 细粒度 selector：只订阅不含 currentTime/duration 的字段
  const currentSong   = usePlayerStore(s => s.currentSong)
  const isPlaying     = usePlayerStore(s => s.isPlaying)
  const volume        = usePlayerStore(s => s.volume)
  const muted         = usePlayerStore(s => s.muted)
  const repeatMode    = usePlayerStore(s => s.repeatMode)
  const shuffle       = usePlayerStore(s => s.shuffle)
  const isQueueOpen   = usePlayerStore(s => s.isQueueOpen)
  const togglePlay      = usePlayerStore(s => s.togglePlay)
  const next            = usePlayerStore(s => s.next)
  const setVolume       = usePlayerStore(s => s.setVolume)
  const toggleMute      = usePlayerStore(s => s.toggleMute)
  const setRepeatMode   = usePlayerStore(s => s.setRepeatMode)
  const toggleShuffle   = usePlayerStore(s => s.toggleShuffle)
  const toggleFullscreen = usePlayerStore(s => s.toggleFullscreen)
  const setQueueOpen    = usePlayerStore(s => s.setQueueOpen)
  const updateCurrentSong = usePlayerStore(s => s.updateCurrentSong)

  const toggleStar = useToggleStar()

  const coverUrl = currentSong?.coverArt && hasAdapter()
    ? getAdapter().getCoverUrl(currentSong.coverArt, 96)
    : undefined

  const handleVolumeChange = useCallback(
    (value: number[]) => { setVolume(value[0]) },
    [setVolume]
  )

  /** 上一首：播放超过 3 秒重播当前歌曲，否则切到上一首 */
  const handlePrev = useCallback(() => {
    const state = usePlayerStore.getState()
    if (state.currentTime > 3) {
      seekHowl(0)
    } else {
      state.prev()
    }
  }, [])

  const cycleRepeatMode = useCallback(() => {
    const modes: RepeatMode[] = ['none', 'all', 'one']
    setRepeatMode(modes[(modes.indexOf(repeatMode) + 1) % modes.length])
  }, [repeatMode, setRepeatMode])

  const handleToggleStar = useCallback(() => {
    if (!currentSong) return
    toggleStar.mutate(
      { id: currentSong.id, type: 'song', isStarred: !!currentSong.starred },
      { onSuccess: () => updateCurrentSong({ starred: !currentSong.starred }) }
    )
  }, [currentSong, toggleStar, updateCurrentSong])

  const VolumeIcon = muted || volume === 0 ? SpeakerX : volume < 0.5 ? SpeakerLow : SpeakerHigh

  if (!currentSong) {
    return (
      <div className={cn(consoleShell, 'flex items-center justify-center')}>
        <p className="text-sm text-muted-foreground">选择一首歌曲开始播放</p>
      </div>
    )
  }

  return (
    <div className={cn(consoleShell, 'grid grid-cols-[1fr_auto_1fr] items-center gap-4 px-[18px]')}>
      {/* ===== 左：封面（氛围光晕）+ 歌曲信息 + 爱心 ===== */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={toggleFullscreen}
          className="w-12 h-12 rounded-md overflow-hidden ring-1 ring-border flex-shrink-0 hover:opacity-80 transition-opacity active:scale-[0.97]"
        >
          <ImageWithFallback
            src={coverUrl}
            alt={currentSong.album}
            fallbackType="album"
            className="w-full h-full"
            eager
            customCoverParams={{ type: 'song', title: currentSong.title, artist: currentSong.artist, album: currentSong.album, path: currentSong.path }}
          />
        </button>

        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-foreground truncate hover:text-primary cursor-pointer transition-colors"
            onClick={toggleFullscreen}>
            {currentSong.title}
          </p>
          <p className="text-[11.5px] text-muted-foreground truncate mt-0.5">
            {currentSong.artist}{currentSong.album ? ` - ${currentSong.album}` : ''}
          </p>
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleToggleStar}
              disabled={toggleStar.isPending}
              className={cn(
                'w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 transition-colors hover:bg-accent active:scale-[0.94]',
                currentSong.starred ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Heart size={17} weight={currentSong.starred ? 'fill' : 'regular'} />
            </button>
          </TooltipTrigger>
          <TooltipContent>{currentSong.starred ? '取消喜欢' : '加入喜欢'}</TooltipContent>
        </Tooltip>
      </div>

      {/* ===== 中：传输键 + 进度行 ===== */}
      <div className="flex flex-col items-center justify-center gap-0.5 py-1.5">
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={toggleShuffle}
                className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center transition-colors hover:bg-accent active:scale-[0.94]',
                  shuffle ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Shuffle size={17} />
              </button>
            </TooltipTrigger>
            <TooltipContent>{shuffle ? '关闭随机' : '随机播放'}</TooltipContent>
          </Tooltip>

          <button
            onClick={handlePrev}
            className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors active:scale-[0.94]"
          >
            <SkipBack size={20} weight="fill" />
          </button>

          <button
            onClick={togglePlay}
            className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:brightness-110 active:scale-[0.96] transition-[transform,filter] shadow-md mx-1"
          >
            {isPlaying ? (
              <Pause size={19} weight="fill" />
            ) : (
              <Play size={19} weight="fill" className="ml-0.5" />
            )}
          </button>

          <button
            onClick={next}
            className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors active:scale-[0.94]"
          >
            <SkipForward size={20} weight="fill" />
          </button>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={cycleRepeatMode}
                className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center transition-colors hover:bg-accent active:scale-[0.94]',
                  repeatMode !== 'none' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {repeatMode === 'one' ? (
                  <RepeatOnce size={17} />
                ) : (
                  <Repeat size={17} />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {repeatMode === 'none' ? '循环关闭' : repeatMode === 'all' ? '列表循环' : '单曲循环'}
            </TooltipContent>
          </Tooltip>
        </div>

        <ProgressBar />
      </div>

      {/* ===== 右：歌词 / 队列 / 音量 / 全屏 ===== */}
      <div className="flex items-center justify-end gap-1">
        {/* 歌词 */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={toggleFullscreen}
              className="w-8 h-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors active:scale-[0.94]"
            >
              <MicrophoneStage size={17} />
            </button>
          </TooltipTrigger>
          <TooltipContent>歌词</TooltipContent>
        </Tooltip>

        {/* 播放队列 */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setQueueOpen(!isQueueOpen)}
              className={cn(
                'w-8 h-8 rounded-md flex items-center justify-center transition-colors hover:bg-accent active:scale-[0.94]',
                isQueueOpen ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Queue size={17} />
            </button>
          </TooltipTrigger>
          <TooltipContent>播放队列</TooltipContent>
        </Tooltip>

        {/* 音量控制 */}
        <div className="flex items-center gap-1 w-28 mx-1">
          <button
            onClick={toggleMute}
            className="w-8 h-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex-shrink-0 active:scale-[0.94]"
          >
            <VolumeIcon size={16} />
          </button>
          <Slider
            value={[muted ? 0 : volume]}
            max={1}
            step={0.01}
            onValueChange={handleVolumeChange}
            className="flex-1"
          />
        </div>

        {/* 全屏播放 */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={toggleFullscreen}
              className="w-8 h-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors active:scale-[0.94]"
            >
              <ArrowsOutSimple size={16} />
            </button>
          </TooltipTrigger>
          <TooltipContent>全屏播放</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
