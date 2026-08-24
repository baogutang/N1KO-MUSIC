/**
 * 全屏播放器 — 杂志编辑风（docs/redesign/v2/DESIGN.md §4.3 正在播放页）
 * 纸面底 + 极淡封面取色晕染；左列封面/信息/控制 + 右列歌词流
 *
 * 性能优化：
 * - 细粒度 selector，不订阅 currentTime/duration
 * - 进度条拆成独立 memo 子组件（FSProgressBar 自行订阅）
 * - 歌词组件自行订阅 currentTime，不经过父组件
 * - 仅全屏时由 MainLayout 条件挂载，非全屏零开销
 *   （打开/关闭 fade+translateY 动画由 MainLayout 负责，见 §5）
 */

import { useState, useEffect, useRef, useCallback, memo } from 'react'
import type { KeyboardEvent } from 'react'
import type { Song } from '@/api/types'
import { useNavigate } from 'react-router-dom'
import {
  Play, Pause, SkipBack, SkipForward, Heart,
  Repeat, RepeatOnce, Shuffle, ArrowsDownUp,
  SpeakerHigh, SpeakerX, SpeakerLow,
  CaretDown, DotsThree, Info, Clock, MusicNote, VinylRecord, MicrophoneStage, SteeringWheel, ShareNetwork,
  Queue, FileText
} from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { useT } from '@/i18n'
import { usePlayerStore, type RepeatMode } from '@/store/playerStore'
import { useThemeStore } from '@/store/themeStore'
import { useIsMobileLayout } from '@/lib/platform'
import { seekHowl } from '@/hooks/useAudioEngine'
import { useLyricsQuery, useToggleStar } from '@/hooks/useServerQueries'
import { useCoverUrl } from '@/hooks/useCoverUrl'
import { LyricDisplay } from './LyricDisplay'
import { CoverImage } from '@/components/common/CoverImage'
import { Slider } from '@/components/ui/slider'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { getCachedColors } from '@/utils/colorExtract'
import { toPaperSafe } from '@/utils/paperSafe'
import { formatDuration } from '@/utils/formatters'
import { useSettingsStore } from '@/store/settingsStore'
import { AddToPlaylistDialog } from '@/components/music/AddToPlaylistDialog'
import { ShareDialog } from '@/components/music/ShareDialog'
import { useServerCapabilities } from '@/hooks/useServerCapabilities'

/** macOS 检测：FullscreenPlayer 是 fixed 覆盖层，需要独立处理 traffic-light 区域 */
const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)

/** 细线圆图标键（DESIGN §4.1 图标键）：1px hair 圆，hover 变 accent，:active scale(.95) */
const lineCircleBtn = cn(
  'rounded-full border border-hair text-ink-soft flex items-center justify-center',
  'transition-[color,border-color,transform] duration-200 ease-[var(--ease)]',
  'hover:text-primary hover:border-primary active:scale-95'
)

/** 歌手/专辑文字链接（demo .who a）：发丝下划线，hover 变 accent */
const whoLinkCls = cn(
  'truncate border-b border-hair cursor-pointer',
  'transition-[color,border-color] duration-200 ease-[var(--ease)]',
  'hover:text-primary hover:border-primary'
)

/**
 * 进度行子组件 — 独立订阅 currentTime / duration / buffered
 * 播放中每 200ms 更新一次，只有这个组件重渲染
 * 双层进度条：发丝层=缓冲进度，朱红层=播放进度（demo .playing-progress）
 */
const FSProgressBar = memo(function FSProgressBar() {
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
      document.removeEventListener('pointerup', dragUpRef.current)
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

  // Pointer Events 同时覆盖鼠标与触屏；touch-action:none 防止拖动时页面滚动
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const rect = progressRef.current?.getBoundingClientRect()
    if (!rect) return
    const getR = (cx: number) => Math.max(0, Math.min(1, (cx - rect.left) / rect.width))
    // 按下时只更新本地拖动值，不 seek 音频，避免 timeupdate 与拖动位置互相覆盖
    setDragValue(getR(e.clientX) * safeDurationRef.current)

    const onMove = (me: globalThis.PointerEvent) => {
      // 拖动过程中只更新本地视觉进度，不触发音频 seek
      setDragValue(getR(me.clientX) * safeDurationRef.current)
    }
    const onUp = (me: globalThis.PointerEvent) => {
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
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
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
    <div className="w-full flex items-center gap-3">
      <span className="num text-[11.5px] text-ink-faint flex-none w-9">
        {formatDuration(displayTime)}
      </span>

      {/* 2px 细进度轨，hover 浮现 accent 小圆点 */}
      <div
        ref={progressRef}
        onPointerDown={handlePointerDown}
        onKeyDown={handleKeyDown}
        role="slider"
        tabIndex={0}
        aria-label={t('player.progress')}
        aria-valuemin={0}
        aria-valuemax={Math.round(safeDuration)}
        aria-valuenow={Math.round(displayTime)}
        className="group/track relative flex-1 h-3.5 flex items-center cursor-pointer select-none touch-none"
      >
        <div className="relative w-full h-[2px] bg-hair-soft">
          {/* 缓冲进度层（发丝色）*/}
          <div
            className="absolute left-0 top-0 h-full bg-hair transition-[width] duration-500"
            style={{ width: `${bufferPercent}%` }}
          />
          {/* 播放进度层（朱红 accent）*/}
          <div
            className="absolute left-0 top-0 h-full bg-primary transition-[width] duration-200"
            style={{ width: `${playPercent}%` }}
          />
        </div>
        <div
          className="absolute top-1/2 w-2.5 h-2.5 rounded-full bg-primary -translate-x-1/2 -translate-y-1/2 scale-0 group-hover/track:scale-100 transition-transform duration-150 pointer-events-none"
          style={{ left: `${playPercent}%` }}
        />
      </div>

      <span className="num text-[11.5px] text-ink-faint flex-none w-9 text-right">
        {formatDuration(duration)}
      </span>
    </div>
  )
})

export function FullscreenPlayer() {
  const navigate = useNavigate()
  const { t } = useT()

  // 细粒度 selector：不订阅 currentTime / duration（由子组件处理）
  const currentSong     = usePlayerStore(s => s.currentSong)
  const isPlaying       = usePlayerStore(s => s.isPlaying)
  const streamBuffering = usePlayerStore(s => s.streamBuffering)
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
  const setCarMode = usePlayerStore(s => s.setCarMode)
  const updateCurrentSong = usePlayerStore(s => s.updateCurrentSong)

  const [showVolumePanel, setShowVolumePanel] = useState(false)
  // 这两个对话框都要把「打开那一刻的歌」钉住，而不是一直读 currentSong：
  // 用户填备注、选有效期的这几秒里，上一首可能已经播完自动切走了，
  // 那时按 currentSong 生成的会是下一首的链接，而且悄无声息。
  const [playlistSong, setPlaylistSong] = useState<Song | null>(null)
  const [shareSong, setShareSong] = useState<Song | null>(null)
  const capabilities = useServerCapabilities()
  const isMobile = useIsMobileLayout()
  // 移动端封面 / 歌词 视图切换（桌面双列布局歌词常显，无需切换）
  const [mobileView, setMobileView] = useState<'cover' | 'lyrics'>('cover')

  const resolvedTheme = useThemeStore(s => s.resolvedTheme)
  const isLight = resolvedTheme === 'light'
  const coverShape = useSettingsStore(s => s.coverShape)
  const isCircle = coverShape === 'circle'

  const { primary: coverUrl, fallback: coverFallback } = useCoverUrl(currentSong ?? undefined, { size: 512 })
  const toggleStar = useToggleStar()

  // 封面取色晕染（DESIGN §1.3 唯一允许的渐变）：提取完成后才渲染，null = 尚未取色
  const [bleedColors, setBleedColors] = useState<{ primary: string; secondary: string } | null>(null)
  // 已解析的实际封面 URL（可能来自服务器或自定义 API），由 CoverImage 的 onLoad 回调设置
  const [resolvedCoverUrl, setResolvedCoverUrl] = useState<string | undefined>(undefined)

  // 切歌时重置取色状态：否则旧封面色会闪在新歌上；新歌无封面时旧晕染永久残留
  useEffect(() => {
    setResolvedCoverUrl(undefined)
    setBleedColors(null)
  }, [currentSong?.id])

  useEffect(() => {
    // 优先使用 resolvedCoverUrl（封面加载后触发），没有则用 coverUrl。
    // 并发取消由 colorExtract 内部的 cancelPendingColorExtraction 保证，沿用原行为。
    const url = resolvedCoverUrl || coverUrl
    if (!url) return
    let alive = true
    getCachedColors(url).then(colors => {
      if (!alive) return
      /**
       * 取到的原色不能直接用。一张荧光粉的封面会把整块版面染成粉色，
       * 一张纯黑的会把纸压成灰——那就不是「纸、墨、朱」了。
       * toPaperSafe 只留色相，把饱和度和明度夹进纸的邻域，
       * 于是不管封面多刺眼，落到版面上的都是一层薄晕。
       */
      setBleedColors({
        primary: toPaperSafe(colors.primary, !isLight),
        secondary: toPaperSafe(colors.secondary, !isLight),
      })
    })
    return () => { alive = false }
  }, [resolvedCoverUrl, coverUrl, isLight])

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
      { id: currentSong.id, type: 'song', isStarred: !!currentSong.starred, song: currentSong },
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

  const repeatLabel = repeatMode === 'one'
    ? t('player.repeatOne')
    : repeatMode === 'all' ? t('player.repeatAll') : t('player.repeatOff')

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-paper text-ink">
      {/* 封面取色淡晕染（唯一允许的渐变，DESIGN §1.3：浅色 ≤0.35，深色调低） */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none transition-opacity duration-1000"
        style={{
          // 色本身已经夹进安全带，这里的不透明度可以给得更实，晕染才看得见
          opacity: bleedColors ? (isLight ? 0.55 : 0.4) : 0,
          background: bleedColors
            ? `radial-gradient(55% 60% at 20% 12%, ${bleedColors.primary} 0%, transparent 72%),` +
              ` radial-gradient(45% 50% at 86% 92%, ${bleedColors.secondary} 0%, transparent 75%)`
            : 'none',
        }}
      />

      {/* 顶部栏：左收起 / 中央「正在播放」+ 曲名 / 右更多 — Mac 上多留 padding 避开红黄绿按钮；
          移动端避让状态栏安全区 */}
      <div
        className={cn(
          "flex items-center justify-between px-6 pb-3 flex-shrink-0 relative z-10 border-b border-hair-soft",
          isMac ? "pt-12" : "pt-5"
        )}
        style={isMobile ? { paddingTop: 'max(env(safe-area-inset-top), 12px)' } : undefined}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <button onClick={toggleFullscreen} className={cn(lineCircleBtn, 'w-9 h-9')}>
              <CaretDown size={18} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('player.collapse')}</TooltipContent>
        </Tooltip>

        <div className="text-center min-w-0 px-4">
          <p className="text-[11px] tracking-[0.3em] text-ink-faint">{t('player.nowPlaying')}</p>
          <p className="font-serif text-[13.5px] font-semibold mt-1 truncate max-w-md mx-auto text-ink">
            {currentSong.title}
          </p>
        </div>

        {/* 右上：更多菜单 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className={cn(lineCircleBtn, 'w-9 h-9')}>
              <DotsThree size={20} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <div className="px-3 py-2.5 border-b border-hair-soft">
              <p className="font-serif font-semibold text-sm truncate">{currentSong.title}</p>
              <p className="text-xs text-ink-soft truncate mt-0.5">{currentSong.artist}</p>
            </div>
            {currentSong.artistId && (
              <DropdownMenuItem onClick={handleNavigateArtist} className="gap-2 cursor-pointer">
                <MicrophoneStage size={16} />
                {t('player.viewArtist', { name: currentSong.artist })}
              </DropdownMenuItem>
            )}
            {currentSong.albumId && (
              <DropdownMenuItem onClick={handleNavigateAlbum} className="gap-2 cursor-pointer">
                <VinylRecord size={16} />
                {t('player.viewAlbum', { name: currentSong.album })}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => { toggleFullscreen(); navigate(`/songs/${currentSong.id}`, { state: { song: currentSong } }) }}
              className="gap-2 cursor-pointer"
            >
              <FileText size={16} />
              {t('player.viewSongDetail')}
            </DropdownMenuItem>
            {capabilities.shares && (
              <DropdownMenuItem
                onClick={() => setShareSong(currentSong)}
                className="gap-2 cursor-pointer"
              >
                <ShareNetwork size={16} />
                {t('share.link')}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onClick={() => { toggleFullscreen(); setCarMode(true) }}
              className="gap-2 cursor-pointer"
            >
              <SteeringWheel size={16} />
              {t('player.carMode')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <div className="px-3 py-2 space-y-1.5">
              <p className="text-[11px] tracking-[0.2em] text-ink-faint mb-1.5">{t('player.songInfo')}</p>
              {currentSong.duration > 0 && (
                <div className="flex items-center gap-2 text-xs text-ink-soft">
                  <Clock size={12} className="flex-shrink-0" />
                  <span className="num">{formatDuration(currentSong.duration)}</span>
                </div>
              )}
              {currentSong.bitRate && (
                <div className="flex items-center gap-2 text-xs text-ink-soft">
                  <MusicNote size={12} className="flex-shrink-0" />
                  <span className="num">{currentSong.bitRate} kbps</span>
                  {currentSong.contentType && <span className="text-ink-faint">· {currentSong.contentType.split('/')[1]?.toUpperCase()}</span>}
                </div>
              )}
              {currentSong.year && (
                <div className="flex items-center gap-2 text-xs text-ink-soft">
                  <Info size={12} className="flex-shrink-0" />
                  <span className="num">{t('song.year', { year: currentSong.year })}</span>
                  {currentSong.genre && <span className="text-ink-faint">· {currentSong.genre}</span>}
                </div>
              )}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* 移动端：单列布局（封面 / 歌词 切换视图），避让系统安全区 */}
      {isMobile ? (
        <div
          className="flex flex-1 min-h-0 flex-col px-6 relative z-10"
          style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 12px)' }}
        >
          {/* 封面 / 歌词 切换（沿用 TopNav 的 accent 短划线语言） */}
          <div className="flex items-center justify-center gap-8 flex-none pt-1 pb-2">
            {(['cover', 'lyrics'] as const).map(view => (
              <button
                key={view}
                onClick={() => setMobileView(view)}
                className={cn(
                  'relative py-1.5 text-[13px] font-medium tracking-[0.08em] transition-colors duration-200',
                  mobileView === view
                    ? "text-primary after:absolute after:left-1/2 after:-translate-x-1/2 after:bottom-0 after:w-5 after:h-[2px] after:bg-primary after:content-['']"
                    : 'text-ink-soft'
                )}
              >
                {view === 'cover' ? t('player.tabCover') : t('player.tabLyrics')}
              </button>
            ))}
          </div>

          {mobileView === 'cover' ? (
            <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-5">
              <div
                className={cn(
                  'relative aspect-square w-full max-w-[min(68vw,30vh)] overflow-hidden shadow-float',
                  isCircle ? 'rounded-full animate-spin-vinyl' : 'rounded-md'
                )}
                style={isCircle ? { animationPlayState: isPlaying ? 'running' : 'paused' } : undefined}
              >
                <CoverImage
                  key={currentSong.id}
                  primary={coverUrl}
                  fallback={coverFallback}
                  alt={currentSong.album}
                  className="w-full h-full"
                  eager
                  songId={currentSong.id}
                  customCoverParams={{ type: 'song', title: currentSong.title, artist: currentSong.artist, album: currentSong.album, path: currentSong.path }}
                  onImageResolved={setResolvedCoverUrl}
                />
              </div>

              <div className="w-full text-center">
                <p className="font-serif font-black text-[21px] leading-[1.25] tracking-[-0.01em] text-ink line-clamp-2">
                  {currentSong.title}
                </p>
                <div className="flex items-center justify-center gap-1.5 mt-1.5 text-[13px] tracking-[0.05em] text-ink-soft">
                  {currentSong.artist && (
                    <button
                      onClick={handleNavigateArtist}
                      className={currentSong.artistId ? whoLinkCls : 'truncate cursor-default'}
                    >
                      {currentSong.artist}
                    </button>
                  )}
                  {currentSong.artist && currentSong.album && (
                    <span className="flex-none text-ink-faint">·</span>
                  )}
                  {currentSong.album && (
                    <button
                      onClick={handleNavigateAlbum}
                      className={currentSong.albumId ? whoLinkCls : 'truncate cursor-default'}
                    >
                      {currentSong.album}
                    </button>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => setPlaylistSong(currentSong)}
                  className={cn(lineCircleBtn, 'w-8 h-8')}
                  aria-label={t('action.addToPlaylist')}
                >
                  <Queue size={16} />
                </button>
                <button
                  onClick={handleToggleStar}
                  disabled={toggleStar.isPending}
                  className={cn(
                    lineCircleBtn,
                    'w-8 h-8',
                    currentSong.starred && 'text-primary border-primary'
                  )}
                  aria-label={currentSong.starred ? t('player.unfavorite') : t('player.favorite')}
                >
                  <Heart size={16} weight={currentSong.starred ? 'fill' : 'regular'} />
                </button>
              </div>
            </div>
          ) : (
            <div className="flex-1 min-h-0 flex flex-col">
              {lyrics ? (
                <LyricDisplay
                  lines={lyrics.lines}
                  variant="fullscreen"
                  className="flex-1 min-h-0"
                />
              ) : (
                <div className="flex-1" />
              )}
            </div>
          )}

          <div className="flex-none pt-3 flex flex-col gap-4">
            <FSProgressBar />
            {/* 传输键组：手机有物理音量键，省掉音量按钮避免换行 */}
            <div className="flex items-center justify-center gap-4">
              <button
                onClick={toggleShuffle}
                className={cn(lineCircleBtn, 'w-9 h-9', shuffle && 'text-primary border-primary')}
                aria-label={t('player.shuffle')}
                aria-pressed={shuffle}
              >
                {shuffle ? <Shuffle size={17} /> : <ArrowsDownUp size={17} />}
              </button>
              <button onClick={handlePrev} className={cn(lineCircleBtn, 'w-10 h-10')} aria-label={t('player.previous')}>
                <SkipBack size={20} />
              </button>
              <button
                onClick={togglePlay}
                className={cn(
                  'w-[52px] h-[52px] rounded-full bg-primary text-primary-foreground flex items-center justify-center active:scale-95 transition-transform duration-200',
                  isPlaying && streamBuffering && 'animate-buffering'
                )}
                aria-label={
                  isPlaying && streamBuffering ? t('player.buffering')
                    : isPlaying ? t('player.pause') : t('player.play')
                }
                aria-busy={isPlaying && streamBuffering}
              >
                {isPlaying
                  ? <Pause size={22} weight="fill" />
                  : <Play size={22} weight="fill" className="ml-0.5" />
                }
              </button>
              <button onClick={() => next()} className={cn(lineCircleBtn, 'w-10 h-10')} aria-label={t('player.next')}>
                <SkipForward size={20} />
              </button>
              <button
                onClick={cycleRepeatMode}
                className={cn(lineCircleBtn, 'w-9 h-9', repeatMode !== 'none' && 'text-primary border-primary')}
                aria-label={t('player.repeatWithMode', { mode: repeatLabel })}
                aria-pressed={repeatMode !== 'none'}
              >
                {repeatMode === 'one' ? <RepeatOnce size={17} /> : <Repeat size={17} />}
              </button>
            </div>
          </div>
        </div>
      ) : (
      /* 桌面端：左列封面+信息+控制（max 440px）｜右列歌词流 */
      <div className="flex flex-1 min-h-0 items-center justify-center gap-16 xl:gap-24 px-10 pb-8 relative z-10 w-full max-w-[1360px] mx-auto">
        {/* 左列 */}
        <div className="w-full max-w-[min(440px,52vh)] flex-none flex flex-col gap-6">
          {/* 专辑封面：圆角 6px + 唯一允许的浮层淡投影（DESIGN §1.3 / §4.3） */}
          <div
            className={cn(
              'relative aspect-square w-full overflow-hidden shadow-float',
              isCircle ? 'rounded-full animate-spin-vinyl' : 'rounded-md'
            )}
            style={isCircle ? {
              animationPlayState: isPlaying ? 'running' : 'paused',
            } : undefined}
          >
            <CoverImage
              key={currentSong.id}
              primary={coverUrl}
              fallback={coverFallback}
              alt={currentSong.album}
              className="w-full h-full"
              eager
              songId={currentSong.id}
              customCoverParams={{ type: 'song', title: currentSong.title, artist: currentSong.artist, album: currentSong.album, path: currentSong.path }}
              onImageResolved={setResolvedCoverUrl}
            />
          </div>

          {/* 衬线大曲名 / 歌手·专辑链接 + 喜欢 / 加入歌单 */}
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="font-serif font-black text-[30px] leading-[1.2] tracking-[-0.01em] text-ink line-clamp-2">
                {currentSong.title}
              </p>
              <div className="flex items-center gap-1.5 mt-2 min-w-0 text-[13.5px] tracking-[0.05em] text-ink-soft">
                {currentSong.artist && (
                  <button
                    onClick={handleNavigateArtist}
                    className={currentSong.artistId ? whoLinkCls : 'truncate cursor-default'}
                  >
                    {currentSong.artist}
                  </button>
                )}
                {currentSong.artist && currentSong.album && (
                  <span className="flex-none text-ink-faint">·</span>
                )}
                {currentSong.album && (
                  <button
                    onClick={handleNavigateAlbum}
                    className={currentSong.albumId ? whoLinkCls : 'truncate cursor-default'}
                  >
                    {currentSong.album}
                  </button>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 flex-none pt-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button onClick={() => setPlaylistSong(currentSong)} className={cn(lineCircleBtn, 'w-8 h-8')}>
                    <Queue size={17} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t('action.addToPlaylist')}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={handleToggleStar}
                    disabled={toggleStar.isPending}
                    className={cn(
                      lineCircleBtn,
                      'w-8 h-8',
                      currentSong.starred && 'text-primary border-primary hover:text-primary'
                    )}
                  >
                    <Heart size={17} weight={currentSong.starred ? 'fill' : 'regular'} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{currentSong.starred ? t('player.unfavorite') : t('player.favorite')}</TooltipContent>
              </Tooltip>
            </div>
          </div>

          {/* 进度行 */}
          <FSProgressBar />

          {/* 传输键组：主键实心朱红圆（§4.1 唯一例外），其余细线圆 */}
          <div className="flex items-center justify-center gap-4">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={toggleShuffle}
                  className={cn(
                    lineCircleBtn,
                    'w-9 h-9',
                    shuffle && 'text-primary border-primary hover:text-primary'
                  )}
                  aria-label={t('player.shuffle')}
                  aria-pressed={shuffle}
                >
                  {shuffle ? <Shuffle size={17} /> : <ArrowsDownUp size={17} />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">{shuffle ? t('player.shuffle') : t('player.inOrder')}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                {/* Tooltip 的文字对读屏不可见——它只在悬停时出现，
                    所以每个按钮都要自带 aria-label，否则整排读作「button button button」 */}
                <button onClick={handlePrev} className={cn(lineCircleBtn, 'w-10 h-10')} aria-label={t('player.previous')}>
                  <SkipBack size={20} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">{t('player.previous')}</TooltipContent>
            </Tooltip>

            <button
              onClick={togglePlay}
              className={cn(
                'w-[52px] h-[52px] rounded-full bg-primary text-primary-foreground flex items-center justify-center transition-transform duration-200 ease-[var(--ease)] hover:scale-105 active:scale-95',
                isPlaying && streamBuffering && 'animate-buffering'
              )}
              aria-label={
                isPlaying && streamBuffering ? t('player.buffering')
                  : isPlaying ? t('player.pause') : t('player.play')
              }
              aria-busy={isPlaying && streamBuffering}
            >
              {isPlaying
                ? <Pause size={22} weight="fill" />
                : <Play size={22} weight="fill" className="ml-0.5" />
              }
            </button>

            <Tooltip>
              <TooltipTrigger asChild>
                <button onClick={() => next()} className={cn(lineCircleBtn, 'w-10 h-10')} aria-label={t('player.next')}>
                  <SkipForward size={20} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">{t('player.next')}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={cycleRepeatMode}
                  className={cn(
                    lineCircleBtn,
                    'w-9 h-9',
                    repeatMode !== 'none' && 'text-primary border-primary hover:text-primary'
                  )}
                  aria-label={repeatLabel}
                >
                  {repeatMode === 'one' ? <RepeatOnce size={17} /> : <Repeat size={17} />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">{repeatLabel}</TooltipContent>
            </Tooltip>

            {/* 音量按钮 + 竖向浮层（纸面玻璃 + 淡投影） */}
            <div className="relative">
              {showVolumePanel && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowVolumePanel(false)} />
                  <div className="absolute bottom-12 right-0 z-20 flex flex-col items-center gap-2 glass shadow-float rounded-md px-4 py-5">
                    <span className="num text-xs text-ink-soft">
                      {Math.round((muted ? 0 : volume) * 100)}%
                    </span>
                    <Slider
                      orientation="vertical"
                      value={[muted ? 0 : volume]}
                      max={1}
                      /* 与全局快捷键 ⌘↑/⌘↓ 的 5% 对齐：同一个动作不该有两套手感。
                         0.01 意味着焦点落在滑轨上时要按 100 下才能从静音到满格。 */
                      step={0.05}
                      onValueChange={([v]) => {
                        // setVolume 内部已将 muted 置为 false，这里不能再 toggleMute（会重新静音）
                        setVolume(v)
                      }}
                      className="h-32"
                      aria-label={t('player.volume')}
                    />
                    <button
                      onClick={toggleMute}
                      className="text-ink-soft hover:text-ink transition-colors active:scale-95"
                    >
                      <VolumeIcon size={16} />
                    </button>
                  </div>
                </>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setShowVolumePanel(v => !v)}
                    className={cn(
                      lineCircleBtn,
                      'w-9 h-9',
                      showVolumePanel && 'text-ink border-ink hover:text-ink hover:border-ink'
                    )}
                  >
                    <VolumeIcon size={17} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {t('player.volume')} <span className="num">{Math.round((muted ? 0 : volume) * 100)}%</span>
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>

        {/* 右列：歌词流（上下 22% 渐隐由 LyricDisplay 处理） */}
        <div className="hidden md:flex flex-1 max-w-xl self-stretch min-h-0 flex-col">
          <p className="flex items-center gap-3.5 flex-none pb-2 text-[11px] tracking-[0.34em] text-ink-faint select-none">
            <span className="whitespace-nowrap">{t('player.lyricsHeading')}</span>
            <span className="flex-1 h-px bg-hair-soft" />
          </p>
          {lyrics ? (
            <LyricDisplay
              lines={lyrics.lines}
              variant="fullscreen"
              className="flex-1 min-h-0"
            />
          ) : (
            // 歌词查询未返回前保持空列，避免布局跳动
            <div className="flex-1" />
          )}
        </div>
      </div>
      )}

      <ShareDialog
        open={shareSong !== null}
        onOpenChange={open => { if (!open) setShareSong(null) }}
        target={shareSong ? { ids: [shareSong.id], label: shareSong.title, kind: 'song' } : null}
      />

      <AddToPlaylistDialog
        open={playlistSong !== null}
        onOpenChange={open => { if (!open) setPlaylistSong(null) }}
        songs={playlistSong ? [playlistSong] : []}
      />
    </div>
  )
}
