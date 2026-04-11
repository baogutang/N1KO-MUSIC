/**
 * 底部播放控制栏 — 简洁设计
 * 默认只显示歌曲信息 + 音量/时间/功能按钮
 * hover 时中央出现播放控制按钮（上一首 / 播放 / 下一首）
 *
 * 性能优化：
 * - 细粒度 selector 订阅 store，避免 currentTime 高频更新触发整体重渲染
 * - 进度条 / 时间显示拆成独立 memo 子组件
 * - hover 状态用 CSS group-hover 实现，零 re-render 开销
 */

import { useCallback, memo, useRef } from 'react'
import type { MouseEvent } from 'react'
import {
  Play, Pause, SkipBack, SkipForward, Volume2, VolumeX,
  Volume1, Heart, ListMusic, Repeat, Repeat1,
  Shuffle, Mic2
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePlayerStore, type RepeatMode } from '@/store/playerStore'
import { seekHowl } from '@/hooks/useAudioEngine'
import { useToggleStar } from '@/hooks/useServerQueries'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'
import { Slider } from '@/components/ui/slider'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { getAdapter, hasAdapter } from '@/api'
import { formatDuration } from '@/utils/formatters'

/**
 * 进度条子组件 — 独立订阅 currentTime / duration / buffered
 * 播放中每秒更新 4 次，只有这个组件重渲染，不影响控制按钮区域
 * 使用自定义双层进度条：浅色层=缓冲进度，深色层=播放进度
 */
const ProgressBar = memo(function ProgressBar() {
  const currentTime = usePlayerStore(s => s.currentTime)
  const duration = usePlayerStore(s => s.duration)
  const buffered = usePlayerStore(s => s.buffered)

  const safeDuration = isFinite(duration) && duration > 0 ? duration : 1
  const playPercent = Math.min(100, (currentTime / safeDuration) * 100)
  const bufferPercent = Math.min(100, buffered * 100)

  const progressRef = useRef<HTMLDivElement>(null)
  const safeDurationRef = useRef(safeDuration)
  safeDurationRef.current = safeDuration

  const handleMouseDown = useCallback((e: MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    const rect = progressRef.current?.getBoundingClientRect()
    if (!rect) return
    const getR = (cx: number) => Math.max(0, Math.min(1, (cx - rect.left) / rect.width))
    seekHowl(getR(e.clientX) * safeDurationRef.current)

    const onMove = (me: globalThis.MouseEvent) => {
      usePlayerStore.getState().seekTo(getR(me.clientX) * safeDurationRef.current)
    }
    const onUp = (me: globalThis.MouseEvent) => {
      seekHowl(getR(me.clientX) * safeDurationRef.current)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  return (
    <div className="px-4 pt-0.5">
      {/* 自定义双层进度条 */}
      <div
        ref={progressRef}
        className="relative w-full h-1 group-hover/bar:h-1.5 transition-all duration-150 cursor-pointer rounded-full overflow-hidden bg-border/40 select-none"
        onMouseDown={handleMouseDown}
      >
        {/* 缓冲进度层（浅色）*/}
        <div
          className="absolute left-0 top-0 h-full rounded-full bg-muted-foreground/25 transition-[width] duration-500"
          style={{ width: `${bufferPercent}%` }}
        />
        {/* 播放进度层（主色）*/}
        <div
          className="absolute left-0 top-0 h-full rounded-full bg-primary/80 transition-[width] duration-200"
          style={{ width: `${playPercent}%` }}
        />
      </div>
    </div>
  )
})

/**
 * 时间显示子组件 — 独立订阅，与控制按钮解耦
 */
const TimeDisplay = memo(function TimeDisplay() {
  const currentTime = usePlayerStore(s => s.currentTime)
  const duration = usePlayerStore(s => s.duration)
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
      <span>{formatDuration(currentTime)}</span>
      <span>/</span>
      <span>{formatDuration(duration)}</span>
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

  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2

  if (!currentSong) {
    return (
      <div className="h-16 border-t border-border/50 bg-card/80 backdrop-blur-md flex items-center justify-center">
        <p className="text-sm text-muted-foreground">选择一首歌曲开始播放</p>
      </div>
    )
  }

  return (
    <div className="group/bar h-16 border-t border-border/50 bg-card/90 backdrop-blur-xl flex-shrink-0">
      {/* 进度条（极细，hover 时更明显）*/}
      <ProgressBar />

      <div className="flex items-center h-[calc(100%-6px)] px-4 gap-3">
        {/* ===== 左：封面 + 歌曲信息 ===== */}
        <div className="flex items-center gap-3 min-w-0 w-[260px] flex-shrink-0">
          <button
            onClick={toggleFullscreen}
            className="w-11 h-11 rounded-lg overflow-hidden flex-shrink-0 hover:opacity-80 transition-opacity"
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

          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground line-clamp-1 hover:text-primary cursor-pointer transition-colors"
              onClick={toggleFullscreen}>
              {currentSong.title}
            </p>
            <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
              {currentSong.artist}{currentSong.album ? ` - ${currentSong.album}` : ''}
            </p>
          </div>
        </div>

        {/* ===== 中：播放控制（hover 时出现）===== */}
        <div className="flex-1 flex items-center justify-center">
          <div className="flex items-center gap-1 opacity-0 scale-90 group-hover/bar:opacity-100 group-hover/bar:scale-100 transition-all duration-200">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={toggleShuffle}
                  className={cn(
                    'p-1.5 rounded-full transition-colors hover:bg-accent',
                    shuffle ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <Shuffle className="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{shuffle ? '关闭随机' : '随机播放'}</TooltipContent>
            </Tooltip>

            <button
              onClick={handlePrev}
              className="p-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <SkipBack className="w-5 h-5" fill="currentColor" />
            </button>

            <button
              onClick={togglePlay}
              className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 active:scale-95 transition-[background-color,transform] shadow-md mx-1"
            >
              {isPlaying ? (
                <Pause className="w-5 h-5" fill="currentColor" />
              ) : (
                <Play className="w-5 h-5 ml-0.5" fill="currentColor" />
              )}
            </button>

            <button
              onClick={next}
              className="p-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <SkipForward className="w-5 h-5" fill="currentColor" />
            </button>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={cycleRepeatMode}
                  className={cn(
                    'p-1.5 rounded-full transition-colors hover:bg-accent',
                    repeatMode !== 'none' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {repeatMode === 'one' ? (
                    <Repeat1 className="w-4 h-4" />
                  ) : (
                    <Repeat className="w-4 h-4" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {repeatMode === 'none' ? '循环关闭' : repeatMode === 'all' ? '列表循环' : '单曲循环'}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* ===== 右：音量 + 时间 + 功能按钮 ===== */}
        <div className="flex items-center gap-2 w-[320px] flex-shrink-0 justify-end">
          {/* 音量控制 */}
          <div className="flex items-center gap-1.5 w-28">
            <button
              onClick={toggleMute}
              className="p-1 text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
            >
              <VolumeIcon className="w-4 h-4" />
            </button>
            <Slider
              value={[muted ? 0 : volume]}
              max={1}
              step={0.01}
              onValueChange={handleVolumeChange}
              className="flex-1"
            />
          </div>

          {/* 时间显示 */}
          <TimeDisplay />

          {/* 喜欢 */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleToggleStar}
                disabled={toggleStar.isPending}
                className={cn(
                  'p-1.5 rounded-full hover:bg-accent transition-colors',
                  currentSong.starred ? 'text-red-400' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Heart
                  className="w-4 h-4"
                  fill={currentSong.starred ? 'currentColor' : 'none'}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent>{currentSong.starred ? '取消喜欢' : '加入喜欢'}</TooltipContent>
          </Tooltip>

          {/* 歌词 */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={toggleFullscreen}
                className="p-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                <Mic2 className="w-4 h-4" />
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
                  'p-1.5 rounded-full transition-colors hover:bg-accent',
                  isQueueOpen ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <ListMusic className="w-4 h-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>播放队列</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}
