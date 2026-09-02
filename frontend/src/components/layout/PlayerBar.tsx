/**
 * 底部播放条（DESIGN v2 §4.2 / DESIGN v3 §4.2）
 * docked 在布局流内（非浮空）：上缘 1px 发丝线，纸面底
 * 三段：左 = 52px 封面 + 衬线曲名 + 歌手 + 收藏
 *       中 = 传输键组（播放键为唯一实心朱红圆）+ 细进度条（mono 时间码，可拖 seek）
 *       右 = 歌词 / 队列 / 音量细滑杆 / 全屏
 *
 * 性能优化：
 * - 细粒度 selector 订阅 store，避免 currentTime 高频更新触发整体重渲染
 * - 进度行（时间码+进度条）拆成独立 memo 子组件
 * - hover 状态用 CSS group-hover 实现，零 re-render 开销
 */

import { useCallback, useEffect, memo, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent, PointerEvent } from 'react'
import {
  Play, Pause, SkipBack, SkipForward, SpeakerHigh, SpeakerX,
  SpeakerLow, Heart, Queue, Repeat, RepeatOnce,
  Shuffle, MicrophoneStage, ArrowsOutSimple
} from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { usePlayerStore, type RepeatMode } from '@/store/playerStore'
import { useServerStore } from '@/store/serverStore'
import { SleepTimerMenu } from '@/components/player/SleepTimerMenu'
import { SourceBadge } from '@/components/sources/SourceBadge'
import { seekHowl } from '@/hooks/useAudioEngine'
import { useToggleStar } from '@/hooks/useServerQueries'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'
import { Slider } from '@/components/ui/slider'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { findAdapterFor } from '@/api'
import { formatDuration } from '@/utils/formatters'
import { spaceCJK } from '@/utils/cjkTypography'
import { useT } from '@/i18n'

/**
 * docked 外壳：上缘 1px 发丝线 + 纸面底（DESIGN v2 §4.2）；
 * 波普下描边加粗到 2px，底色换成卡面（DESIGN v3 §4.2）。
 */
const barShell = 'flex-shrink-0 border-t border-hair bg-paper pop:bg-surface'

/**
 * 图标键。
 * 编辑风：纯图标，hover 变 accent（DESIGN v2 §4.1）。
 * 波普：  描边圆钮 + 硬投影，按下去压实（DESIGN v3 §4.1）。
 */
const iconBtn =
  'press-pop w-8 h-8 rounded-full flex items-center justify-center text-ink-soft ' +
  'hover:text-primary transition-colors duration-200 active:scale-95 ' +
  'pop:border pop:border-hair pop:bg-paper pop:text-foreground pop:shadow-press pop:hover:bg-secondary pop:hover:text-foreground'

/**
 * 进度行子组件 — 独立订阅 currentTime / duration / buffered
 * 播放中每秒更新 4 次，只有这个组件重渲染，不影响控制按钮区域
 * 双层进度条：浅色层=缓冲进度，朱红层=播放进度
 */
const ProgressBar = memo(function ProgressBar() {
  const { t } = useT()
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
  const dragMoveRef = useRef<((e: globalThis.PointerEvent) => void) | null>(null)
  const dragUpRef = useRef<((e: globalThis.PointerEvent) => void) | null>(null)
  safeDurationRef.current = safeDuration

  const clearDragListeners = useCallback(() => {
    if (dragMoveRef.current) {
      document.removeEventListener('pointermove', dragMoveRef.current)
      dragMoveRef.current = null
    }
    if (dragUpRef.current) {
      // pointerup 与 pointercancel 注册的是同一个函数，两处都要摘
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

  /**
   * 进度条拖动。
   *
   * 用 Pointer Events 而不是 Mouse Events：后者在触屏上不触发，
   * 手机端这条进度条曾经完全拖不动——只能点一下跳，想微调就没办法。
   * 全屏播放器早就是 Pointer 的写法，这里对齐。
   *
   * setPointerCapture 让手指滑出进度条范围后事件仍然送达，
   * 否则拖到屏幕边缘就断了。
   */
  const handlePointerDown = useCallback((e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const rect = progressRef.current?.getBoundingClientRect()
    if (!rect) return
    const getR = (cx: number) => Math.max(0, Math.min(1, (cx - rect.left) / rect.width))
    // 按下时只更新本地拖动值，不 seek 音频，避免 timeupdate 与拖动位置互相覆盖
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
    // 指针被系统取消（来电、手势冲突）时也要收尾，否则进度条会卡在拖动态
    document.addEventListener('pointercancel', onUp)
  }, [clearDragListeners])

  // 键盘 seek：←/→ ±5s（全局快捷键的方向键绑定均需 meta 修饰，无冲突）
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
    <div className="flex items-center gap-2.5 w-[clamp(240px,32vw,420px)]">
      <span className="font-num text-[11px] text-ink-faint flex-none w-9 text-right">
        {formatDuration(displayTime)}
      </span>

      {/* 3px 细进度轨，hover 浮现圆点 */}
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
        // 没有 valuetext 时读屏念的是「142」这样的裸秒数——
        // 数字本身不构成信息，用户要的是「2:22，共 3:11」
        aria-valuetext={t('player.progressAt', {
          current: formatDuration(Math.round(displayTime)),
          total: formatDuration(Math.round(safeDuration)),
        })}
        className="group/track relative flex-1 h-3.5 flex items-center cursor-pointer select-none"
      >
        {/* 轨道：编辑风 3px 细线；波普 10px 描边胶囊（DESIGN v3 §4.2） */}
        <div className="relative w-full h-[3px] rounded-full overflow-hidden bg-hair-soft pop:h-[12px] pop:border pop:border-hair pop:bg-paper-deep">
          {/* 缓冲进度层（浅墨）*/}
          <div
            className="absolute left-0 top-0 h-full rounded-full bg-ink-faint/40 transition-[width] duration-500"
            style={{ width: `${bufferPercent}%` }}
          />
          {/* 播放进度层（朱红）*/}
          <div
            className="absolute left-0 top-0 h-full rounded-full bg-primary transition-[width] duration-200"
            style={{ width: `${playPercent}%` }}
          />
        </div>
        <div
          className="absolute top-1/2 w-2.5 h-2.5 rounded-full bg-foreground -translate-x-1/2 -translate-y-1/2 scale-0 group-hover/track:scale-100 transition-transform duration-150 pointer-events-none pop:w-4 pop:h-4 pop:border pop:border-hair pop:bg-surface"
          style={{ left: `${playPercent}%` }}
        />
      </div>

      <span className="font-num text-[11px] text-ink-faint flex-none w-9">
        {formatDuration(duration)}
      </span>
    </div>
  )
})

export function PlayerBar() {
  const { t } = useT()
  // 细粒度 selector：只订阅不含 currentTime/duration 的字段
  const currentSong   = usePlayerStore(s => s.currentSong)
  const isPlaying     = usePlayerStore(s => s.isPlaying)
  const streamBuffering = usePlayerStore(s => s.streamBuffering)
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
  // 多源连接时曲目信息带来源徽标（PLAN 2.5）；单源保持原样
  const multiSource = useServerStore(s => s.connectedServerIds.length > 1)

  const coverUrl = currentSong?.coverArt
    ? (findAdapterFor(currentSong.serverId)?.getCoverUrl(currentSong.coverArt, 96) ?? undefined)
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
      { id: currentSong.id, type: 'song', isStarred: !!currentSong.starred, song: currentSong },
      { onSuccess: () => updateCurrentSong({ starred: !currentSong.starred }) }
    )
  }, [currentSong, toggleStar, updateCurrentSong])

  const VolumeIcon = muted || volume === 0 ? SpeakerX : volume < 0.5 ? SpeakerLow : SpeakerHigh

  const repeatLabel = repeatMode === 'one'
    ? t('player.repeatOne')
    : repeatMode === 'all' ? t('player.repeatAll') : t('player.repeatOff')

  if (!currentSong) {
    return (
      <div className={cn(barShell, 'h-[76px] flex items-center justify-center')}>
        <p className="font-serif text-[15px] text-ink-faint pop:font-semibold">{t('player.selectToStart')}</p>
      </div>
    )
  }

  return (
    <div className={barShell}>
      <div className="max-w-[1180px] mx-auto px-10 h-[76px] grid grid-cols-[1fr_auto_1fr] items-center gap-6">
        {/* ===== 左：封面 + 歌曲信息 + 收藏 ===== */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={toggleFullscreen}
            className="w-[52px] h-[52px] rounded-sm overflow-hidden ring-1 ring-border flex-shrink-0 hover:opacity-80 transition-opacity active:scale-[0.97] pop:ring-0 pop:border pop:border-hair pop:shadow-press"
            aria-label={t('player.openNowPlaying')}
          >
            <ImageWithFallback
              src={coverUrl}
              alt={currentSong.album}
              fallbackType="album"
              className="w-full h-full"
              eager
              songId={currentSong.id}
              customCoverParams={{ type: 'song', title: currentSong.title, artist: currentSong.artist, album: currentSong.album, path: currentSong.path }}
            />
          </button>

          {/*
            切歌翻页：key 换掉就重新播一次动画，新的曲目信息像纸页被翻过来。
            transform-origin 落在左缘、perspective 给得很浅——这是一次翻页，
            不是一个特效；幅度大了会变成 PPT 转场。
          */}
          <div
            key={currentSong.id}
            className="min-w-0 animate-page-turn motion-reduce:animate-none"
            style={{ transformOrigin: 'left center', perspective: '640px' }}
          >
            <p className="font-serif text-[14.5px] font-semibold text-foreground truncate hover:text-primary cursor-pointer transition-colors duration-200 flex items-center gap-1.5"
              onClick={toggleFullscreen}>
              <span className="truncate">{spaceCJK(currentSong.title)}</span>
              {multiSource && <SourceBadge serverId={currentSong.serverId} />}
            </p>
            <p className="text-[11.5px] text-ink-soft truncate mt-0.5">
              {spaceCJK(currentSong.artist)}{currentSong.album ? ` · ${spaceCJK(currentSong.album)}` : ''}
            </p>
          </div>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleToggleStar}
                disabled={toggleStar.isPending}
                className={cn(iconBtn, 'flex-shrink-0', currentSong.starred && 'text-primary')}
                aria-label={t(currentSong.starred ? 'player.unfavorite' : 'player.favorite')}
              >
                <Heart size={17} weight={currentSong.starred ? 'fill' : 'regular'} />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t(currentSong.starred ? 'player.unfavorite' : 'player.favorite')}</TooltipContent>
          </Tooltip>
        </div>

        {/* ===== 中：传输键 + 进度行 ===== */}
        <div className="flex flex-col items-center justify-center gap-1 py-1.5">
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={toggleShuffle}
                  className={cn(iconBtn, shuffle && 'text-primary')}
                  aria-label={t('player.shuffle')}
                  aria-pressed={shuffle}
                >
                  <Shuffle size={16} />
                </button>
              </TooltipTrigger>
              <TooltipContent>{t(shuffle ? 'player.shuffleOff' : 'player.shuffle')}</TooltipContent>
            </Tooltip>

            <button onClick={handlePrev} className={iconBtn} aria-label={t('player.previous')}>
              <SkipBack size={19} weight="fill" />
            </button>

            {/* 播放主键：全条唯一实心朱红圆（DESIGN §4.1 唯一例外） */}
            <button
              onClick={togglePlay}
              className={cn(
                'press-pop w-10 h-10 mx-1 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:brightness-110 active:scale-95 transition-[transform,filter] duration-200',
                'pop:w-11 pop:h-11 pop:border pop:border-hair pop:shadow-float',
                isPlaying && streamBuffering && 'animate-buffering'
              )}
              aria-label={t(
                isPlaying && streamBuffering ? 'player.buffering'
                  : isPlaying ? 'player.pause' : 'player.play'
              )}
              aria-busy={isPlaying && streamBuffering}
            >
              {isPlaying ? (
                <Pause size={18} weight="fill" />
              ) : (
                <Play size={18} weight="fill" className="ml-0.5" />
              )}
            </button>

            <button onClick={() => next()} className={iconBtn} aria-label={t('player.next')}>
              <SkipForward size={19} weight="fill" />
            </button>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={cycleRepeatMode}
                  className={cn(iconBtn, repeatMode !== 'none' && 'text-primary')}
                  aria-label={repeatLabel}
                  aria-pressed={repeatMode !== 'none'}
                >
                  {repeatMode === 'one' ? (
                    <RepeatOnce size={16} />
                  ) : (
                    <Repeat size={16} />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent>{repeatLabel}</TooltipContent>
            </Tooltip>
          </div>

          <ProgressBar />
        </div>

        {/* ===== 右：歌词 / 队列 / 音量 / 全屏 ===== */}
        <div className="flex items-center justify-end gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <button onClick={toggleFullscreen} className={iconBtn} aria-label={t('player.lyrics')}>
                <MicrophoneStage size={17} />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t('player.lyrics')}</TooltipContent>
          </Tooltip>

          <SleepTimerMenu className={iconBtn} />

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setQueueOpen(!isQueueOpen)}
                className={cn(iconBtn, isQueueOpen && 'text-primary')}
                aria-label={t('player.queue')}
              >
                <Queue size={17} />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t('player.queue')}</TooltipContent>
          </Tooltip>

          <div className="flex items-center gap-1 w-28 mx-1">
            <button
              onClick={toggleMute}
              className={cn(iconBtn, 'flex-shrink-0')}
              aria-label={t('player.mute')}
              aria-pressed={muted}
            >
              <VolumeIcon size={16} />
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
                <ArrowsOutSimple size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t('player.fullscreen')}</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}
