/**
 * 全屏播放器（v5 暖纸）：同一首歌，四种排法，按窗口形状与折叠姿态自动选择。
 *
 *   stack      窄窗口（iPhone、Duo 外屏）：封面 / 歌词 / 接下来 三选一，下面是进度与控制；下拉收起
 *   portrait   竖着的大窗口（Duo 展开竖握、iPad 竖屏、半屏分屏）：上面封面配控制，下面歌词或接下来
 *   landscape  横着的窗口（iPad 横屏、Duo 横握、桌面）：参考特斯拉 App 的平板布局——
 *              左列是你操作的东西（封面、进度、按键），右边一直摆着歌词，落在格纸上
 *   tabletop   Duo 半折悬停（useDevicePosture）：折痕以上是歌词，以下是封面带与控制（参考 QQ 音乐的 Duo 适配）
 *
 * 签名部件：嵌在凹槽里的橡胶播放键（.rubber-key）、歌词底下那张淡淡的格纸（.paper-grid）。
 * 不再做封面取色晕染：暖纸只留两团固定的暖光。
 *
 * 性能：细粒度 selector，不订阅 currentTime；进度条与歌词各自订阅。
 */

import { useState, useEffect, useRef, useCallback, useMemo, memo, useSyncExternalStore } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from 'react'
import type { Song } from '@/api/types'
import { useNavigate } from 'react-router-dom'
import { detailPath } from '@/utils/detailPath'
import {
  Play, Pause, SkipBack, SkipForward, Heart,
  Repeat, RepeatOnce, Shuffle, ArrowsDownUp,
  SpeakerHigh, SpeakerX, SpeakerLow,
  CaretDown, DotsThree, Info, Clock, MusicNote, VinylRecord, MicrophoneStage, SteeringWheel, ShareNetwork, Moon,
  ListPlus, FileText,
} from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { useT } from '@/i18n'
import { usePlayerStore, type RepeatMode } from '@/store/playerStore'
import { useWindowClass, needsTrafficLightInset } from '@/lib/platform'
import { useDevicePosture } from '@/hooks/useDevicePosture'
import { seekHowl } from '@/hooks/useAudioEngine'
import { useLyricsQuery, useToggleStar } from '@/hooks/useServerQueries'
import { useSourceCapabilities } from '@/hooks/useSourceQueries'
import { sourceSupportsFavorites } from '@/services/heartCapability'
import { useCoverUrl } from '@/hooks/useCoverUrl'
import { LyricDisplay } from './LyricDisplay'
import { UpNextList } from './UpNextList'
import { CoverImage } from '@/components/common/CoverImage'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'
import { Slider } from '@/components/ui/slider'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { formatDuration } from '@/utils/formatters'
import { spaceCJK } from '@/utils/cjkTypography'
import { useSettingsStore } from '@/store/settingsStore'
import { useServerStore } from '@/store/serverStore'
import { findAdapterFor } from '@/api'
import { SourceBadge } from '@/components/sources/SourceBadge'
import { AddToPlaylistDialog } from '@/components/music/AddToPlaylistDialog'
import { ShareDialog } from '@/components/music/ShareDialog'
import { PRESETS } from '@/components/player/SleepTimerMenu'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { useServerCapabilities } from '@/hooks/useServerCapabilities'

type Layout = 'stack' | 'portrait' | 'landscape' | 'tabletop'
type PaneView = 'lyrics' | 'queue'

const LANDSCAPE_QUERY = '(orientation: landscape)'
function subscribeOrientation(cb: () => void) {
  const mql = window.matchMedia(LANDSCAPE_QUERY)
  mql.addEventListener('change', cb)
  return () => mql.removeEventListener('change', cb)
}

/** 次要键：圆形，hover 铺一层下沉底，按下时收一点 */
const softBtn =
  'grid flex-none place-items-center rounded-pill text-ink-soft transition-[background-color,color,transform] duration-150 ' +
  'hover:bg-paper-deep hover:text-ink active:scale-95 aria-pressed:text-primary disabled:opacity-50'

/**
 * 进度行：独立订阅 currentTime / duration / buffered，播放中只有它重渲染。
 * 拖动期间只更新本地值，松手才 seek；松手后 500ms 内忽略回传的旧位置。
 */
const FSProgressBar = memo(function FSProgressBar() {
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

  // Pointer Events 同时覆盖鼠标、触控板与触屏；touch-action:none 防止拖动时页面滚动
  const handlePointerDown = useCallback((e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
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

  // 键盘 seek：←/→ ±5s
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
    <div className="flex w-full flex-col gap-1.5">
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
        // 读屏要听到「2:22，共 3:11」，不是裸秒数
        aria-valuetext={t('player.progressAt', {
          current: formatDuration(Math.round(displayTime)),
          total: formatDuration(Math.round(safeDuration)),
        })}
        className="group/track relative flex h-5 w-full cursor-pointer touch-none select-none items-center"
      >
        <div className="relative h-[5px] w-full overflow-hidden rounded-pill bg-paper-3">
          <div
            className="absolute inset-0 origin-left bg-ink-faint/25 transition-transform duration-500"
            style={{ transform: `scaleX(${bufferRatio})` }}
          />
          <div className="absolute inset-0 origin-left bg-primary" style={{ transform: `scaleX(${playRatio})` }} />
        </div>
        <div
          className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-pill bg-sheet shadow-press transition-transform duration-150 [@media(hover:hover)]:scale-75 [@media(hover:hover)]:group-hover/track:scale-100"
          style={{ left: `${playRatio * 100}%` }}
        />
      </div>
      <div className="flex justify-between text-[12.5px] text-ink-faint">
        <span className="num">{formatDuration(displayTime)}</span>
        <span className="num">-{formatDuration(Math.max(0, safeDuration - displayTime))}</span>
      </div>
    </div>
  )
})

export function FullscreenPlayer() {
  const navigate = useNavigate()
  const { t } = useT()

  // 细粒度 selector：不订阅 currentTime / duration（由子组件处理）
  const currentSong = usePlayerStore(s => s.currentSong)
  const multiSource = useServerStore(s => s.connectedServerIds.length > 1)
  const isPlaying = usePlayerStore(s => s.isPlaying)
  const streamBuffering = usePlayerStore(s => s.streamBuffering)
  const volume = usePlayerStore(s => s.volume)
  const muted = usePlayerStore(s => s.muted)
  const repeatMode = usePlayerStore(s => s.repeatMode)
  const shuffle = usePlayerStore(s => s.shuffle)
  const queue = usePlayerStore(s => s.queue)
  const queueIndex = usePlayerStore(s => s.queueIndex)
  const shuffledIndexes = usePlayerStore(s => s.shuffledIndexes)
  const togglePlay = usePlayerStore(s => s.togglePlay)
  const next = usePlayerStore(s => s.next)
  const jumpToIndex = usePlayerStore(s => s.jumpToIndex)
  const setVolume = usePlayerStore(s => s.setVolume)
  const toggleMute = usePlayerStore(s => s.toggleMute)
  const setRepeatMode = usePlayerStore(s => s.setRepeatMode)
  const toggleShuffle = usePlayerStore(s => s.toggleShuffle)
  const toggleFullscreen = usePlayerStore(s => s.toggleFullscreen)
  const setFullscreen = usePlayerStore(s => s.setFullscreen)
  const setQueueOpen = usePlayerStore(s => s.setQueueOpen)
  const setCarMode = usePlayerStore(s => s.setCarMode)
  const updateCurrentSong = usePlayerStore(s => s.updateCurrentSong)

  const [showVolumePanel, setShowVolumePanel] = useState(false)
  // 两个对话框都要把「打开那一刻的歌」钉住：填写的这几秒里上一首可能已经播完切走了
  const [playlistSong, setPlaylistSong] = useState<Song | null>(null)
  const [shareSong, setShareSong] = useState<Song | null>(null)
  const [sleepOpen, setSleepOpen] = useState(false)
  const sleepTimerAt = usePlayerStore(s => s.sleepTimerAt)
  const setSleepTimer = usePlayerStore(s => s.setSleepTimer)
  const capabilities = useServerCapabilities()
  const activeServerId = useServerStore(s => s.activeServerId)

  /* 排法：先看折叠姿态，再看窗口档位与横竖 */
  const wc = useWindowClass()
  const posture = useDevicePosture()
  const landscape = useSyncExternalStore(subscribeOrientation, () => window.matchMedia(LANDSCAPE_QUERY).matches)
  const layout: Layout = posture === 'tabletop' ? 'tabletop' : wc === 'compact' ? 'stack' : landscape ? 'landscape' : 'portrait'

  /**
   * 封面 / 歌词 / 接下来 的选择要留住：浮层关闭 350ms 后就卸载，
   * 偏爱看歌词的人不该每首歌都多点一次。持久化在 settings store。
   */
  const mobileView = useSettingsStore(s => s.playerMobileView)
  const setMobileView = useSettingsStore(s => s.setPlayerMobileView)
  const paneView: PaneView = mobileView === 'queue' ? 'queue' : 'lyrics'

  const coverShape = useSettingsStore(s => s.coverShape)
  const isCircle = coverShape === 'circle'

  const { primary: coverUrl, fallback: coverFallback } = useCoverUrl(currentSong ?? undefined, { size: 640 })
  const toggleStar = useToggleStar()
  const caps = useSourceCapabilities()
  const canFavoriteCurrent = sourceSupportsFavorites(caps, currentSong?.serverId)

  /* 三态（阶段 1.8）：加载中 / 无歌词 / 出错都要有可见说法 */
  const lyricsQuery = useLyricsQuery(
    currentSong?.id ?? '',
    currentSong?.title,
    currentSong?.artist,
    currentSong?.album,
    currentSong?.path,
    currentSong?.duration,
    !!currentSong,
    currentSong?.serverId  // 歌词要向这首歌自己的音源要，不能问主库
  )
  const lyrics = lyricsQuery.data

  /* 播放顺序（开着随机就按随机序）：悬停排法的封面带用 */
  const order = useMemo(() => {
    const identity = queue.map((_, i) => i)
    if (!shuffle || shuffledIndexes.length !== queue.length || new Set(shuffledIndexes).size !== queue.length) return identity
    return shuffledIndexes
  }, [queue, shuffle, shuffledIndexes])

  const cycleRepeatMode = () => {
    const modes: RepeatMode[] = ['none', 'all', 'one']
    setRepeatMode(modes[(modes.indexOf(repeatMode) + 1) % modes.length])
  }

  /** 上一首：播放超过 3 秒重播当前歌曲，否则切到上一首 */
  const handlePrev = useCallback(() => {
    const state = usePlayerStore.getState()
    if (state.currentTime > 3) seekHowl(0)
    else state.prev()
  }, [])

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
    navigate(detailPath('artists', currentSong.artistId, currentSong.serverId))
  }

  const handleNavigateAlbum = () => {
    if (!currentSong?.albumId) return
    toggleFullscreen()
    navigate(detailPath('albums', currentSong.albumId, currentSong.serverId))
  }

  /* 窄窗口：从顶栏或封面往下拖，整页跟手，过 120px 松手就收起 */
  const [dragY, setDragY] = useState(0)
  const dragStart = useRef<{ y: number; id: number } | null>(null)
  const onDragDown = (e: PointerEvent<HTMLElement>) => {
    if (layout !== 'stack' || e.pointerType === 'mouse') return
    dragStart.current = { y: e.clientY, id: e.pointerId }
  }
  const onDragMove = (e: PointerEvent<HTMLElement>) => {
    const s = dragStart.current
    if (!s || s.id !== e.pointerId) return
    setDragY(Math.max(0, e.clientY - s.y))
  }
  const onDragEnd = (e: PointerEvent<HTMLElement>) => {
    const s = dragStart.current
    dragStart.current = null
    if (!s || s.id !== e.pointerId) return
    if (e.clientY - s.y > 120) setFullscreen(false)
    setDragY(0)
  }
  const dragHandlers = { onPointerDown: onDragDown, onPointerMove: onDragMove, onPointerUp: onDragEnd, onPointerCancel: onDragEnd }

  /* 悬停排法的封面带：横滑切歌 */
  const carouselStart = useRef<{ x: number; id: number } | null>(null)

  if (!currentSong) return null

  const repeatLabel = repeatMode === 'one'
    ? t('player.repeatOne')
    : repeatMode === 'all' ? t('player.repeatAll') : t('player.repeatOff')
  const playLabel = t(isPlaying && streamBuffering ? 'player.buffering' : isPlaying ? 'player.pause' : 'player.play')
  const VolumeIcon = muted || volume === 0 ? SpeakerX : volume < 0.5 ? SpeakerLow : SpeakerHigh
  const fileType = currentSong.contentType?.split('/')[1]?.toUpperCase()

  /* ---------- 共用的几块 ---------- */

  const cover = (className: string, style?: CSSProperties) => (
    <div
      className={cn(
        'cover-slab relative aspect-square flex-none overflow-hidden',
        isCircle ? 'rounded-full animate-spin-vinyl' : 'rounded-lg',
        className
      )}
      style={{ ...style, ...(isCircle ? { animationPlayState: isPlaying ? 'running' : 'paused' } : null) }}
    >
      <CoverImage
        key={currentSong.id}
        primary={coverUrl}
        fallback={coverFallback}
        alt={currentSong.album}
        className="h-full w-full"
        eager
        songId={currentSong.id}
        customCoverParams={{ type: 'song', title: currentSong.title, artist: currentSong.artist, album: currentSong.album, path: currentSong.path }}
      />
    </div>
  )

  const songActions = (
    <div className="flex flex-none items-center gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <button onClick={() => setPlaylistSong(currentSong)} aria-label={t('action.addToPlaylist')} className={cn(softBtn, 'h-10 w-10')}>
            <ListPlus size={20} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t('action.addToPlaylist')}</TooltipContent>
      </Tooltip>
      {canFavoriteCurrent && (
        <button
          onClick={handleToggleStar}
          disabled={toggleStar.isPending}
          aria-label={currentSong.starred ? t('player.unfavorite') : t('player.favorite')}
          aria-pressed={!!currentSong.starred}
          className={cn(softBtn, 'h-10 w-10', currentSong.starred && 'text-sem-fav')}
        >
          <Heart size={21} weight={currentSong.starred ? 'fill' : 'regular'} />
        </button>
      )}
    </div>
  )

  const titleBlock = (size: 'lg' | 'md', centered = false) => (
    <div className={cn('flex items-start gap-3', centered && 'justify-center text-center')}>
      <div className="min-w-0 flex-1">
        <p
          key={currentSong.id}
          className={cn(
            'line-clamp-2 font-display font-semibold tracking-[-0.02em] text-ink animate-page-turn motion-reduce:animate-none',
            size === 'lg' ? 'text-[30px] leading-[1.12]' : 'text-[22px] leading-tight'
          )}
        >
          {spaceCJK(currentSong.title)}
        </p>
        <p className={cn('mt-1.5 flex min-w-0 flex-wrap gap-x-3 text-[15px] text-ink-faint', centered && 'justify-center')}>
          {currentSong.artist && (
            <button
              onClick={handleNavigateArtist}
              className={cn('truncate', currentSong.artistId ? 'hover:text-primary' : 'cursor-default')}
            >
              {spaceCJK(currentSong.artist)}
            </button>
          )}
          {currentSong.album && (
            <button
              onClick={handleNavigateAlbum}
              className={cn('truncate', currentSong.albumId ? 'hover:text-primary' : 'cursor-default')}
            >
              {spaceCJK(currentSong.album)}
            </button>
          )}
        </p>
      </div>
      {!centered && songActions}
    </div>
  )

  const quality = (fileType || currentSong.bitRate) && (
    <p className="flex justify-center gap-3 text-[12.5px] text-ink-faint">
      {fileType && <span>{fileType}</span>}
      {currentSong.bitRate && <span className="num">{currentSong.bitRate} kbps</span>}
    </p>
  )

  const volumeControl = (
    <div className="relative">
      {showVolumePanel && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setShowVolumePanel(false)} />
          <div className="glass absolute bottom-12 right-0 z-20 flex flex-col items-center gap-2 rounded-md px-4 py-5">
            <span className="num text-xs text-ink-soft">{Math.round((muted ? 0 : volume) * 100)}%</span>
            <Slider
              orientation="vertical"
              value={[muted ? 0 : volume]}
              max={1}
              /* 与全局快捷键 ⌘↑/⌘↓ 的 5% 对齐 */
              step={0.05}
              onValueChange={([v]) => setVolume(v)}
              className="h-32"
              aria-label={t('player.volume')}
              aria-valuetext={`${Math.round((muted ? 0 : volume) * 100)}%`}
            />
            <button onClick={toggleMute} aria-label={t('player.mute')} aria-pressed={muted} className={cn(softBtn, 'h-9 w-9')}>
              <VolumeIcon size={16} />
            </button>
          </div>
        </>
      )}
      <button
        onClick={() => setShowVolumePanel(v => !v)}
        aria-label={t('player.volume')}
        aria-expanded={showVolumePanel}
        className={cn(softBtn, 'h-11 w-11')}
      >
        <VolumeIcon size={20} />
      </button>
    </div>
  )

  const transport = (withVolume: boolean) => (
    <div className="mx-auto flex w-full max-w-[440px] items-center justify-between gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <button onClick={toggleShuffle} className={cn(softBtn, 'h-11 w-11')} aria-label={t('player.shuffle')} aria-pressed={shuffle}>
            {shuffle ? <Shuffle size={20} /> : <ArrowsDownUp size={20} />}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">{shuffle ? t('player.shuffle') : t('player.inOrder')}</TooltipContent>
      </Tooltip>
      <button onClick={handlePrev} className={cn(softBtn, 'h-14 w-14 text-ink')} aria-label={t('player.previous')}>
        <SkipBack size={28} weight="fill" />
      </button>
      {/* 签名部件：嵌在凹槽里的橡胶播放键 */}
      <button
        onClick={togglePlay}
        className={cn('rubber-key mx-2 h-[68px] w-[68px]', isPlaying && streamBuffering && 'animate-buffering')}
        aria-label={playLabel}
        aria-busy={isPlaying && streamBuffering}
      >
        {isPlaying ? <Pause size={28} weight="fill" /> : <Play size={28} weight="fill" className="ml-1" />}
      </button>
      <button onClick={() => next()} className={cn(softBtn, 'h-14 w-14 text-ink')} aria-label={t('player.next')}>
        <SkipForward size={28} weight="fill" />
      </button>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={cycleRepeatMode}
            className={cn(softBtn, 'h-11 w-11')}
            aria-label={t('player.repeatWithMode', { mode: repeatLabel })}
            aria-pressed={repeatMode !== 'none'}
          >
            {repeatMode === 'one' ? <RepeatOnce size={20} /> : <Repeat size={20} />}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">{repeatLabel}</TooltipContent>
      </Tooltip>
      {withVolume && volumeControl}
    </div>
  )

  const lyricsSheet = (className?: string) => (
    <div className={cn('paper-grid relative flex min-h-0 flex-col overflow-hidden rounded-lg', className)}>
      {lyrics ? (
        <LyricDisplay lines={lyrics.lines} variant="fullscreen" className="min-h-0 flex-1" />
      ) : (
        <p
          className={cn(
            'grid flex-1 place-items-center px-6 text-center text-[14px]',
            lyricsQuery.isLoading ? 'animate-pulse text-ink-faint' : lyricsQuery.isError ? 'text-ink-soft' : 'text-ink-faint'
          )}
        >
          {lyricsQuery.isLoading ? t('lyrics.loading') : lyricsQuery.isError ? t('lyrics.loadFailed') : t('lyrics.none')}
        </p>
      )}
    </div>
  )

  const viewTabs = (views: Array<'cover' | PaneView>, centered = false) => (
    <div
      role="tablist"
      aria-label={t('player.nowPlaying')}
      className={cn('inline-flex flex-none gap-1 rounded-pill bg-paper-deep p-1', centered ? 'self-center' : 'self-start')}
    >
      {views.map(view => {
        const on = views.includes('cover') ? mobileView === view : paneView === view
        return (
          <button
            key={view}
            role="tab"
            aria-selected={on}
            onClick={() => setMobileView(view)}
            className={cn('seg-option h-9 px-4 text-[13.5px] font-medium text-ink-soft', on && 'is-on')}
          >
            {view === 'cover' ? t('player.tabCover') : view === 'lyrics' ? t('player.tabLyrics') : t('shell.upNext')}
          </button>
        )
      })}
    </div>
  )

  const pane = (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {viewTabs(['lyrics', 'queue'])}
      {paneView === 'queue'
        ? <UpNextList count={40} className="min-h-0 flex-1 overflow-y-auto" onOpenQueue={() => { setFullscreen(false); setQueueOpen(true) }} />
        : lyricsSheet('flex-1')}
    </div>
  )

  const header = (
    <header
      className="relative z-10 flex flex-none items-center gap-2 px-4 pb-2 regular:px-6"
      style={{ paddingTop: needsTrafficLightInset ? 40 : 'calc(env(safe-area-inset-top) + 10px)' }}
      {...dragHandlers}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <button onClick={toggleFullscreen} aria-label={t('player.collapse')} className={cn(softBtn, 'h-11 w-11 bg-sheet shadow-press')}>
            <CaretDown size={20} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t('player.collapse')}</TooltipContent>
      </Tooltip>

      <div className="min-w-0 flex-1 text-center">
        <p className="text-[12.5px] text-ink-faint">{t('player.nowPlaying')}</p>
        {layout !== 'landscape' && (
          <p className="mx-auto inline-flex max-w-md items-center gap-1.5 truncate text-[14px] font-semibold text-ink">
            <span className="truncate">{currentSong.title}</span>
            {multiSource && <SourceBadge serverId={currentSong.serverId} />}
          </p>
        )}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button aria-label={t('action.more')} className={cn(softBtn, 'h-11 w-11 bg-sheet shadow-press')}>
            <DotsThree size={22} weight="bold" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <div className="mb-1 border-b border-hair-soft px-3 py-2.5">
            <p className="truncate text-sm font-semibold">{currentSong.title}</p>
            <p className="mt-0.5 truncate text-xs text-ink-faint">{currentSong.artist}</p>
          </div>
          {currentSong.artistId && (
            <DropdownMenuItem onClick={handleNavigateArtist} className="gap-2">
              <MicrophoneStage size={16} />
              {t('player.viewArtist', { name: currentSong.artist })}
            </DropdownMenuItem>
          )}
          {currentSong.albumId && (
            <DropdownMenuItem onClick={handleNavigateAlbum} className="gap-2">
              <VinylRecord size={16} />
              {t('player.viewAlbum', { name: currentSong.album })}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => { toggleFullscreen(); navigate(detailPath('songs', currentSong.id, currentSong.serverId), { state: { song: currentSong } }) }}
            className="gap-2"
          >
            <FileText size={16} />
            {t('player.viewSongDetail')}
          </DropdownMenuItem>
          {capabilities.shares && currentSong.serverId === activeServerId && (
            <DropdownMenuItem onClick={() => setShareSong(currentSong)} className="gap-2">
              <ShareNetwork size={16} />
              {t('share.link')}
            </DropdownMenuItem>
          )}
          {/* 睡眠定时最常用的场景是「躺着用手机听着睡」：手机上的入口在这里 */}
          <DropdownMenuItem onSelect={e => { e.preventDefault(); setSleepOpen(true) }} className="gap-2">
            <Moon size={16} />
            {t('player.sleepTimer')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => { toggleFullscreen(); setCarMode(true) }} className="gap-2">
            <SteeringWheel size={16} />
            {t('player.carMode')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <div className="space-y-1.5 px-3 py-2">
            <p className="mb-1.5 text-[12.5px] font-medium text-ink-faint">{t('player.songInfo')}</p>
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
                {fileType && <span className="text-ink-faint">{fileType}</span>}
              </div>
            )}
            {currentSong.year && (
              <div className="flex items-center gap-2 text-xs text-ink-soft">
                <Info size={12} className="flex-shrink-0" />
                <span className="num">{t('song.year', { year: currentSong.year })}</span>
                {currentSong.genre && <span className="text-ink-faint">{currentSong.genre}</span>}
              </div>
            )}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  )

  /* ---------- 四种排法 ---------- */

  let body: ReactNode
  if (layout === 'stack') {
    body = (
      <div className="relative z-10 flex min-h-0 flex-1 flex-col gap-3 px-5" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}>
        {viewTabs(['cover', 'lyrics', 'queue'], true)}
        <div className="flex min-h-0 flex-1 flex-col [container-type:size]">
          {mobileView === 'cover' ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-6" {...dragHandlers}>
              {cover('', { width: 'min(100%, 56cqh)' })}
              <div className="w-full">{titleBlock('md')}</div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              <div className="flex items-center gap-3">
                {cover('h-14 w-14 !rounded-md')}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[16px] font-semibold text-ink">{spaceCJK(currentSong.title)}</p>
                  <p className="truncate text-[13.5px] text-ink-faint">{spaceCJK(currentSong.artist)}</p>
                </div>
                {songActions}
              </div>
              {mobileView === 'queue'
                ? <UpNextList count={40} className="min-h-0 flex-1 overflow-y-auto" onOpenQueue={() => { setFullscreen(false); setQueueOpen(true) }} />
                : lyricsSheet('flex-1')}
            </div>
          )}
        </div>
        <div className="flex flex-none flex-col gap-3 pt-1">
          <FSProgressBar />
          {transport(false)}
        </div>
      </div>
    )
  } else if (layout === 'portrait') {
    body = (
      <div
        className="relative z-10 mx-auto grid min-h-0 w-full max-w-[900px] flex-1 grid-rows-[auto_minmax(0,1fr)] gap-7 px-6 regular:px-8"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)' }}
      >
        <div className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] items-center gap-7">
          {cover('w-full')}
          <div className="flex min-w-0 flex-col gap-5">
            {titleBlock('md')}
            <FSProgressBar />
            {quality}
            {transport(false)}
          </div>
        </div>
        {pane}
      </div>
    )
  } else if (layout === 'landscape') {
    body = (
      <div
        className="relative z-10 mx-auto grid min-h-0 w-full max-w-[1440px] flex-1 grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] gap-10 px-8 wide:gap-16 wide:px-14"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 24px)' }}
      >
        <div className="flex min-h-0 flex-col justify-center gap-5 [container-type:size]">
          {cover('mx-auto', { width: 'min(100%, calc(100cqh - 270px))' })}
          {titleBlock('lg')}
          <FSProgressBar />
          {transport(wc === 'wide')}
        </div>
        {pane}
      </div>
    )
  } else {
    /* 悬停：上半是歌词（含顶栏），下半是封面带与控制；两半各占一半，正好对齐折痕 */
    const pos = order.indexOf(queueIndex)
    const slots = [-2, -1, 0, 1, 2].map(k => (pos >= 0 ? order[pos + k] : undefined))
    body = (
      <div className="relative z-10 grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex min-h-0 flex-col">
          {header}
          {lyricsSheet('mx-5 mb-4 flex-1')}
        </div>
        <div className="flex min-h-0 flex-col gap-3 px-5 pt-4" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}>
          <div
            className="grid min-h-0 flex-1 grid-cols-[1fr_1fr_1.9fr_1fr_1fr] items-center gap-3"
            style={{ touchAction: 'pan-y' }}
            onPointerDown={e => { carouselStart.current = { x: e.clientX, id: e.pointerId } }}
            onPointerUp={e => {
              const s = carouselStart.current
              carouselStart.current = null
              if (!s || s.id !== e.pointerId || Math.abs(e.clientX - s.x) < 50) return
              if (e.clientX < s.x) next(); else handlePrev()
            }}
          >
            {slots.map((qi, k) => {
              const song = qi !== undefined ? queue[qi] : undefined
              if (!song) return <span key={k} />
              const url = song.coverArt ? findAdapterFor(song.serverId)?.getCoverUrl(song.coverArt, 320) ?? undefined : undefined
              return (
                <button
                  key={`${song.id}-${qi}`}
                  onClick={() => qi !== undefined && qi !== queueIndex && jumpToIndex(qi)}
                  className={cn(
                    'aspect-square w-full overflow-hidden rounded-md shadow-card transition-[transform,opacity] duration-300',
                    k === 2 ? 'shadow-float' : 'scale-90 opacity-55 hover:opacity-80'
                  )}
                  aria-label={song.title}
                  aria-current={k === 2 ? 'true' : undefined}
                >
                  <ImageWithFallback src={url} alt="" fallbackType="album" className="h-full w-full" />
                </button>
              )
            })}
          </div>
          {titleBlock('md', true)}
          <FSProgressBar />
          {transport(false)}
        </div>
      </div>
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-paper text-ink"
      style={dragY ? { transform: `translateY(${dragY}px)`, transition: 'none' } : undefined}
    >
      {/* 两团固定的暖光：右上陶土、左下赭石（暖纸只允许这两团，不随封面变） */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(42% 38% at 88% 6%, oklch(var(--accent) / 0.09), transparent 70%),' +
            ' radial-gradient(46% 42% at 6% 96%, oklch(var(--accent-2) / 0.08), transparent 72%)',
        }}
      />

      {layout !== 'tabletop' && header}
      {body}

      {/* 睡眠定时的选择面板。播放条上那个是 DropdownMenu，嵌进另一个菜单会打架，所以这里用对话框 */}
      <Dialog open={sleepOpen} onOpenChange={setSleepOpen}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>{t('player.sleepTimer')}</DialogTitle>
            <DialogDescription>{t('player.sleepFadeHint')}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-0.5">
            {PRESETS.map(minutes => (
              <button
                key={minutes}
                onClick={() => { setSleepTimer(minutes); setSleepOpen(false) }}
                className="rounded-sm px-3 py-3 text-left text-[15px] transition-colors hover:bg-paper-deep"
              >
                {t('player.sleepAfterMinutes', { minutes })}
              </button>
            ))}
            <button
              onClick={() => { setSleepTimer(null, 'endOfTrack'); setSleepOpen(false) }}
              className="rounded-sm px-3 py-3 text-left text-[15px] transition-colors hover:bg-paper-deep"
            >
              {t('player.sleepEndOfTrack')}
            </button>
            {sleepTimerAt !== null && (
              <button
                onClick={() => { setSleepTimer(null); setSleepOpen(false) }}
                className="rounded-sm px-3 py-3 text-left text-[15px] font-semibold text-primary transition-colors hover:bg-paper-deep"
              >
                {t('player.sleepCancel')}
              </button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ShareDialog
        open={shareSong !== null}
        onOpenChange={open => { if (!open) setShareSong(null) }}
        target={shareSong ? { ids: [shareSong.id], label: shareSong.title, kind: 'song', serverId: shareSong.serverId } : null}
      />

      <AddToPlaylistDialog
        open={playlistSong !== null}
        onOpenChange={open => { if (!open) setPlaylistSong(null) }}
        songs={playlistSong ? [playlistSong] : []}
      />
    </div>
  )
}
