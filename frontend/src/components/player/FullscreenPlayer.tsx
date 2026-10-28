/**
 * 全屏播放器（v6 舞台光）：灯暗下来，舞台被这首歌点亮。
 *
 * 同一首歌，四种排法，按窗口形状与折叠姿态自动选择：
 *   stack      窄窗口（iPhone、Duo 外屏）：封面 / 歌词 / 接下来 三选一，下面是进度与控制；下拉收起
 *   portrait   竖着的大窗口（Duo 展开竖握、iPad 竖屏、半屏分屏）：上面封面配控制，下面歌词或接下来
 *   landscape  横着的窗口（iPad 横屏、Duo 横握、桌面）：左列是你操作的东西，右边一直摆着歌词
 *   tabletop   Duo 半折悬停（useDevicePosture）：折痕以上是歌词，以下是封面带与控制
 *
 * 舞台：背景是 StageField（封面取色的光场，换歌时新颜色从封面向外漫开），永远是暗场、白字，
 * 与外壳的亮暗主题无关（.stage 在这一层重新声明了中性 token）。
 * 封面区只放正在放的这一张（甩封面切歌）。挑下一首是另一件事：控制区下面那排入口
 * （接下来 / 歌单 / 专辑 / 歌手 / 收藏 / 全部歌曲）打开卡片浏览（CoverBrowser），大封面横着滑、点中间那张就播。
 * 想要唱片感时用设置里的圆形封面（随播放慢慢转），不做拟物的 3D 黑胶。
 * 开合：打开时舞台淡入、封面从迷你条的位置飞过来，其余内容错开升起；收起原路飞回（共享元素，FLIP）。
 * 只动 opacity / transform；光场的 WebGL 等开场落定再点亮，不和动画抢主线程。
 *
 * 性能：细粒度 selector，不订阅 currentTime；进度条与歌词各自订阅。
 */

import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, memo, useSyncExternalStore } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from 'react'
import type { Song } from '@/api/types'
import { useNavigate } from 'react-router-dom'
import { detailPath } from '@/utils/detailPath'
import {
  SkipBack, SkipForward,
  Repeat, RepeatOnce, Shuffle, ArrowsDownUp,
  SpeakerHigh, SpeakerX, SpeakerLow,
  CaretDown, DotsThree, Info, Clock, MusicNote, VinylRecord, MicrophoneStage, SteeringWheel, ShareNetwork, Moon,
  ListPlus, FileText,
} from '@phosphor-icons/react'
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion } from 'motion/react'
import { cn } from '@/lib/utils'
import { useT } from '@/i18n'
import { usePlayerStore, type RepeatMode } from '@/store/playerStore'
import { useWindowClass, needsTrafficLightInset } from '@/lib/platform'
import { haptic } from '@/lib/haptics'
import { EASE_OUT, SPRING_MORPH, SPRING_PRESS, SPRING_SMOOTH, SPRING_SNAPPY, prefersReducedMotion } from '@/lib/motion'
import { markSkip } from '@/lib/skipDirection'
import { notePauseReason } from '@/lib/playbackTrail'
import { useDevicePosture } from '@/hooks/useDevicePosture'
import { seekHowl } from '@/hooks/useAudioEngine'
import { useLyricsQuery, useToggleStar } from '@/hooks/useServerQueries'
import { useSourceCapabilities } from '@/hooks/useSourceQueries'
import { sourceSupportsFavorites } from '@/services/heartCapability'
import { useCoverUrl } from '@/hooks/useCoverUrl'
import { LyricDisplay } from './LyricDisplay'
import { UpNextList } from './UpNextList'
import { StageField } from './StageField'
import { CurrentCover } from './CurrentCover'
import { BrowseEntries, CoverBrowser, type BrowseTab } from './CoverBrowser'
import { browserEscape } from './browserEscape'
import { HeartGlyph, PlayPauseGlyph } from './glyphs'
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
import { formatDuration } from '@/utils/formatters'
import { spaceCJK } from '@/utils/cjkTypography'
import { useSettingsStore } from '@/store/settingsStore'
import { useServerStore } from '@/store/serverStore'
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

/** 舞台上的次要键：白色图标，hover 铺一层白的薄底，按下收一点 */
const softBtnBase =
  'press-pop grid flex-none place-items-center rounded-pill text-ink-2 ' +
  'hover:bg-ink/10 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40'
/** 开关类按下是青柠；收藏按下只是亮白（叶绿 / 青柠只给播放、进度和「当前」） */
const softBtn = `${softBtnBase} aria-pressed:text-leaf`

/** 舞台上的圆形工具键（收起、更多、黑胶）：一枚半透明的玻璃小圆 */
const chipBtn =
  'press-pop grid h-11 w-11 flex-none place-items-center rounded-pill bg-ink/[0.1] text-ink ' +
  'shadow-hair hover:bg-ink/[0.16] aria-pressed:bg-ink/[0.2]'

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
        className="group/track relative flex h-6 w-full cursor-pointer touch-none select-none items-center"
      >
        {/* 按住时轨道加粗：手指底下的东西要看得见 */}
        <div
          className={cn(
            'relative h-[6px] w-full overflow-hidden rounded-pill bg-ink/[0.18] transition-transform duration-3 ease-out group-hover/track:scale-y-[1.35]',
            dragValue !== null && 'scale-y-[1.35]'
          )}
        >
          <div
            className="absolute inset-0 origin-left bg-ink/[0.14] transition-transform duration-500"
            style={{ transform: `scaleX(${bufferRatio})` }}
          />
          <div className="absolute inset-0 origin-left rounded-pill bg-lime" style={{ transform: `scaleX(${playRatio})` }} />
        </div>
        <div
          className={cn(
            'pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-pill bg-stage-ink shadow-md',
            'transition-[scale] duration-3 ease-press [@media(hover:hover)]:scale-[0.6] [@media(hover:hover)]:group-hover/track:scale-100',
            dragValue !== null && '[@media(hover:hover)]:scale-110'
          )}
          style={{ left: `${playRatio * 100}%` }}
        />
      </div>
      <div className="flex justify-between text-[12.5px] font-medium text-ink-3">
        <span className="num">{formatDuration(displayTime)}</span>
        <span className="num">-{formatDuration(Math.max(0, safeDuration - displayTime))}</span>
      </div>
    </div>
  )
})

/** 打开 / 收起的共享元素动画：读迷你条与播放条在屏幕上的位置 */
function anchorRects() {
  const bar = document.querySelector<HTMLElement>('[data-np-bar]')?.getBoundingClientRect()
  const cover = document.querySelector<HTMLElement>('[data-np-anchor]')?.getBoundingClientRect()
  const valid = (r?: DOMRect) => (r && r.width > 1 && r.height > 1 ? r : undefined)
  return { bar: valid(bar), cover: valid(cover) }
}

export function FullscreenPlayer({ onExited }: { onExited?: () => void } = {}) {
  const navigate = useNavigate()
  const { t } = useT()
  const reduceMotion = useReducedMotion()

  // 细粒度 selector：不订阅 currentTime / duration（由子组件处理）
  const currentSong = usePlayerStore(s => s.currentSong)
  const isOpen = usePlayerStore(s => s.isFullscreen)
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
   * 封面 / 歌词 / 接下来 的选择要留住：浮层关闭后就卸载，
   * 偏爱看歌词的人不该每首歌都多点一次。持久化在 settings store。
   */
  const mobileView = useSettingsStore(s => s.playerMobileView)
  const setMobileView = useSettingsStore(s => s.setPlayerMobileView)
  const paneView: PaneView = mobileView === 'queue' ? 'queue' : 'lyrics'

  const coverShape = useSettingsStore(s => s.coverShape)
  const isCircle = coverShape === 'circle'

  const { primary: coverUrl } = useCoverUrl(currentSong ?? undefined, { size: 640 })
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

  /* 播放顺序（开着随机就按随机序）：悬停排法的封面带用它 */
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
    notePauseReason('ui', 'full-screen player')
    togglePlay()
  }, [togglePlay])

  const handleToggleStar = () => {
    if (!currentSong) return
    if (!currentSong.starred) haptic('light')
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

  /* ---------- 开合：舞台淡入，封面从迷你条飞来，其余内容错开升起；收起原路返回 ----------
     只动 opacity / transform，全走合成器。以前舞台用 clip-path 从播放条撑开：WebKit 不合成 clip-path 动画，
     每一帧都把整屏（光场 + 歌词 + 封面）重绘一遍，iPad 上一顿一顿的。
     背景（光场那一层）和内容分开淡：封面在飞行全程都是实的，不会半路才显形。 */
  const rootRef = useRef<HTMLDivElement>(null)
  const bgRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const morphRef = useRef<HTMLDivElement>(null)
  const coverBoxRef = useRef<HTMLDivElement>(null)
  const dragY = useMotionValue(0)
  const closingRef = useRef(false)
  /** 开场落定：之后才点亮光场的 WebGL（建上下文、编译着色器都在主线程上，别撞在动画里） */
  const [settled, setSettled] = useState(false)
  /** 卡片浏览开在哪一栏；null = 没开 */
  const [browse, setBrowse] = useState<BrowseTab | null>(null)
  const closeBrowser = useCallback(() => setBrowse(null), [])
  const openBrowser = useCallback((tab: BrowseTab) => { haptic('selection'); setBrowse(tab) }, [])

  useLayoutEffect(() => {
    const root = rootRef.current
    const bg = bgRef.current
    if (!root || !bg) return
    let alive = true
    const settle = () => { if (alive) setSettled(true) }
    const reveals = Array.from(root.querySelectorAll<HTMLElement>('[data-fs-reveal]'))
    if (prefersReducedMotion()) {
      animate(root, { opacity: [0, 1] }, { duration: 0.2 }).finished.then(settle)
      return () => { alive = false }
    }
    const jobs: Array<Promise<unknown>> = [animate(bg, { opacity: [0, 1] }, { duration: 0.28, ease: EASE_OUT }).finished]
    const { cover } = anchorRects()
    const morph = morphRef.current
    const target = morph?.getBoundingClientRect()
    if (morph && cover && target && target.width > 1) {
      const dx = cover.left + cover.width / 2 - (target.left + target.width / 2)
      const dy = cover.top + cover.height / 2 - (target.top + target.height / 2)
      // 整串 transform 交给浏览器（WAAPI + linear() 弹簧）跑在合成器上：x / y / scale 分开写的话
      // motion 每帧在主线程上拼 transform，播放器刚挂上、主线程正忙的那几帧就会掉
      jobs.push(animate(morph, { transform: [`translate(${dx}px, ${dy}px) scale(${cover.width / target.width})`, 'translate(0px, 0px) scale(1)'] }, SPRING_MORPH).finished)
    } else if (morph) {
      jobs.push(animate(morph, { opacity: [0, 1], transform: ['scale(0.94)', 'scale(1)'] }, SPRING_SMOOTH).finished)
    }
    // 文字和控制等背景先暗下来一点再升起：白字不会先压在浅色的页面上
    reveals.forEach((el, i) => {
      animate(el, { opacity: [0, 1], transform: ['translateY(18px)', 'translateY(0px)'] }, { ...SPRING_SMOOTH, delay: 0.12 + i * 0.035 })
    })
    // 弹簧收尾很长：最多等 900ms 就点亮光场
    const timer = setTimeout(settle, 900)
    Promise.all(jobs).then(settle)
    return () => { alive = false; clearTimeout(timer) }
  }, [])

  useEffect(() => {
    if (isOpen || closingRef.current) return
    closingRef.current = true
    const root = rootRef.current
    const bg = bgRef.current
    if (!root || !bg || prefersReducedMotion()) {
      if (root) animate(root, { opacity: 0 }, { duration: 0.15 }).finished.then(() => onExited?.())
      else onExited?.()
      return
    }
    const reveals = Array.from(root.querySelectorAll<HTMLElement>('[data-fs-reveal]'))
    reveals.forEach(el => animate(el, { opacity: 0 }, { duration: 0.12 }))
    const { cover } = anchorRects()
    const jobs: Array<Promise<unknown>> = []
    const morph = morphRef.current
    const from = morph?.getBoundingClientRect()
    // 正在卡片浏览里直接收起：封面那一层已经淡出了，不飞
    if (morph && cover && from && from.width > 1 && !browse) {
      const dx = cover.left + cover.width / 2 - (from.left + from.width / 2)
      const dy = cover.top + cover.height / 2 - (from.top + from.height / 2)
      jobs.push(animate(morph, { transform: `translate(${dx}px, ${dy}px) scale(${cover.width / from.width})` }, SPRING_MORPH).finished)
      // 落到迷你条上那一下淡掉，由迷你条自己的封面接住
      jobs.push(animate(morph, { opacity: 0 }, { duration: 0.14, delay: 0.28 }).finished)
    } else if (contentRef.current) {
      jobs.push(animate(contentRef.current, { opacity: 0 }, { duration: 0.16 }).finished)
    }
    jobs.push(animate(bg, { opacity: 0 }, { duration: 0.3, delay: 0.06, ease: EASE_OUT }).finished)
    Promise.all(jobs).then(() => onExited?.())
  }, [isOpen, onExited, browse])

  /* 卡片浏览开着的时候，下面那层正在播放不能再被点到、Tab 到 */
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    if (browse) el.setAttribute('inert', '')
    else el.removeAttribute('inert')
  }, [browse])

  /* Esc 先关卡片浏览，再按一次才收起整个播放器（外层 Dialog 在 onEscapeKeyDown 里问这里） */
  useEffect(() => {
    if (!browse) return
    browserEscape.current = () => { setBrowse(null); return true }
    return () => { browserEscape.current = null }
  }, [browse])

  /* 下拉收起：从顶栏或封面往下拖，整页跟手；过 120px 或甩得够快就收起，不够就弹回 */
  const dragStart = useRef<{ y: number; t: number; id: number; axis: 'x' | 'y' | null } | null>(null)
  const onDragDown = (e: PointerEvent<HTMLElement>) => {
    if (e.pointerType === 'mouse' || (layout !== 'stack' && layout !== 'portrait')) return
    dragStart.current = { y: e.clientY, t: performance.now(), id: e.pointerId, axis: null }
  }
  const onDragMove = (e: PointerEvent<HTMLElement>) => {
    const s = dragStart.current
    if (!s || s.id !== e.pointerId) return
    const dy = e.clientY - s.y
    if (!s.axis && Math.abs(dy) > 8) s.axis = 'y'
    if (s.axis !== 'y') return
    dragY.set(dy > 0 ? dy : dy * 0.15)
  }
  const onDragEnd = (e: PointerEvent<HTMLElement>) => {
    const s = dragStart.current
    dragStart.current = null
    if (!s || s.id !== e.pointerId) return
    const dy = e.clientY - s.y
    const v = (dy / Math.max(1, performance.now() - s.t)) * 1000
    if (s.axis === 'y' && (dy > 120 || (dy > 30 && v > 900))) {
      haptic('light')
      setFullscreen(false)
      return
    }
    animate(dragY, 0, SPRING_PRESS)
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

  /** 封面区：只有正在放的这一张（甩封面切歌）。外面那层是共享元素的落点（morphRef）。
   *  后面不再叠接下来的两张：挑下一首去卡片浏览 */
  const coverStage = (className: string, style?: CSSProperties) => (
    <div ref={morphRef} className={cn('relative mx-auto flex-none origin-center', className)} style={style}>
      <CurrentCover
        current={currentSong}
        onNext={() => next()}
        onPrev={handlePrev}
        playing={isPlaying}
        round={isCircle}
        className="w-full"
        boxRef={coverBoxRef}
      />
    </div>
  )

  const songActions = (
    <div className="flex flex-none items-center gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <button onClick={() => setPlaylistSong(currentSong)} aria-label={t('action.addToPlaylist')} className={cn(softBtn, 'h-11 w-11')}>
            <ListPlus size={21} />
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
          className={cn(softBtnBase, 'h-11 w-11 aria-pressed:text-ink')}
        >
          <HeartGlyph on={!!currentSong.starred} size={22} />
        </button>
      )}
    </div>
  )

  const titleBlock = (size: 'xl' | 'lg' | 'md', centered = false) => (
    <div className={cn('flex items-start gap-3', centered && 'justify-center text-center')} data-fs-reveal="">
      <div className="min-w-0 flex-1">
        <motion.p
          key={currentSong.id}
          initial={reduceMotion ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={SPRING_SNAPPY}
          className={cn(
            'line-clamp-2 font-display font-semibold text-ink',
            size === 'xl'
              ? 'text-[40px] leading-[1.06] tracking-[-0.03em]'
              : size === 'lg'
                ? 'text-[32px] leading-[1.1] tracking-[-0.025em]'
                : 'text-[24px] leading-tight tracking-[-0.02em]'
          )}
        >
          {spaceCJK(currentSong.title)}
        </motion.p>
        <p className={cn('mt-2 flex min-w-0 flex-wrap gap-x-3 text-[16px] font-medium text-ink-2', centered && 'justify-center')}>
          {currentSong.artist && (
            <button
              onClick={handleNavigateArtist}
              className={cn('truncate transition-colors duration-2', currentSong.artistId ? 'hover:text-ink' : 'cursor-default')}
            >
              {spaceCJK(currentSong.artist)}
            </button>
          )}
          {currentSong.album && (
            <button
              onClick={handleNavigateAlbum}
              className={cn('truncate transition-colors duration-2', currentSong.albumId ? 'hover:text-ink' : 'cursor-default')}
            >
              {spaceCJK(currentSong.album)}
            </button>
          )}
          {multiSource && <SourceBadge serverId={currentSong.serverId} withName className="self-center" />}
        </p>
      </div>
      {!centered && songActions}
    </div>
  )

  const quality = (fileType || currentSong.bitRate) && (
    <p className="flex justify-center gap-3 text-[12.5px] font-medium text-ink-3" data-fs-reveal="">
      {fileType && <span>{fileType}</span>}
      {currentSong.bitRate && <span className="num">{currentSong.bitRate} kbps</span>}
    </p>
  )

  const volumeControl = (
    <div className="relative">
      {showVolumePanel && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setShowVolumePanel(false)} />
          <div className="glass absolute bottom-14 right-0 z-20 flex flex-col items-center gap-2 rounded-[18px] px-4 py-5 animate-menu-in">
            <span className="num text-xs font-medium text-ink-2">{Math.round((muted ? 0 : volume) * 100)}%</span>
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
        <VolumeIcon size={21} />
      </button>
    </div>
  )

  const transport = (withVolume: boolean) => (
    <div className="mx-auto flex w-full max-w-[460px] items-center justify-between gap-1" data-fs-reveal="">
      <Tooltip>
        <TooltipTrigger asChild>
          <button onClick={toggleShuffle} className={cn(softBtn, 'h-11 w-11')} aria-label={t('player.shuffle')} aria-pressed={shuffle}>
            {shuffle ? <Shuffle size={21} weight="bold" /> : <ArrowsDownUp size={21} />}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">{shuffle ? t('player.shuffle') : t('player.inOrder')}</TooltipContent>
      </Tooltip>
      <button onClick={handlePrev} className={cn(softBtn, 'h-16 w-16 text-ink')} aria-label={t('player.previous')}>
        <SkipBack size={32} weight="fill" />
      </button>
      {/* 签名部件：青柠播放键 */}
      <button
        onClick={handleTogglePlay}
        className={cn('play-key mx-2 h-[78px] w-[78px] shadow-lg', isPlaying && streamBuffering && 'animate-buffering')}
        aria-label={playLabel}
        aria-busy={isPlaying && streamBuffering}
      >
        <PlayPauseGlyph playing={isPlaying} size={32} />
      </button>
      <button onClick={handleNext} className={cn(softBtn, 'h-16 w-16 text-ink')} aria-label={t('player.next')}>
        <SkipForward size={32} weight="fill" />
      </button>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={cycleRepeatMode}
            className={cn(softBtn, 'h-11 w-11')}
            aria-label={t('player.repeatWithMode', { mode: repeatLabel })}
            aria-pressed={repeatMode !== 'none'}
          >
            {repeatMode === 'one' ? <RepeatOnce size={21} weight="bold" /> : <Repeat size={21} weight={repeatMode === 'all' ? 'bold' : 'regular'} />}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">{repeatLabel}</TooltipContent>
      </Tooltip>
      {withVolume && volumeControl}
    </div>
  )

  const lyricsSheet = (className?: string) => (
    <div className={cn('relative flex min-h-0 flex-col overflow-hidden', className)}>
      {lyrics ? (
        <LyricDisplay lines={lyrics.lines} variant="fullscreen" className="min-h-0 flex-1" />
      ) : (
        <p
          className={cn(
            'grid flex-1 place-items-center px-6 text-center text-[15px] font-medium',
            lyricsQuery.isLoading ? 'animate-pulse text-ink-3' : lyricsQuery.isError ? 'text-ink-2' : 'text-ink-3'
          )}
        >
          {lyricsQuery.isLoading ? t('lyrics.loading') : lyricsQuery.isError ? t('lyrics.loadFailed') : t('lyrics.none')}
        </p>
      )}
    </div>
  )

  /** 分段切换：当前项底下那块片在选项之间滑动 */
  const viewTabs = (views: Array<'cover' | PaneView>, group: string, centered = false) => (
    <div
      role="tablist"
      aria-label={t('player.nowPlaying')}
      className={cn('inline-flex flex-none gap-0.5 rounded-pill bg-ink/[0.1] p-1 shadow-hair', centered ? 'self-center' : 'self-start')}
    >
      {views.map(view => {
        const on = views.includes('cover') ? mobileView === view : paneView === view
        return (
          <button
            key={view}
            role="tab"
            aria-selected={on}
            onClick={() => { if (!on) haptic('selection'); setMobileView(view) }}
            className={cn(
              'relative isolate h-9 rounded-pill px-4 text-[13.5px] font-semibold transition-colors duration-2',
              on ? 'text-ink' : 'text-ink-2 hover:text-ink'
            )}
          >
            {on && (
              <motion.span
                layoutId={`fs-tab-${group}`}
                transition={SPRING_SNAPPY}
                aria-hidden="true"
                className="absolute inset-0 -z-10 rounded-pill bg-ink/[0.16]"
              />
            )}
            {view === 'cover' ? t('player.tabCover') : view === 'lyrics' ? t('player.tabLyrics') : t('shell.upNext')}
          </button>
        )
      })}
    </div>
  )

  const queueList = (
    <UpNextList count={40} className="min-h-0 flex-1 overflow-y-auto" onOpenQueue={() => { setFullscreen(false); setQueueOpen(true) }} />
  )

  /** 控制区下面那排入口：打开卡片浏览的某一栏（手机上贴着屏幕两边横着滑，见 BrowseEntries） */
  const browseEntries = (size: 'compact' | 'regular') => (
    <div className="flex-none" data-fs-reveal="">
      <BrowseEntries onOpen={openBrowser} size={size} />
    </div>
  )

  const pane = (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-fs-reveal="">
      {viewTabs(['lyrics', 'queue'], 'pane')}
      {paneView === 'queue' ? queueList : lyricsSheet('flex-1')}
    </div>
  )

  const header = (
    <header
      className="relative z-10 flex flex-none items-center gap-2 px-4 pb-2 regular:px-6"
      style={{ paddingTop: needsTrafficLightInset ? 40 : 'calc(env(safe-area-inset-top) + 10px)' }}
      data-fs-reveal=""
      {...dragHandlers}
    >
      {/* 窄窗口上方一条抓手：告诉手指「往下拖就收起」 */}
      {(layout === 'stack' || layout === 'portrait') && (
        <span aria-hidden="true" className="absolute left-1/2 top-[calc(env(safe-area-inset-top)+4px)] h-[5px] w-9 -translate-x-1/2 rounded-pill bg-ink/30" />
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <button onClick={toggleFullscreen} aria-label={t('player.collapse')} className={chipBtn}>
            <CaretDown size={20} weight="bold" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t('player.collapse')}</TooltipContent>
      </Tooltip>

      <div className="min-w-0 flex-1 text-center">
        {/* 一列的排法：顶栏中间是封面 / 歌词 / 接下来的切换。
            横屏不放居中的东西：右栏的分段标签已经是那一栏的中轴，顶栏再居中一行就有两条轴 */}
        {layout === 'stack' || layout === 'portrait' ? viewTabs(['cover', 'lyrics', 'queue'], 'stack', true) : null}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button aria-label={t('action.more')} className={chipBtn}>
            <DotsThree size={22} weight="bold" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <div className="mb-1 px-3 py-2.5 hairline-b">
            <p className="truncate text-sm font-semibold">{currentSong.title}</p>
            <p className="mt-0.5 truncate text-xs text-ink-3">{currentSong.artist}</p>
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
            <p className="mb-1.5 text-[12.5px] font-medium text-ink-3">{t('player.songInfo')}</p>
            {currentSong.duration > 0 && (
              <div className="flex items-center gap-2 text-xs text-ink-2">
                <Clock size={12} className="flex-shrink-0" />
                <span className="num">{formatDuration(currentSong.duration)}</span>
              </div>
            )}
            {currentSong.bitRate && (
              <div className="flex items-center gap-2 text-xs text-ink-2">
                <MusicNote size={12} className="flex-shrink-0" />
                <span className="num">{currentSong.bitRate} kbps</span>
                {fileType && <span className="text-ink-3">{fileType}</span>}
              </div>
            )}
            {currentSong.year && (
              <div className="flex items-center gap-2 text-xs text-ink-2">
                <Info size={12} className="flex-shrink-0" />
                <span className="num">{t('song.year', { year: currentSong.year })}</span>
                {currentSong.genre && <span className="text-ink-3">{currentSong.genre}</span>}
              </div>
            )}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  )

  /* ---------- 四种排法 ---------- */

  let body: ReactNode
  if (layout === 'stack' || layout === 'portrait') {
    /* 手机与 iPad 竖屏同一种排法：一列，封面 / 歌词 / 接下来三选一。
       竖屏的 iPad 宽，封面不该缩成左上角一小张去给歌词让位——它就是这一屏的主角 */
    const tall = layout === 'portrait'
    body = (
      <div
        className={cn('relative z-10 mx-auto flex min-h-0 w-full flex-1 flex-col', tall ? 'max-w-[640px] px-8' : 'px-6')}
        style={{ paddingBottom: `calc(env(safe-area-inset-bottom) + ${tall ? 28 : 18}px)` }}
      >
        {/* 封面在剩下的空间里居中（最多 88cqh，上下留一口气）；
            歌名贴着进度条，不在封面和进度条之间悬一大块空 */}
        <div className="flex min-h-0 flex-1 flex-col [container-type:size]">
          {mobileView === 'cover' ? (
            <div className="flex flex-1 items-center justify-center" {...dragHandlers}>
              {coverStage('', { width: 'min(100%, 88cqh)' })}
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-4" data-fs-reveal="">
              <div className="flex items-center gap-3">
                <div className="cover-frame h-14 w-14 flex-none rounded-[10px] shadow-md">
                  <CoverThumb song={currentSong} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[16px] font-semibold text-ink">{spaceCJK(currentSong.title)}</p>
                  <p className="truncate text-[14px] font-medium text-ink-2">{spaceCJK(currentSong.artist)}</p>
                </div>
                {songActions}
              </div>
              {mobileView === 'queue' ? queueList : lyricsSheet('flex-1')}
            </div>
          )}
        </div>
        {mobileView === 'cover' && <div className={cn('flex-none', tall ? 'pt-8' : 'pt-5')}>{titleBlock(tall ? 'lg' : 'md')}</div>}
        <div className={cn('flex flex-none flex-col pt-6', tall ? 'gap-5' : 'gap-4')} data-fs-reveal="">
          <FSProgressBar />
          {tall && quality}
          {transport(false)}
        </div>
        <div className={cn('flex-none', tall ? 'pt-6' : 'pt-4')}>{browseEntries(tall ? 'regular' : 'compact')}</div>
      </div>
    )
  } else if (layout === 'landscape') {
    body = (
      <div
        className="relative z-10 mx-auto grid min-h-0 w-full max-w-[1480px] flex-1 grid-cols-[minmax(0,0.84fr)_minmax(0,1.16fr)] gap-12 px-10 wide:gap-20 wide:px-16"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 28px)' }}
      >
        <div className="flex min-h-0 flex-col justify-center gap-7 [container-type:size]">
          {/* 300px 给标题、进度、控制；再 64px 给下面那排入口 */}
          {coverStage('', { width: 'min(100%, calc(100cqh - 364px))' })}
          {titleBlock(wc === 'wide' ? 'xl' : 'lg')}
          <div data-fs-reveal=""><FSProgressBar /></div>
          {transport(wc === 'wide')}
          {browseEntries('regular')}
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
              if (e.clientX < s.x) handleNext(); else handlePrev()
            }}
          >
            {slots.map((qi, k) => {
              const song = qi !== undefined ? queue[qi] : undefined
              if (!song) return <span key={k} />
              return (
                <button
                  key={`${song.id}-${qi}`}
                  onClick={() => qi !== undefined && qi !== queueIndex && jumpToIndex(qi)}
                  className={cn(
                    'cover-frame aspect-square w-full shadow-md transition-[transform,opacity] duration-4 ease-smooth',
                    k === 2 ? 'shadow-cover' : 'scale-90 opacity-55 hover:opacity-80'
                  )}
                  aria-label={song.title}
                  aria-current={k === 2 ? 'true' : undefined}
                >
                  <CoverThumb song={song} size={320} />
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
    <motion.div
      ref={rootRef}
      className="stage fixed inset-0 z-50 flex flex-col overflow-hidden"
      style={{ y: dragY }}
    >
      {/* 背景单独一层：开合时只有它淡入淡出，封面和文字各走各的 */}
      <div ref={bgRef} className="pointer-events-none absolute inset-0">
        <StageField originRef={coverBoxRef} active={settled} />
      </div>

      {/* 正在播放这一层：卡片浏览打开时退后一点、淡出 */}
      <motion.div
        ref={contentRef}
        className="relative flex min-h-0 flex-1 flex-col"
        initial={false}
        animate={browse ? { opacity: 0, transform: 'scale(0.97)' } : { opacity: 1, transform: 'scale(1)' }}
        transition={SPRING_SMOOTH}
        aria-hidden={browse ? true : undefined}
      >
        {layout !== 'tabletop' && header}
        {body}
      </motion.div>

      <AnimatePresence>
        {browse && (
          <motion.div
            key="cover-browser"
            className="absolute inset-0 z-20"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, transform: 'translateY(28px)' }}
            animate={{ opacity: 1, transform: 'translateY(0px)' }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, transform: 'translateY(20px)' }}
            transition={SPRING_SMOOTH}
          >
            <CoverBrowser tab={browse} onTab={setBrowse} onClose={closeBrowser} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* 睡眠定时的选择面板。播放条上那个是 DropdownMenu，嵌进另一个菜单会打架，所以这里用对话框 */}
      <Dialog open={sleepOpen} onOpenChange={setSleepOpen}>
        <DialogContent className="regular:max-w-xs">
          <DialogHeader>
            <DialogTitle>{t('player.sleepTimer')}</DialogTitle>
            <DialogDescription>{t('player.sleepFadeHint')}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-0.5">
            {PRESETS.map(minutes => (
              <button
                key={minutes}
                onClick={() => { setSleepTimer(minutes); setSleepOpen(false) }}
                className="rounded-sm px-3 py-3 text-left text-[15px] transition-colors duration-2 hover:bg-fill"
              >
                {t('player.sleepAfterMinutes', { minutes })}
              </button>
            ))}
            <button
              onClick={() => { setSleepTimer(null, 'endOfTrack'); setSleepOpen(false) }}
              className="rounded-sm px-3 py-3 text-left text-[15px] transition-colors duration-2 hover:bg-fill"
            >
              {t('player.sleepEndOfTrack')}
            </button>
            {sleepTimerAt !== null && (
              <button
                onClick={() => { setSleepTimer(null); setSleepOpen(false) }}
                className="rounded-sm px-3 py-3 text-left text-[15px] font-semibold text-leaf transition-colors duration-2 hover:bg-fill"
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
    </motion.div>
  )
}

/** 小封面（窄窗口的歌词 / 队列页头、悬停排法的封面带） */
function CoverThumb({ song, size = 160 }: { song: Song; size?: number }) {
  const { primary, fallback } = useCoverUrl(song, { size })
  return <CoverImage primary={primary} fallback={fallback} alt="" className="h-full w-full" eager songId={song.id} />
}
