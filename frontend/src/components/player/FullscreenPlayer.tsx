/**
 * 全屏播放器 — 现代 Hi-Fi 设计（见 DESIGN.md §4 全屏播放页）
 * 封面自适应氛围背景 + 左列封面/控制 + 右列歌词流
 *
 * 性能优化：
 * - 细粒度 selector，不订阅 currentTime/duration
 * - 进度条 / 时间显示拆成独立 memo 子组件
 * - 歌词组件自行订阅 currentTime，不经过父组件
 * - 仅全屏时由 MainLayout 条件挂载，非全屏零开销
 */

import { useState, useEffect, useRef, useCallback, memo } from 'react'
import type { MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Play, Pause, SkipBack, SkipForward, Heart,
  Repeat, RepeatOnce, Shuffle, ArrowsDownUp,
  SpeakerHigh, SpeakerX, SpeakerLow,
  CaretDown, DotsThree, Info, Clock, MusicNote, VinylRecord, MicrophoneStage,
  Queue, FileText
} from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { usePlayerStore, type RepeatMode } from '@/store/playerStore'
import { useThemeStore } from '@/store/themeStore'
import { seekHowl } from '@/hooks/useAudioEngine'
import { useLyricsQuery, useToggleStar } from '@/hooks/useServerQueries'
import { useCoverUrl } from '@/hooks/useCoverUrl'
import { LyricDisplay } from './LyricDisplay'
import { CoverImage } from '@/components/common/CoverImage'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { getCachedColors } from '@/utils/colorExtract'
import { formatDuration } from '@/utils/formatters'
import { useSettingsStore } from '@/store/settingsStore'
import { AddToPlaylistDialog } from '@/components/music/AddToPlaylistDialog'

/** macOS 检测：FullscreenPlayer 是 fixed 覆盖层，需要独立处理 traffic-light 区域 */
const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)

/**
 * 进度行子组件 — 独立订阅 currentTime / duration / buffered
 * 播放中每 200ms 更新一次，只有这个组件重渲染
 * 使用自定义双层进度条：浅色层=缓冲进度，深色层=播放进度
 */
const FSProgressBar = memo(function FSProgressBar({ isLight }: { isLight: boolean }) {
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
      // 拖动过程中只更新本地视觉进度，不触发音频 seek
      setDragValue(getR(me.clientX) * safeDurationRef.current)
    }
    const onUp = (me: globalThis.MouseEvent) => {
      // 松开时才实际 seek 音频
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
    <div className="w-full flex items-center gap-2.5">
      <span className={cn(
        'font-num text-[11px] flex-none w-9',
        isLight ? 'text-black/40' : 'text-white/40'
      )}>
        {formatDuration(displayTime)}
      </span>

      {/* 3px 细进度轨，hover 浮现 thumb */}
      <div
        ref={progressRef}
        onMouseDown={handleMouseDown}
        className="group/track relative flex-1 h-3.5 flex items-center cursor-pointer select-none"
      >
        <div
          className="relative w-full h-[3px] rounded-full overflow-hidden"
          style={{ backgroundColor: isLight ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.15)' }}
        >
          {/* 缓冲进度层（浅色）*/}
          <div
            className="absolute left-0 top-0 h-full rounded-full transition-[width] duration-500"
            style={{
              width: `${bufferPercent}%`,
              backgroundColor: isLight ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.25)',
            }}
          />
          {/* 播放进度层（跟随强调色）*/}
          <div
            className="absolute left-0 top-0 h-full rounded-full bg-primary transition-[width] duration-200"
            style={{ width: `${playPercent}%` }}
          />
        </div>
        <div
          className={cn(
            'absolute top-1/2 w-2.5 h-2.5 rounded-full shadow-md -translate-x-1/2 -translate-y-1/2 scale-0 group-hover/track:scale-100 transition-transform duration-150 pointer-events-none',
            isLight ? 'bg-black/70' : 'bg-white'
          )}
          style={{ left: `${playPercent}%` }}
        />
      </div>

      <span className={cn(
        'font-num text-[11px] flex-none w-9 text-right',
        isLight ? 'text-black/40' : 'text-white/40'
      )}>
        {formatDuration(duration)}
      </span>
    </div>
  )
})

export function FullscreenPlayer() {
  const navigate = useNavigate()

  // 细粒度 selector：不订阅 currentTime / duration（由子组件处理）
  const currentSong     = usePlayerStore(s => s.currentSong)
  const isPlaying       = usePlayerStore(s => s.isPlaying)
  const volume          = usePlayerStore(s => s.volume)
  const muted           = usePlayerStore(s => s.muted)
  const repeatMode      = usePlayerStore(s => s.repeatMode)
  const shuffle         = usePlayerStore(s => s.shuffle)
  const togglePlay      = usePlayerStore(s => s.togglePlay)
  const next            = usePlayerStore(s => s.next)
  const setVolume       = usePlayerStore(s => s.setVolume)
  const toggleMute      = usePlayerStore(s => s.toggleMute)
  const setRepeatMode   = usePlayerStore(s => s.setRepeatMode)
  const toggleShuffle   = usePlayerStore(s => s.toggleShuffle)
  const toggleFullscreen = usePlayerStore(s => s.toggleFullscreen)
  const updateCurrentSong = usePlayerStore(s => s.updateCurrentSong)

  const [bgColors, setBgColors] = useState({ primary: 'hsl(0, 0%, 5%)', secondary: 'hsl(0, 0%, 10%)' })
  const [coverLoaded, setCoverLoaded] = useState(false)
  const [showVolumePanel, setShowVolumePanel] = useState(false)
  const [playlistDialogOpen, setPlaylistDialogOpen] = useState(false)
  const volumeBtnRef = useRef<HTMLButtonElement>(null)

  const resolvedTheme = useThemeStore(s => s.resolvedTheme)
  const isLight = resolvedTheme === 'light'
  const coverShape = useSettingsStore(s => s.coverShape)
  const isCircle = coverShape === 'circle'

  const { primary: coverUrl, fallback: coverFallback } = useCoverUrl(currentSong ?? undefined, { size: 512 })
  const toggleStar = useToggleStar()

  // 已解析的实际封面 URL（可能来自服务器或自定义 API）
  const [resolvedCoverUrl, setResolvedCoverUrl] = useState<string | undefined>(undefined)

  // 封面加载完成后才提取颜色，避免与封面请求竞争 HTTP 连接。
  // resolvedCoverUrl 由 CoverImage 的 onLoad 回调设置，此时封面已加载完成。
  useEffect(() => { setCoverLoaded(false) }, [coverUrl])

  useEffect(() => {
    // 优先使用 resolvedCoverUrl（封面加载后触发），没有则用 coverUrl
    const url = resolvedCoverUrl || coverUrl
    if (!url) return
    getCachedColors(url).then(colors => {
      setBgColors({ primary: colors.primary, secondary: colors.secondary })
    })
  }, [resolvedCoverUrl, coverUrl])

  const { data: lyrics } = useLyricsQuery(
    currentSong?.id ?? '',
    currentSong?.title,
    currentSong?.artist,
    currentSong?.album,
    currentSong?.path,
    currentSong?.duration,
    !!currentSong  // 组件已由 MainLayout 条件挂载，无需检查 isFullscreen
  )

  const cycleRepeatMode = () => {
    const modes: RepeatMode[] = ['none', 'all', 'one']
    const idx = modes.indexOf(repeatMode)
    setRepeatMode(modes[(idx + 1) % modes.length])
  }

  /** 上一首：播放超过 3 秒重播当前歌曲，否则切到上一首 */
  const handlePrev = useCallback(() => {
    const state = usePlayerStore.getState()
    if (state.currentTime > 3) {
      seekHowl(0)
    } else {
      state.prev()
    }
  }, [])

  const VolumeIcon = muted || volume === 0 ? SpeakerX : volume < 0.5 ? SpeakerLow : SpeakerHigh

  const handleToggleStar = () => {
    if (!currentSong) return
    toggleStar.mutate(
      { id: currentSong.id, type: 'song', isStarred: !!currentSong.starred },
      { onSuccess: () => updateCurrentSong({ starred: !currentSong.starred }) }
    )
  }

  const handleNavigateArtist = () => {
    if (!currentSong?.artistId) return
    toggleFullscreen()
    navigate(`/artists/${currentSong.artistId}`)
  }

  const handleNavigateAlbum = () => {
    if (!currentSong?.albumId) return
    toggleFullscreen()
    navigate(`/albums/${currentSong.albumId}`)
  }

  if (!currentSong) return null

  const repeatLabel = repeatMode === 'one' ? '单曲循环' : repeatMode === 'all' ? '列表循环' : '不循环'

  /** 覆盖层图标按钮（背景为封面提色，不走主题 token）*/
  const overlayIconBtn = cn(
    'w-9 h-9 rounded-md flex items-center justify-center transition-colors active:scale-[0.94]',
    isLight
      ? 'text-black/50 hover:text-black hover:bg-black/10'
      : 'text-white/60 hover:text-white hover:bg-white/10'
  )

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{
        background: isLight
          ? `linear-gradient(160deg, ${bgColors.primary} 0%, ${bgColors.secondary} 50%, hsl(0, 0%, 95%) 100%)`
          : `linear-gradient(160deg, ${bgColors.primary} 0%, ${bgColors.secondary} 50%, hsl(0, 0%, 3%) 100%)`,
      }}
    >
      {/* 封面图模糊背景层 */}
      {(coverUrl || resolvedCoverUrl) && (
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <img
            src={resolvedCoverUrl || coverUrl}
            alt=""
            className="absolute w-full h-full object-cover transition-opacity duration-1000"
            style={{ filter: 'blur(80px) saturate(1.4)', opacity: coverLoaded ? (isLight ? 0.25 : 0.18) : 0, transform: 'scale(1.2)' }}
            onLoad={() => setCoverLoaded(true)}
            data-no-abort="true"
          />
          <div className="absolute inset-0" style={{
            background: isLight
              ? 'linear-gradient(to bottom, rgba(255,255,255,0.3) 0%, rgba(255,255,255,0.5) 60%, rgba(255,255,255,0.75) 100%)'
              : 'linear-gradient(to bottom, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.6) 60%, rgba(0,0,0,0.85) 100%)'
          }} />
        </div>
      )}

      {/* 顶部栏：左收起 / 中央「正在播放」+ 歌名 / 右更多 — Mac 上多留 padding 避开红黄绿按钮 */}
      <div className={cn(
        "flex items-center justify-between px-6 pb-2 flex-shrink-0 relative z-10",
        isMac ? "pt-12" : "pt-5"
      )}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button onClick={toggleFullscreen} className={overlayIconBtn}>
              <CaretDown size={20} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">收起播放器</TooltipContent>
        </Tooltip>

        <div className="text-center min-w-0 px-4">
          <p className={cn('text-[11px] uppercase tracking-[0.16em]', isLight ? 'text-black/40' : 'text-white/50')}>正在播放</p>
          <p className={cn('text-[13px] font-semibold mt-0.5 truncate max-w-md mx-auto', isLight ? 'text-black/80' : 'text-white/90')}>
            {currentSong.title}
          </p>
        </div>

        {/* 右上：更多菜单 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className={cn(overlayIconBtn, 'outline-none focus:outline-none focus-visible:outline-none')}>
              <DotsThree size={22} weight="bold" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className={cn(
              'w-60 backdrop-blur-xl',
              isLight
                ? 'bg-white/95 border-black/10 text-black'
                : 'bg-zinc-900/95 border-white/10 text-white'
            )}
          >
            <div className={cn('px-3 py-2.5 border-b', isLight ? 'border-black/10' : 'border-white/10')}>
              <p className="font-semibold text-sm truncate">{currentSong.title}</p>
              <p className={cn('text-xs truncate mt-0.5', isLight ? 'text-black/50' : 'text-white/50')}>{currentSong.artist}</p>
            </div>
            {currentSong.artistId && (
              <DropdownMenuItem onClick={handleNavigateArtist} className="gap-2 cursor-pointer">
                <MicrophoneStage size={16} />
                查看歌手：{currentSong.artist}
              </DropdownMenuItem>
            )}
            {currentSong.albumId && (
              <DropdownMenuItem onClick={handleNavigateAlbum} className="gap-2 cursor-pointer">
                <VinylRecord size={16} />
                查看专辑：{currentSong.album}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator className={isLight ? 'bg-black/10' : 'bg-white/10'} />
            <DropdownMenuItem
              onClick={() => { toggleFullscreen(); navigate(`/songs/${currentSong.id}`, { state: { song: currentSong } }) }}
              className="gap-2 cursor-pointer"
            >
              <FileText size={16} />
              查看歌曲详情
            </DropdownMenuItem>
            <DropdownMenuSeparator className={isLight ? 'bg-black/10' : 'bg-white/10'} />
            <div className="px-3 py-2 space-y-1.5">
              <p className={cn('text-xs uppercase tracking-wider mb-1.5', isLight ? 'text-black/40' : 'text-white/40')}>歌曲信息</p>
              {currentSong.duration > 0 && (
                <div className={cn('flex items-center gap-2 text-xs', isLight ? 'text-black/50' : 'text-white/60')}>
                  <Clock size={12} className="flex-shrink-0" />
                  <span className="font-num">{formatDuration(currentSong.duration)}</span>
                </div>
              )}
              {currentSong.bitRate && (
                <div className={cn('flex items-center gap-2 text-xs', isLight ? 'text-black/50' : 'text-white/60')}>
                  <MusicNote size={12} className="flex-shrink-0" />
                  <span className="font-num">{currentSong.bitRate} kbps</span>
                  {currentSong.contentType && <span className={isLight ? 'text-black/30' : 'text-white/30'}>· {currentSong.contentType.split('/')[1]?.toUpperCase()}</span>}
                </div>
              )}
              {currentSong.year && (
                <div className={cn('flex items-center gap-2 text-xs', isLight ? 'text-black/50' : 'text-white/60')}>
                  <Info size={12} className="flex-shrink-0" />
                  <span className="font-num">{currentSong.year} 年</span>
                  {currentSong.genre && <span className={isLight ? 'text-black/30' : 'text-white/30'}>· {currentSong.genre}</span>}
                </div>
              )}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* 主内容区：左列封面+控制（440px）｜右列歌词流 */}
      <div className="flex flex-1 min-h-0 items-center justify-center gap-16 xl:gap-24 px-10 pb-8 relative z-10 w-full max-w-[1360px] mx-auto">
        {/* 左列 */}
        <div className="w-full max-w-[min(440px,52vh)] flex-none flex flex-col gap-6">
          {/* 专辑封面 + 氛围光晕 */}
          <div className="relative w-full">
            <div
              aria-hidden="true"
              className="absolute inset-[6%] rounded-[40%] blur-[70px] opacity-40 pointer-events-none"
              style={{ background: bgColors.primary }}
            />
            <div
              className={cn(
                'relative aspect-square overflow-hidden shadow-2xl w-full',
                isCircle
                  ? 'rounded-full animate-spin-vinyl'
                  : cn(
                      'rounded-lg ring-1 transition-[transform,box-shadow] duration-500',
                      isLight ? 'ring-black/10' : 'ring-white/10',
                      isPlaying ? 'scale-100 shadow-[0_20px_60px_rgba(0,0,0,0.7)]' : 'scale-95'
                    )
              )}
              style={isCircle ? {
                animationPlayState: isPlaying ? 'running' : 'paused',
                boxShadow: isPlaying ? '0 20px 60px rgba(0,0,0,0.7)' : '0 6px 24px rgba(0,0,0,0.4)',
              } : undefined}
            >
              <CoverImage
                key={currentSong.id}
                primary={coverUrl}
                fallback={coverFallback}
                alt={currentSong.album}
                className="w-full h-full"
                eager
                customCoverParams={{ type: 'song', title: currentSong.title, artist: currentSong.artist, album: currentSong.album, path: currentSong.path }}
                onImageResolved={setResolvedCoverUrl}
              />
            </div>
          </div>

          {/* 歌名 / 歌手 + 爱心 / 加入歌单 */}
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className={cn(
                'text-[19px] font-bold tracking-tight truncate',
                isLight ? 'text-black/85' : 'text-white/95'
              )}>
                {currentSong.title}
              </p>
              <div className="flex items-center gap-1 mt-0.5 min-w-0 text-[13.5px]">
                {currentSong.artist && (
                  <button
                    onClick={handleNavigateArtist}
                    className={cn(
                      'truncate transition-colors',
                      isLight ? 'text-black/50 hover:text-black' : 'text-white/60 hover:text-white',
                      currentSong.artistId ? 'cursor-pointer hover:underline' : 'cursor-default'
                    )}
                  >
                    {currentSong.artist}
                  </button>
                )}
                {currentSong.artist && currentSong.album && (
                  <span className={cn('flex-none', isLight ? 'text-black/30' : 'text-white/30')}>·</span>
                )}
                {currentSong.album && (
                  <button
                    onClick={handleNavigateAlbum}
                    className={cn(
                      'truncate transition-colors',
                      isLight ? 'text-black/40 hover:text-black/70' : 'text-white/40 hover:text-white/70',
                      currentSong.albumId ? 'cursor-pointer hover:underline' : 'cursor-default'
                    )}
                  >
                    {currentSong.album}
                  </button>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1 flex-none">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button onClick={() => setPlaylistDialogOpen(true)} className={overlayIconBtn}>
                    <Queue size={20} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">添加到歌单</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={handleToggleStar}
                    disabled={toggleStar.isPending}
                    className={cn(
                      overlayIconBtn,
                      currentSong.starred && 'text-primary hover:text-primary'
                    )}
                  >
                    <Heart size={20} weight={currentSong.starred ? 'fill' : 'regular'} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{currentSong.starred ? '取消喜欢' : '加入喜欢'}</TooltipContent>
              </Tooltip>
            </div>
          </div>

          {/* 进度行 */}
          <FSProgressBar isLight={isLight} />

          {/* 大传输键 */}
          <div className="flex items-center justify-center gap-5">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={toggleShuffle}
                  className={cn(
                    'w-10 h-10 rounded-full flex items-center justify-center transition-colors active:scale-[0.94]',
                    shuffle
                      ? 'text-primary bg-primary/10'
                      : isLight
                        ? 'text-black/35 hover:text-black hover:bg-black/10'
                        : 'text-white/40 hover:text-white hover:bg-white/10'
                  )}
                >
                  {shuffle ? <Shuffle size={21} /> : <ArrowsDownUp size={21} />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">{shuffle ? '随机播放' : '顺序播放'}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button onClick={handlePrev} className={cn(
                  'w-11 h-11 rounded-full flex items-center justify-center transition-colors active:scale-[0.94]',
                  isLight
                    ? 'text-black/60 hover:text-black hover:bg-black/10'
                    : 'text-white/70 hover:text-white hover:bg-white/10'
                )}>
                  <SkipBack size={26} weight="fill" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">上一首</TooltipContent>
            </Tooltip>

            <button
              onClick={togglePlay}
              className="w-[52px] h-[52px] rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:brightness-110 hover:scale-105 active:scale-[0.96] transition-[transform,filter] shadow-xl"
            >
              {isPlaying
                ? <Pause size={24} weight="fill" />
                : <Play size={24} weight="fill" className="ml-0.5" />
              }
            </button>

            <Tooltip>
              <TooltipTrigger asChild>
                <button onClick={next} className={cn(
                  'w-11 h-11 rounded-full flex items-center justify-center transition-colors active:scale-[0.94]',
                  isLight
                    ? 'text-black/60 hover:text-black hover:bg-black/10'
                    : 'text-white/70 hover:text-white hover:bg-white/10'
                )}>
                  <SkipForward size={26} weight="fill" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">下一首</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={cycleRepeatMode}
                  className={cn(
                    'w-10 h-10 rounded-full flex items-center justify-center transition-colors active:scale-[0.94]',
                    repeatMode !== 'none'
                      ? 'text-primary bg-primary/10'
                      : isLight
                        ? 'text-black/35 hover:text-black hover:bg-black/10'
                        : 'text-white/40 hover:text-white hover:bg-white/10'
                  )}
                >
                  {repeatMode === 'one' ? <RepeatOnce size={21} /> : <Repeat size={21} />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">{repeatLabel}</TooltipContent>
            </Tooltip>

            {/* 音量按钮 + 竖向浮层 */}
            <div className="relative">
              {showVolumePanel && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowVolumePanel(false)} />
                  <div className={cn(
                    'absolute bottom-12 right-0 z-20 flex flex-col items-center gap-2 backdrop-blur-xl rounded-lg px-4 py-5 shadow-2xl border',
                    isLight
                      ? 'bg-white/80 border-black/10'
                      : 'bg-black/75 border-white/10'
                  )}>
                    <span className={cn(
                      'font-num text-xs font-medium',
                      isLight ? 'text-black/50' : 'text-white/60'
                    )}>
                      {Math.round((muted ? 0 : volume) * 100)}%
                    </span>
                    <div className="relative h-32 flex items-center justify-center w-6">
                      <div className="absolute inset-x-0 top-0 bottom-0 flex items-center justify-center">
                        <div className={cn('w-1.5 h-full rounded-full', isLight ? 'bg-black/10' : 'bg-white/15')} />
                      </div>
                      <div
                        className="absolute bottom-0 inset-x-0 flex items-end justify-center"
                        style={{ height: `${(muted ? 0 : volume) * 100}%` }}
                      >
                        <div className={cn('w-1.5 rounded-full', isLight ? 'bg-black/70' : 'bg-white')} style={{ height: '100%' }} />
                      </div>
                      <input
                        type="range" min={0} max={1} step={0.01}
                        value={muted ? 0 : volume}
                        onChange={e => {
                          // setVolume 内部已将 muted 置为 false，这里不能再 toggleMute（会重新静音）
                          setVolume(Number(e.target.value))
                        }}
                        className="absolute inset-0 opacity-0 cursor-pointer"
                        style={{ writingMode: 'vertical-lr', direction: 'rtl', width: '100%', height: '100%' }}
                      />
                      <div
                        className={cn('absolute w-4 h-4 rounded-full shadow-lg pointer-events-none', isLight ? 'bg-black/70' : 'bg-white')}
                        style={{ bottom: `calc(${(muted ? 0 : volume) * 100}% - 8px)` }}
                      />
                    </div>
                    <button onClick={toggleMute} className={cn(
                      'transition-colors active:scale-[0.94]',
                      isLight ? 'text-black/40 hover:text-black' : 'text-white/50 hover:text-white'
                    )}>
                      <VolumeIcon size={16} />
                    </button>
                  </div>
                </>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    ref={volumeBtnRef}
                    onClick={() => setShowVolumePanel(v => !v)}
                    className={cn(
                      'w-10 h-10 rounded-full flex items-center justify-center transition-colors active:scale-[0.94]',
                      showVolumePanel
                        ? isLight ? 'bg-black/10 text-black' : 'bg-white/15 text-white'
                        : isLight
                          ? 'text-black/35 hover:text-black hover:bg-black/10'
                          : 'text-white/40 hover:text-white hover:bg-white/10'
                    )}
                  >
                    <VolumeIcon size={20} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  音量 <span className="font-num">{Math.round((muted ? 0 : volume) * 100)}%</span>
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>

        {/* 右列：歌词流（上下 22% 渐隐由 LyricDisplay 处理）*/}
        {lyrics && lyrics.lines.length > 0 && (
          <div className="hidden md:flex flex-1 max-w-xl self-stretch min-h-0">
            <LyricDisplay
              lines={lyrics.lines}
              variant="fullscreen"
              baseColor={isLight ? 'default' : 'white'}
              className="flex-1"
            />
          </div>
        )}
      </div>

      <AddToPlaylistDialog
        open={playlistDialogOpen}
        onOpenChange={setPlaylistDialogOpen}
        songs={currentSong ? [currentSong] : []}
      />
    </div>
  )
}
