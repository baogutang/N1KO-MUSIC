/**
 * 全屏播放器 — 参考 Apple Music 风格
 * Apple Music 风格：专辑封面 + 动态渐变背景 + 右侧歌词
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
  Repeat, Repeat1, Shuffle, ArrowUpDown,
  Volume2, VolumeX, Volume1,
  ChevronDown, MoreHorizontal, Info, Clock, Music2, Disc3, Mic2,
  ListMusic, Download, FileText
} from 'lucide-react'
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

/** macOS 检测：FullscreenPlayer 是 fixed 覆盖层，需要独立处理 traffic-light 区域 */
const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)

/**
 * 进度条子组件 — 独立订阅 currentTime / duration / buffered
 * 播放中每 200ms 更新一次，只有这个组件重渲染
 * 使用自定义双层进度条：浅色层=缓冲进度，深色层=播放进度
 */
const FSProgressBar = memo(function FSProgressBar({ isLight }: { isLight: boolean }) {
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
    // 鼠标按下时立即 seek
    seekHowl(getR(e.clientX) * safeDurationRef.current)

    const onMove = (me: globalThis.MouseEvent) => {
      // 拖动过程中只更新视觉进度，不触发音频 seek
      usePlayerStore.getState().seekTo(getR(me.clientX) * safeDurationRef.current)
    }
    const onUp = (me: globalThis.MouseEvent) => {
      // 松开时才实际 seek 音频
      seekHowl(getR(me.clientX) * safeDurationRef.current)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  return (
    <div className="w-full space-y-1.5">
      {/* 自定义双层进度条 */}
      <div
        ref={progressRef}
        className="relative w-full h-1.5 rounded-full cursor-pointer overflow-hidden select-none"
        style={{ backgroundColor: isLight ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.15)' }}
        onMouseDown={handleMouseDown}
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
      <div className={cn(
        'flex justify-between text-xs tabular-nums',
        isLight ? 'text-black/40' : 'text-white/40'
      )}>
        <span>{formatDuration(currentTime)}</span>
        <span>{formatDuration(duration)}</span>
      </div>
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
  const [displayBgColors, setDisplayBgColors] = useState({ primary: 'hsl(0, 0%, 5%)', secondary: 'hsl(0, 0%, 10%)' })
  const [coverLoaded, setCoverLoaded] = useState(false)
  const [showVolumePanel, setShowVolumePanel] = useState(false)
  const volumeBtnRef = useRef<HTMLButtonElement>(null)

  const resolvedTheme = useThemeStore(s => s.resolvedTheme)
  const isLight = resolvedTheme === 'light'
  const coverShape = useSettingsStore(s => s.coverShape)
  const isCircle = coverShape === 'circle'

  const { cached: coverCached, primary: coverUrl, fallback: coverFallback } = useCoverUrl(currentSong ?? undefined, { size: 512 })
  const toggleStar = useToggleStar()

  const debugCover = import.meta.env.DEV
  const switchSeqRef = useRef(0)

  // 已解析的实际封面 URL（用于背景模糊/取色）。不在切歌时立即清空，避免背景闪跳。
  const [resolvedCoverUrl, setResolvedCoverUrl] = useState<string | undefined>(undefined)

  // 切歌时先隐藏模糊背景，等待新封面加载完成再渐显
  useEffect(() => {
    if (debugCover) {
      switchSeqRef.current += 1
      console.debug('[CoverDebug] switch start', {
        seq: switchSeqRef.current,
        songId: currentSong?.id,
        coverUrl,
        coverFallback,
        resolvedCoverUrl,
        coverLoaded,
      })
    } else {
      switchSeqRef.current += 1
    }
    setResolvedCoverUrl(undefined)
    setCoverLoaded(false)
  }, [currentSong?.id]) // coverCached / coverUrl / coverFallback 由外层计算，切歌时读取即可

  useEffect(() => {
    // 只在封面真正加载完成后才取色，避免切歌瞬间用旧 URL 取色导致颜色突跳
    if (!coverLoaded) return
    const url = resolvedCoverUrl || coverCached || coverUrl || coverFallback
    if (!url) return
    getCachedColors(url).then(colors => {
      setBgColors({ primary: colors.primary, secondary: colors.secondary })
    })
    if (debugCover) {
      console.debug('[CoverDebug] blur src choose', { songId: currentSong?.id, url })
    }
  }, [coverLoaded, resolvedCoverUrl, coverCached, coverUrl, coverFallback])

  // bgColors 更新后延一帧再同步到 displayBgColors，让 CSS transition 有时间接手
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      setDisplayBgColors(bgColors)
    })
    return () => cancelAnimationFrame(raf)
  }, [bgColors])

  useEffect(() => {
    if (!debugCover) return
    console.debug('[CoverDebug] coverLoaded change', {
      seq: switchSeqRef.current,
      songId: currentSong?.id,
      coverLoaded,
    })
  }, [coverLoaded, debugCover]) // eslint-disable-line react-hooks/exhaustive-deps

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

  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2

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

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{
        background: isLight
          ? `linear-gradient(160deg, ${displayBgColors.primary} 0%, ${displayBgColors.secondary} 50%, hsl(0, 0%, 95%) 100%)`
          : `linear-gradient(160deg, ${displayBgColors.primary} 0%, ${displayBgColors.secondary} 50%, hsl(0, 0%, 3%) 100%)`,
        transition: 'background 1.2s ease',
      }}
    >
      {/* 封面图模糊背景层 */}
      {(resolvedCoverUrl || coverCached || coverUrl || coverFallback) && (
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {(() => {
            const blurSrc = resolvedCoverUrl || coverCached || coverUrl || coverFallback
            return (
              <img
                src={blurSrc}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
                style={{
                  filter: 'blur(80px) saturate(1.4)',
                  opacity: coverLoaded ? (isLight ? 0.25 : 0.18) : 0,
                  transform: 'scale(1.45)',
                  transformOrigin: 'center center',
                  transition: 'opacity 0.8s ease',
                  willChange: 'opacity',
                }}
                onLoad={() => {
                  if (debugCover) {
                    console.debug('[CoverDebug] blur img onLoad', {
                      seq: switchSeqRef.current,
                      songId: currentSong?.id,
                      src: blurSrc,
                    })
                  }
                  setCoverLoaded(true)
                }}
                onError={() => {
                  if (debugCover) {
                    console.debug('[CoverDebug] blur img onError', {
                      seq: switchSeqRef.current,
                      songId: currentSong?.id,
                      src: blurSrc,
                    })
                  }
                  setCoverLoaded(false)
                }}
              />
            )
          })()}
          <div className="absolute inset-0" style={{
            background: isLight
              ? 'linear-gradient(to bottom, rgba(255,255,255,0.3) 0%, rgba(255,255,255,0.5) 60%, rgba(255,255,255,0.75) 100%)'
              : 'linear-gradient(to bottom, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.6) 60%, rgba(0,0,0,0.85) 100%)'
          }} />
        </div>
      )}

      {/* 顶部栏 — Mac 上多留 padding 避开红黄绿按钮 */}
      <div className={cn(
        "flex items-center justify-between px-6 pb-2 flex-shrink-0 relative z-10",
        isMac ? "pt-12" : "pt-4"
      )}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={toggleFullscreen}
              className={cn(
                'p-2 rounded-full transition-colors',
                isLight
                  ? 'text-black/50 hover:text-black hover:bg-black/10'
                  : 'text-white/60 hover:text-white hover:bg-white/10'
              )}
            >
              <ChevronDown className="w-5 h-5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">收起播放器</TooltipContent>
        </Tooltip>

        <div className="text-center">
          <p className={cn('text-xs uppercase tracking-wider', isLight ? 'text-black/40' : 'text-white/50')}>正在播放</p>
          {/* 歌曲名 */}
          <p className={cn('text-sm font-semibold mt-0.5 truncate max-w-xs', isLight ? 'text-black/80' : 'text-white/90')}>
            {currentSong.title}
          </p>
          {/* 歌手名 */}
          {currentSong.artist && (
            <button
              onClick={handleNavigateArtist}
              className={cn(
                'text-xs mt-0.5 transition-colors',
                isLight ? 'text-black/50 hover:text-black' : 'text-white/60 hover:text-white',
                currentSong.artistId ? 'cursor-pointer hover:underline' : 'cursor-default'
              )}
            >
              {currentSong.artist}
            </button>
          )}
          {/* 专辑名（更小更淡）*/}
          {currentSong.album && (
            <button
              onClick={handleNavigateAlbum}
              className={cn(
                'text-xs mt-0.5 transition-colors block',
                isLight ? 'text-black/30 hover:text-black/60' : 'text-white/40 hover:text-white/70',
                currentSong.albumId ? 'cursor-pointer hover:underline' : 'cursor-default'
              )}
            >
              {currentSong.album}
            </button>
          )}
        </div>

        {/* 右侧占位，保持顶部栏居中 */}
        <div className="w-9" />
      </div>

      {/* 主内容区 */}
      <div className="relative z-10 flex min-h-0 flex-1 gap-12 px-8">
        {/* 左侧：封面 + 操作按钮 */}
        <div className="mx-auto flex min-h-0 max-w-lg flex-1 flex-col items-center justify-center gap-5">
          {/* 专辑封面：不再使用 drop-shadow / box-shadow，避免实图加载后在封面下方出现色块或「脏边」 */}
          <div
            className={cn(
              'w-full max-w-sm lg:max-w-[420px] transition-transform duration-500',
              isPlaying ? 'scale-100' : 'scale-95',
            )}
          >
            <div
              className={cn(
                'aspect-square w-full overflow-hidden',
                isCircle ? 'rounded-full' : 'rounded-2xl [transform:translateZ(0)]',
              )}
              style={isCircle ? {
                animation: 'spin-vinyl 20s linear infinite',
                animationPlayState: isPlaying ? 'running' : 'paused',
              } : undefined}
            >
              <CoverImage
                key={currentSong.id}
                primary={coverCached ?? coverUrl}
                fallback={coverFallback}
                alt={currentSong.album}
                className="w-full h-full"
                eager
                customCoverParams={{ type: 'song', title: currentSong.title, artist: currentSong.artist, album: currentSong.album, path: currentSong.path }}
                onImageResolved={setResolvedCoverUrl}
              />
            </div>
          </div>

          {/* 操作按钮行 */}
          <div className="flex items-center justify-center gap-10 pt-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <button className={cn(
                  'p-2.5 rounded-full transition-colors',
                  isLight ? 'text-black/40 hover:text-black hover:bg-black/10' : 'text-white/50 hover:text-white hover:bg-white/10'
                )}>
                  <ListMusic className="w-[22px] h-[22px]" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">添加到播放列表</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button className={cn(
                  'p-2.5 rounded-full transition-colors',
                  isLight ? 'text-black/40 hover:text-black hover:bg-black/10' : 'text-white/50 hover:text-white hover:bg-white/10'
                )}>
                  <Download className="w-[22px] h-[22px]" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">下载</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleToggleStar}
                  disabled={toggleStar.isPending}
                  className={cn(
                    'p-2.5 rounded-full transition-colors',
                    currentSong.starred
                      ? 'text-red-400'
                      : isLight
                        ? 'text-black/40 hover:text-red-400 hover:bg-black/10'
                        : 'text-white/50 hover:text-red-400 hover:bg-white/10'
                  )}
                >
                  <Heart className="w-[22px] h-[22px]" fill={currentSong.starred ? 'currentColor' : 'none'} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{currentSong.starred ? '取消喜欢' : '加入喜欢'}</TooltipContent>
            </Tooltip>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className={cn(
                  'p-2.5 rounded-full transition-colors outline-none focus:outline-none focus-visible:outline-none',
                  isLight ? 'text-black/40 hover:text-black hover:bg-black/10' : 'text-white/50 hover:text-white hover:bg-white/10'
                )}>
                  <MoreHorizontal className="w-[22px] h-[22px]" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="center"
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
                    <Mic2 className="w-4 h-4" />
                    查看歌手：{currentSong.artist}
                  </DropdownMenuItem>
                )}
                {currentSong.albumId && (
                  <DropdownMenuItem onClick={handleNavigateAlbum} className="gap-2 cursor-pointer">
                    <Disc3 className="w-4 h-4" />
                    查看专辑：{currentSong.album}
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator className={isLight ? 'bg-black/10' : 'bg-white/10'} />
                <DropdownMenuItem
                  onClick={() => { toggleFullscreen(); navigate('/songs/detail', { state: { song: currentSong } }) }}
                  className="gap-2 cursor-pointer"
                >
                  <FileText className="w-4 h-4" />
                  查看歌曲详情
                </DropdownMenuItem>
                <DropdownMenuSeparator className={isLight ? 'bg-black/10' : 'bg-white/10'} />
                <div className="px-3 py-2 space-y-1.5">
                  <p className={cn('text-xs uppercase tracking-wider mb-1.5', isLight ? 'text-black/40' : 'text-white/40')}>歌曲信息</p>
                  {currentSong.duration > 0 && (
                    <div className={cn('flex items-center gap-2 text-xs', isLight ? 'text-black/50' : 'text-white/60')}>
                      <Clock className="w-3 h-3 flex-shrink-0" />
                      <span>{formatDuration(currentSong.duration)}</span>
                    </div>
                  )}
                  {currentSong.bitRate && (
                    <div className={cn('flex items-center gap-2 text-xs', isLight ? 'text-black/50' : 'text-white/60')}>
                      <Music2 className="w-3 h-3 flex-shrink-0" />
                      <span>{currentSong.bitRate} kbps</span>
                      {currentSong.contentType && <span className={isLight ? 'text-black/30' : 'text-white/30'}>· {currentSong.contentType.split('/')[1]?.toUpperCase()}</span>}
                    </div>
                  )}
                  {currentSong.year && (
                    <div className={cn('flex items-center gap-2 text-xs', isLight ? 'text-black/50' : 'text-white/60')}>
                      <Info className="w-3 h-3 flex-shrink-0" />
                      <span>{currentSong.year} 年</span>
                      {currentSong.genre && <span className={isLight ? 'text-black/30' : 'text-white/30'}>· {currentSong.genre}</span>}
                    </div>
                  )}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

        </div>

        {/* 右侧：歌词（显式透明底，避免 WebKit/Tauri 下 overflow 滚动层自带浅色底形成「右下色块」） */}
        <div className="hidden lg:flex min-h-0 flex-1 max-w-md bg-transparent">
          {lyrics && lyrics.lines.length > 0 ? (
            <LyricDisplay
              lines={lyrics.lines}
              variant="fullscreen"
              baseColor="white"
              className="flex-1"
            />
          ) : (
            <div className="min-h-0 flex-1 bg-transparent" />
          )}
        </div>
      </div>

      {/* 底部播放控制栏 */}
      <div className="relative z-10 px-8 pb-6 pt-2 flex-shrink-0">
        <div className="max-w-2xl mx-auto">
          <FSProgressBar isLight={isLight} />
          <div className="flex items-center justify-center gap-5 mt-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={toggleShuffle}
                  className={cn(
                    'p-2 rounded-full transition-colors',
                    shuffle
                      ? 'text-primary bg-primary/10'
                      : isLight
                        ? 'text-black/35 hover:text-black hover:bg-black/10'
                        : 'text-white/40 hover:text-white hover:bg-white/10'
                  )}
                >
                  {shuffle ? <Shuffle className="w-5 h-5" /> : <ArrowUpDown className="w-5 h-5" />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">{shuffle ? '随机播放' : '顺序播放'}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button onClick={handlePrev} className={cn(
                  'transition-colors p-1.5 rounded-full',
                  isLight
                    ? 'text-black/60 hover:text-black hover:bg-black/10'
                    : 'text-white/70 hover:text-white hover:bg-white/10'
                )}>
                  <SkipBack className="w-7 h-7" fill="currentColor" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">上一首</TooltipContent>
            </Tooltip>

            <button
              onClick={togglePlay}
              className={cn(
                'w-14 h-14 rounded-full flex items-center justify-center hover:scale-105 active:scale-95 transition-[transform] shadow-xl',
                isLight ? 'bg-black text-white' : 'bg-white text-black'
              )}
            >
              {isPlaying
                ? <Pause className="w-6 h-6" fill="currentColor" />
                : <Play className="w-6 h-6 ml-0.5" fill="currentColor" />
              }
            </button>

            <Tooltip>
              <TooltipTrigger asChild>
                <button onClick={next} className={cn(
                  'transition-colors p-1.5 rounded-full',
                  isLight
                    ? 'text-black/60 hover:text-black hover:bg-black/10'
                    : 'text-white/70 hover:text-white hover:bg-white/10'
                )}>
                  <SkipForward className="w-7 h-7" fill="currentColor" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">下一首</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={cycleRepeatMode}
                  className={cn(
                    'p-2 rounded-full transition-colors',
                    repeatMode !== 'none'
                      ? 'text-primary bg-primary/10'
                      : isLight
                        ? 'text-black/35 hover:text-black hover:bg-black/10'
                        : 'text-white/40 hover:text-white hover:bg-white/10'
                  )}
                >
                  {repeatMode === 'one' ? <Repeat1 className="w-5 h-5" /> : <Repeat className="w-5 h-5" />}
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
                    'absolute bottom-12 right-0 z-20 flex flex-col items-center gap-2 backdrop-blur-xl rounded-2xl px-4 py-5 shadow-2xl border',
                    isLight
                      ? 'bg-white/80 border-black/10'
                      : 'bg-black/75 border-white/10'
                  )}>
                    <span className={cn(
                      'text-xs tabular-nums font-medium',
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
                          setVolume(Number(e.target.value))
                          if (muted && Number(e.target.value) > 0) toggleMute()
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
                      'transition-colors',
                      isLight ? 'text-black/40 hover:text-black' : 'text-white/50 hover:text-white'
                    )}>
                      <VolumeIcon className="w-4 h-4" />
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
                      'p-2 rounded-full transition-colors',
                      showVolumePanel
                        ? isLight ? 'bg-black/10 text-black' : 'bg-white/15 text-white'
                        : isLight
                          ? 'text-black/35 hover:text-black hover:bg-black/10'
                          : 'text-white/40 hover:text-white hover:bg-white/10'
                    )}
                  >
                    <VolumeIcon className="w-5 h-5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  音量 {Math.round((muted ? 0 : volume) * 100)}%
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
