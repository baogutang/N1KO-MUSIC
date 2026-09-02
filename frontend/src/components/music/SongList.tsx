/**
 * 歌曲列表组件 —— 编号编辑列表（DESIGN v2 §3「列表即网格」）
 * mono 序号｜小封面｜衬线曲名+歌手｜专辑链接｜hover 收藏｜mono 时长｜⋯ 菜单
 * - 歌手名 / 专辑名点击跳转对应页面
 * - 喜欢按钮调用 star/unstar API
 * - 右键菜单 / 更多菜单展示歌曲详情
 * - 「添加到歌单」：页面传 onPlaylistAdd 时走外部逻辑，缺省时内建 AddToPlaylistDialog
 * - SongRow 用 React.memo 包装，避免父组件更新时全列表重渲染
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useNavigate } from 'react-router-dom'
import {
  Play,
  Heart,
  DotsThree,
  Plus,
  ClockCounterClockwise,
  MusicNote,
  Info,
  Disc,
  MicrophoneStage,
  FileText,
  ShareNetwork,
  Broadcast as BroadcastIcon,
  Trash,
} from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'
import { AddToPlaylistDialog } from '@/components/music/AddToPlaylistDialog'
import { SourceBadge } from '@/components/sources/SourceBadge'
import { usePlayerStore } from '@/store/playerStore'
import { findAdapterFor } from '@/api'
import { formatDuration } from '@/utils/formatters'
import { spaceCJK } from '@/utils/cjkTypography'
import { useToggleStar } from '@/hooks/useServerQueries'
import { useServerCapabilities } from '@/hooks/useServerCapabilities'
import { ShareDialog } from '@/components/music/ShareDialog'
import { StarRating } from '@/components/music/StarRating'
import { startRadio } from '@/services/radio'
import { toast } from '@/components/ui/use-toast'
import { playAllInOrder, playNextInQueue, playListFrom } from '@/utils/playActions'
import { useListSelection } from '@/hooks/useListSelection'
import { SelectionBar, type SelectionBarAction } from '@/components/music/SelectionBar'
import { useT } from '@/i18n'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { Song } from '@/api/types'

/**
 * 选择集的键。
 * 用 id + 下标而不是单独的 id：同一首歌在一个歌单里出现两次是合法的，
 * 只按 id 存会把两行绑在一起，选一行另一行也亮。
 */
function songIdentity(song: Song, index: number): string {
  return `${song.id}#${index}`
}

interface SongListProps {
  /**
   * 从当前上下文移除这首歌（目前只有歌单详情用到）。
   * 传下标而不是 song：同一首歌在歌单里可以出现多次，
   * 用 id 会分不清删的是哪一条——Subsonic 的接口也是按下标删的。
   */
  onRemove?: (index: number) => void
  songs: Song[]
  /** 是否显示专辑封面列 */
  showCover?: boolean
  /** 是否显示专辑名列 */
  showAlbum?: boolean
  /** 是否显示行号 */
  showIndex?: boolean
  className?: string
  onPlaylistAdd?: (song: Song) => void
  /** 关掉多选（队列抽屉这类自身已有拖拽语义的列表用得上） */
  selectable?: boolean
  /** 聚合场景显示来源徽标（单源浏览页不必开，减少视觉噪声） */
  sourceBadge?: boolean
}

export function SongList({
  songs,
  showCover = true,
  showAlbum = true,
  showIndex = true,
  className,
  onPlaylistAdd,
  onRemove,
  selectable = true,
  sourceBadge = false,
}: SongListProps) {
  const { t } = useT()
  // 只订阅 id 和 isPlaying，不订阅 currentTime，避免高频重渲染
  const currentSongId = usePlayerStore(s => s.currentSong?.id)
  const isPlaying = usePlayerStore(s => s.isPlaying)

  // 封面 URL 改为在行内按需计算。此前这里 memo 了一个数组，但 songs 在调用方
  // 多是 flatMap 出来的新数组，每次渲染引用都变，memo 从来没生效过；
  // 而 SongRow 本身是 memo 的，放进行内反而只在该行的歌曲变化时才重算。

  // 把 songs 稳定化，避免每次渲染都创建新函数
  // 注意：onPlay 不能用 inline arrow，否则 React.memo 失效
  const songsRef = React.useRef(songs)
  songsRef.current = songs

  const handlePlayIndex = useCallback((index: number) => {
    // 走 playActions：点单曲行不表达顺序意图，沿用用户当前的随机开关
    playListFrom(songsRef.current, index)
  }, []) // 空依赖——通过 ref 访问最新值，函数引用永远稳定

  // 「添加到歌单」：页面传了 onPlaylistAdd 走外部逻辑；缺省时内建 AddToPlaylistDialog。
  // dialog 状态提升在列表层（非每行），保持 SongRow 的 memo 结构
  const [playlistAddSong, setPlaylistAddSong] = React.useState<Song | null>(null)
  const handlePlaylistAdd = useCallback((song: Song) => {
    if (onPlaylistAdd) {
      onPlaylistAdd(song)
    } else {
      setPlaylistAddSong(song)
    }
  }, [onPlaylistAdd])

  // 分享对话框与收藏 mutation 一样提升到列表层，保持 SongRow 的 memo 结构
  const [shareSong, setShareSong] = React.useState<Song | null>(null)
  const caps = useServerCapabilities()
  const handleShare = useCallback((song: Song) => setShareSong(song), [])
  const handleRadio = useCallback(async (song: Song) => {
    const ok = await startRadio({ kind: 'song', id: song.id, name: song.title, serverId: song.serverId })
    if (!ok) toast({ title: t('song.radioUnsupported'), variant: 'destructive' })
  }, [t])

  // 收藏 mutation 提到列表层。此前每一行各持有一个 useMutation 实例，
  // 一千行就是一千个订阅者。
  const toggleStar = useToggleStar()
  const toggleStarRef = React.useRef(toggleStar)
  toggleStarRef.current = toggleStar
  // 回滚由 mutation 自身的 onError 通过缓存完成，这里不再传每次调用的回调——
  // 共享 observer 下后一次调用会把前一次的回调顶掉，导致回滚丢失。
  const handleToggleStar = useCallback((song: Song, nextStarred: boolean) => {
    toggleStarRef.current.mutate({ id: song.id, type: 'song', isStarred: !nextStarred, song })
  }, [])

  // ── 多选 ─────────────────────────────────────────────
  const selection = useListSelection(songs, songIdentity)
  const selectionRef = React.useRef(selection)
  selectionRef.current = selection

  // 选择态下点击行只勾选，不播放；非选择态时 handleClick 返回 false，照常播放
  const handleRowClick = useCallback((index: number, event: React.MouseEvent) => {
    if (!selectable) return false
    return selectionRef.current.handleClick(index, event)
  }, [selectable])

  const handleRowLongPress = useCallback((index: number) => {
    if (selectable) selectionRef.current.beginAt(index)
  }, [selectable])

  // songs 变了（切页、加载更多、换服务器）就把选择清掉，
  // 否则选择条会显示一个用户看不见的旧选区。
  // 签名只取长度和首尾 id：调用方多是 flatMap 出来的新数组，逐项拼串会在
  // 上万首的库上每次渲染都白跑一遍，而这三个值已经能覆盖换页/换库/加载更多。
  const songsIdentity = `${songs.length}:${songs[0]?.id ?? ''}:${songs[songs.length - 1]?.id ?? ''}`
  const clearSelection = selection.clear
  useEffect(() => { clearSelection() }, [songsIdentity, clearSelection])

  // Esc 退出选择态
  useEffect(() => {
    if (!selection.active) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') clearSelection() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selection.active, clearSelection])

  const [batchPlaylistSongs, setBatchPlaylistSongs] = React.useState<Song[] | null>(null)

  // 解构出稳定引用喂给 renderRow：整个 selection 对象每次选中都换新，
  // 直接依赖它等于每次都重建 renderRow，把 SongRow 的 memo 全部作废。
  const { isSelected, active: selectionActive } = selection

  const selectionActions: SelectionBarAction[] = useMemo(() => {
    const picked = () => selectionRef.current.selectedItems()
    return [
      {
        key: 'play', label: t('action.play'), icon: 'play',
        onClick: () => { const list = picked(); if (list.length) { playAllInOrder(list); clearSelection() } },
      },
      {
        key: 'next', label: t('action.playNext'), icon: 'next',
        onClick: () => {
          const list = picked()
          if (!list.length) return
          playNextInQueue(list)
          toast({ title: t('queue.insertedNext', { count: list.length }) })
          clearSelection()
        },
      },
      {
        key: 'playlist', label: t('action.addToPlaylist'), icon: 'playlist',
        onClick: () => { const list = picked(); if (list.length) setBatchPlaylistSongs(list) },
      },
      {
        key: 'star', label: t('action.favorite'), icon: 'star',
        onClick: () => {
          const list = picked().filter(song => !song.starred)
          if (!list.length) {
            toast({ title: t('song.allFavorited') })
            return
          }
          for (const song of list) {
            toggleStarRef.current.mutate({ id: song.id, type: 'song', isStarred: false, song })
          }
          clearSelection()
        },
      },
      {
        key: 'all', label: t('action.selectAll'), icon: 'all',
        onClick: () => selectionRef.current.selectAll(),
      },
    ]
    // t 的引用随语言变（见 i18n/useT），因此它本身就是这里需要的那个依赖
  }, [clearSelection, t])

  const renderRow = useCallback((song: Song, index: number) => (
    <SongRow
      key={song.id + '-' + index}
      song={song}
      index={index}
      isCurrentSong={currentSongId === song.id}
      isPlaying={isPlaying && currentSongId === song.id}
      showCover={showCover}
      showAlbum={showAlbum}
      showIndex={showIndex}
      sourceBadge={sourceBadge}
      onPlayIndex={handlePlayIndex}
      onPlaylistAdd={handlePlaylistAdd}
      onToggleStar={handleToggleStar}
      onShare={caps.shares ? handleShare : undefined}
      onRemove={onRemove ? () => onRemove(index) : undefined}
      onRadio={caps.radio ? handleRadio : undefined}
      canRate={caps.rating}
      selected={isSelected(songIdentity(song, index))}
      selectionActive={selectionActive}
      onRowClick={selectable ? handleRowClick : undefined}
      onLongPress={selectable ? handleRowLongPress : undefined}
    />
  ), [currentSongId, isPlaying, showCover, showAlbum, showIndex, sourceBadge, handlePlayIndex,
      handlePlaylistAdd, handleToggleStar, caps.shares, caps.radio, caps.rating,
      handleShare, handleRadio, isSelected, selectionActive, selectable,
      handleRowClick, handleRowLongPress, onRemove])

  return (
    <>
      {songs.length > VIRTUALIZE_THRESHOLD ? (
        <VirtualSongRows songs={songs} className={className} renderRow={renderRow} />
      ) : (
        <div className={cn('border-t border-hair divide-y divide-hair-soft', className)}>
          {songs.map(renderRow)}
        </div>
      )}

      {selectable && (
        <SelectionBar
          count={selection.count}
          total={songs.length}
          actions={selectionActions}
          onClear={clearSelection}
        />
      )}

      <AddToPlaylistDialog
        open={batchPlaylistSongs !== null}
        onOpenChange={open => {
          if (!open) {
            setBatchPlaylistSongs(null)
            clearSelection()
          }
        }}
        songs={batchPlaylistSongs ?? []}
      />

      <AddToPlaylistDialog
        open={playlistAddSong !== null}
        onOpenChange={open => { if (!open) setPlaylistAddSong(null) }}
        songs={playlistAddSong ? [playlistAddSong] : []}
      />

      <ShareDialog
        open={shareSong !== null}
        onOpenChange={open => { if (!open) setShareSong(null) }}
        target={shareSong ? { ids: [shareSong.id], label: shareSong.title, kind: 'song' } : null}
      />
    </>
  )
}

/**
 * 超过这个行数才启用虚拟滚动。
 * 专辑详情之类的短列表直接实挂更简单，也避免测量带来的首帧抖动。
 */
const VIRTUALIZE_THRESHOLD = 60
/** 长按多久算「进入选择态」 */
const LONG_PRESS_MS = 480
/** 长按期间允许的手指位移，超过就当成滚动 */
const LONG_PRESS_SLOP = 10
/** 行高估计值：40px 封面 + 上下 10px 内边距 + 1px 分隔线 */
const ESTIMATED_ROW_HEIGHT = 61

/** 找到最近的可滚动祖先。列表本身不滚动，滚的是 MainLayout 里的 <main>。 */
function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null
  while (node) {
    const style = getComputedStyle(node)
    if (/(auto|scroll|overlay)/.test(style.overflowY)) return node
    node = node.parentElement
  }
  return null
}

/**
 * 虚拟滚动容器。
 *
 * 此前完全没有虚拟化：每点一次「加载更多」就实挂 100 行且无上限，
 * 一千首约 2.8 万个 DOM 节点，一万首约 28 万，滚动掉到个位数 FPS，
 * hover 样式还会触发整档样式重算，移动端 WebView 最终 OOM。
 */
function VirtualSongRows({
  songs,
  className,
  renderRow,
}: {
  songs: Song[]
  className?: string
  renderRow: (song: Song, index: number) => React.ReactNode
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null)
  const [scrollMargin, setScrollMargin] = useState(0)
  /**
   * 滚动容器尺寸的版本号。
   *
   * 虚拟化在 outerSize 为 0 时算出的可视区间是空的，一行都不渲染。
   * 容器在挂载那一刻高度为 0 是会发生的——后台标签页、尚未完成布局、
   * 或窗口本身没有尺寸。此时若不再触发一次渲染，虚拟化就永远停在空列表上。
   * 这里在容器「从无尺寸变为有尺寸」时推进版本号，逼出一次重渲染。
   */
  const [sizeEpoch, setSizeEpoch] = useState(0)

  useLayoutEffect(() => {
    const parent = findScrollParent(containerRef.current)
    setScrollEl(parent)
    if (!parent || !containerRef.current) return

    /** 列表在滚动容器里的偏移量，虚拟化据此换算可视区间 */
    const measure = () => {
      const el = containerRef.current
      if (!el) return
      const top = el.getBoundingClientRect().top
        - parent.getBoundingClientRect().top
        + parent.scrollTop
      setScrollMargin(prev => (Math.abs(prev - top) > 1 ? top : prev))
    }
    measure()

    // 偏移量会因为列表之外的原因变化：离线横幅 / 续播提示 / 更新提示出现或消失、
    // 头部封面加载完成、窗口缩放。只按 songs.length 测一次的话，
    // 这些情况下行的定位会整体错位。
    let hadSize = parent.clientHeight > 0
    const onResize = () => {
      measure()
      const hasSize = parent.clientHeight > 0
      if (hasSize && !hadSize) setSizeEpoch(v => v + 1)
      hadSize = hasSize
    }

    const observer = new ResizeObserver(onResize)
    observer.observe(parent)
    if (containerRef.current.parentElement) observer.observe(containerRef.current.parentElement)
    window.addEventListener('resize', onResize)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', onResize)
    }
  }, [songs.length])

  const virtualizer = useVirtualizer({
    count: songs.length,
    getScrollElement: () => scrollEl,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: 12,
    scrollMargin,
  })

  const items = virtualizer.getVirtualItems()

  // 兜底：容器还没有尺寸时虚拟化算不出可视区间。与其给用户一个空列表，
  // 不如先实挂开头的一屏，等尺寸就绪后 sizeEpoch 推进再切回虚拟化。
  if (!items.length && songs.length) {
    return (
      <div
        ref={containerRef}
        data-size-epoch={sizeEpoch}
        className={cn('border-t border-hair divide-y divide-hair-soft', className)}
      >
        {songs.slice(0, VIRTUALIZE_THRESHOLD).map(renderRow)}
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      data-size-epoch={sizeEpoch}
      className={cn('border-t border-hair', className)}
      style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
    >
      {items.map(item => (
        <div
          key={item.key}
          data-index={item.index}
          ref={virtualizer.measureElement}
          className="absolute left-0 w-full border-b border-hair-soft"
          style={{ transform: `translateY(${item.start - scrollMargin}px)` }}
        >
          {renderRow(songs[item.index], item.index)}
        </div>
      ))}
    </div>
  )
}

interface SongRowProps {
  song: Song
  index: number
  isCurrentSong: boolean
  isPlaying: boolean
  showCover: boolean
  showAlbum: boolean
  showIndex: boolean
  /** 聚合场景：标题旁渲染来源徽标 */
  sourceBadge?: boolean
  onPlayIndex: (index: number) => void
  onPlaylistAdd?: (song: Song) => void
  onToggleStar: (song: Song, nextStarred: boolean) => void
  /** 服务器不支持时为 undefined，对应菜单项直接不出现 */
  onShare?: (song: Song) => void
  onRemove?: () => void
  onRadio?: (song: Song) => void
  canRate?: boolean
  selected?: boolean
  selectionActive?: boolean
  /** 返回 true 表示这次点击被选择逻辑吃掉了，不要播放 */
  onRowClick?: (index: number, event: React.MouseEvent) => boolean
  onLongPress?: (index: number) => void
}

// React.memo：只有 props 变化时才重渲染，播放进度更新不会触发歌曲行重渲染
const SongRow = React.memo(function SongRow({
  song,
  index,
  isCurrentSong,
  isPlaying,
  showCover,
  showAlbum,
  showIndex,
  sourceBadge,
  onPlayIndex,
  onPlaylistAdd,
  onToggleStar,
  onShare,
  onRemove,
  onRadio,
  canRate,
  selected,
  selectionActive,
  onRowClick,
  onLongPress,
}: SongRowProps) {
  // 收藏状态直接读缓存里的这一条：mutation 的 onMutate 会同步就地改写缓存，
  // 视觉反馈依然是即时的，而且失败回滚也走同一条通路，不会出现两套真相。
  const localStarred = !!song.starred
  const { t } = useT()
  const navigate = useNavigate()
  // 行是 memo 的，封面 URL 只在这首歌变化时才重算；按歌曲来源取适配器
  const coverUrl = useMemo(
    () => song.coverArt ? (findAdapterFor(song.serverId)?.getCoverUrl(song.coverArt, 64) ?? undefined) : undefined,
    [song.coverArt, song.serverId]
  )

  // 稳定的 handlePlay，只依赖 index 和 onPlayIndex（均为稳定引用）
  const handlePlay = useCallback(() => onPlayIndex(index), [onPlayIndex, index])

  /**
   * 行点击：先给多选一次机会。⌘/Ctrl 点选、Shift 连选、以及已经在选择态时的
   * 普通点击都由它吃掉；其余情况照旧播放。
   */
  /**
   * 长按已经触发过，接下来那一次 click 要吞掉。
   *
   * 触摸端在 touchend 之后还会补发一个合成 click。长按把这一行选中之后，
   * 那个 click 走到 handleRowClick，看到选择集非空，于是**立刻把刚选中的这行
   * 取消掉**——长按在触摸端是进入选择态的唯一入口，等于整个功能不可用。
   */
  const longPressFired = useRef(false)

  const handleRowClick = useCallback((e: React.MouseEvent) => {
    // 长按刚刚把这一行选中，紧跟着的合成 click 不能再把它取消掉
    if (longPressFired.current) {
      longPressFired.current = false
      return
    }
    if (onRowClick?.(index, e)) return
    handlePlay()
  }, [onRowClick, index, handlePlay])

  /**
   * 长按进入选择态——触摸端没有修饰键，这是唯一的入口。
   * 手指移动超过 10px 就当成滚动，取消计时。
   */
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pressOrigin = useRef<{ x: number; y: number } | null>(null)
  const cancelPress = useCallback(() => {
    if (pressTimer.current) clearTimeout(pressTimer.current)
    pressTimer.current = null
    pressOrigin.current = null
  }, [])
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!onLongPress) return
    // 上一次没走完的计时必须先清掉，否则多指连点会留下孤儿计时器
    if (pressTimer.current) clearTimeout(pressTimer.current)
    const touch = e.touches[0]
    if (!touch) return
    longPressFired.current = false
    pressOrigin.current = { x: touch.clientX, y: touch.clientY }
    pressTimer.current = setTimeout(() => {
      pressTimer.current = null
      longPressFired.current = true
      onLongPress(index)
    }, LONG_PRESS_MS)
  }, [onLongPress, index])
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const origin = pressOrigin.current
    if (!origin) return
    const touch = e.touches[0]
    if (!touch) return
    if (Math.hypot(touch.clientX - origin.x, touch.clientY - origin.y) > LONG_PRESS_SLOP) {
      cancelPress()
    }
  }, [cancelPress])
  useEffect(() => cancelPress, [cancelPress])

  const handleToggleStar = (e: React.MouseEvent) => {
    e.stopPropagation()
    onToggleStar(song, !localStarred)
  }

  const handleNavigateArtist = (e: React.MouseEvent) => {
    if (song.artistId) {
      e.stopPropagation()
      navigate(`/artists/${song.artistId}`)
    }
    // 无 artistId 时不 stopPropagation，click 冒泡到行级 onClick → 触发播放
  }

  const handleNavigateAlbum = (e: React.MouseEvent) => {
    if (song.albumId) {
      e.stopPropagation()
      navigate(`/albums/${song.albumId}`)
    }
  }

  return (
    <div
      className={cn('song-row group relative', isCurrentSong && 'is-current', selected && 'bg-paper-deep')}
      onClick={handleRowClick}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={cancelPress}
      onTouchCancel={cancelPress}
      aria-selected={selectionActive ? !!selected : undefined}
      data-selected={selected ? '' : undefined}
    >
      {/* 选中标记：一道贴边的朱线，不占位、不引入新色 */}
      {selected && (
        <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-[3px] bg-primary" />
      )}
      {/* 序号：mono 01–NN；当前播放行变 accent EQ 三竖条；hover 浮现细线圆播放键 */}
      {showIndex && (
        <div className="w-8 flex-shrink-0 relative flex items-center justify-center">
          {/* 默认：序号 / EQ */}
          <span
            className={cn(
              'font-num text-xs group-hover:opacity-0 transition-opacity duration-200',
              isCurrentSong ? 'text-primary' : 'text-ink-faint'
            )}
          >
            {isPlaying && isCurrentSong ? (
              <span className="playing-bar">
                <span /><span /><span />
              </span>
            ) : (
              String(index + 1).padStart(2, '0')
            )}
          </span>
          {/* hover：细线圆播放键（绝对定位叠在序号上）*/}
          <button
            onClick={(e) => { e.stopPropagation(); handlePlay() }}
            className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200"
            aria-label={t('action.play')}
          >
            <span className="w-[22px] h-[22px] rounded-full border border-hair flex items-center justify-center text-ink-soft hover:text-primary hover:border-primary active:scale-[0.94] transition-colors duration-200 pop:bg-primary pop:text-primary-foreground pop:hover:text-primary-foreground pop:hover:border-hair">
              {isPlaying && isCurrentSong ? (
                <span className="playing-bar" style={{ height: 10 }}>
                  <span /><span /><span />
                </span>
              ) : (
                <Play className="w-2.5 h-2.5 ml-px" weight="fill" />
              )}
            </span>
          </button>
        </div>
      )}

      {/* 小封面：编辑风 40px 发丝 ring；波普换成 2px 墨描边 */}
      {showCover && (
        <div className="w-10 h-10 rounded-sm overflow-hidden ring-1 ring-hair-soft flex-shrink-0 pop:ring-0 pop:border pop:border-hair">
          <ImageWithFallback
            src={coverUrl}
            alt={song.album}
            fallbackType="album"
            className="w-full h-full"
            songId={song.id}
            customCoverParams={{ type: 'song', title: song.title, artist: song.artist, album: song.album, path: song.path }}
          />
        </div>
      )}

      {/* 歌曲信息：衬线曲名 + 小字歌手 */}
      <div className="flex-1 min-w-0">
        <p className={cn(
          'song-title font-serif text-[15px] font-semibold leading-snug line-clamp-1 transition-colors',
          isCurrentSong ? 'text-primary' : 'text-foreground'
        )}>
          {spaceCJK(song.title)}
          {sourceBadge && (
            <SourceBadge serverId={song.serverId} className="ml-1.5 align-baseline inline-block translate-y-[-1px]" />
          )}
        </p>
        <p className="text-xs text-ink-soft line-clamp-1 mt-0.5">
          <button
            type="button"
            onClick={handleNavigateArtist}
            className={cn(
              'transition-colors',
              song.artistId ? 'hover:text-primary hover:underline cursor-pointer' : ''
            )}
          >
            {spaceCJK(song.artist)}
          </button>
        </p>
      </div>

      {/* 专辑名（大屏才显示）*/}
      {showAlbum && (
        <div className="hidden lg:block flex-1 min-w-0 px-4">
          <p className="text-xs text-ink-faint line-clamp-1">
            <button
              type="button"
              onClick={handleNavigateAlbum}
              className={cn(
                'transition-colors',
                song.albumId ? 'hover:text-primary hover:underline cursor-pointer' : ''
              )}
            >
              {spaceCJK(song.album)}
            </button>
          </p>
        </div>
      )}

      {/* 收藏（CSS hover 控制显隐）*/}
      <button
        onClick={handleToggleStar}
        className={cn(
          'transition-all duration-200 p-1.5 active:scale-[0.94] flex-shrink-0',
          localStarred
            ? 'opacity-100 text-primary'
            // 触屏没有 hover：这里若保持 opacity-0，未收藏的歌在手机上
            // 根本没有收藏入口（已收藏的是实心常显，所以只有这一支有问题）
            : '[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-visible:opacity-100 text-ink-faint hover:text-primary'
        )}
        aria-label={localStarred ? t('player.unfavorite') : t('player.favorite')}
      >
        <Heart
          className="w-4 h-4"
          weight={localStarred ? 'fill' : 'regular'}
        />
      </button>

      {/* 时长：mono tabular */}
      <span className="text-xs text-ink-faint font-num w-12 text-right flex-shrink-0">
        {formatDuration(song.duration)}
      </span>

      {/* 更多操作（CSS hover 控制显隐）*/}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            onClick={(e) => e.stopPropagation()}
            /**
             * 触屏上没有 hover，`opacity-0 group-hover:opacity-100` 意味着这个
             * 按钮永远是透明的——手机上整行只有标题、歌手、时长，分享/加入歌单/
             * 查看专辑全都够不着。用 `@media (hover: hover)` 精确区分：
             * 有悬停能力的设备保持「浮现」的克制，触屏设备一律常显。
             *
             * focus-visible 那条是给键盘的：Tab 过来时按钮必须可见，
             * 否则焦点会停在一个看不见的控件上。
             */
            className="transition-opacity duration-200 p-1.5 flex-shrink-0 text-ink-soft hover:text-ink [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-visible:opacity-100"
            aria-label={t('action.more')}
          >
            <DotsThree className="w-4 h-4" weight="bold" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56 glass">
          <div className="px-3 py-2 border-b border-hair-soft">
            <p className="font-serif font-semibold text-sm truncate">{song.title}</p>
            <p className="text-xs text-ink-faint truncate mt-0.5">{song.artist}</p>
          </div>

          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handlePlay() }} className="gap-2">
            <Play className="w-4 h-4" weight="fill" />
            {t('song.playNow')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={(e) => { e.stopPropagation(); playNextInQueue([song]) }}
            className="gap-2"
          >
            <Plus className="w-4 h-4" />
            {t('action.playNext')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />

          <DropdownMenuItem onClick={handleToggleStar} className="gap-2">
            <Heart className={cn('w-4 h-4', localStarred ? 'text-primary' : '')} weight={localStarred ? 'fill' : 'regular'} />
            {localStarred ? t('player.unfavorite') : t('player.favorite')}
          </DropdownMenuItem>

          {onRadio && (
            <DropdownMenuItem
              onClick={(e) => { e.stopPropagation(); void onRadio(song) }}
              className="gap-2"
            >
              <BroadcastIcon className="w-4 h-4" />
              {t('song.startRadio')}
            </DropdownMenuItem>
          )}

          {canRate && (
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-xs text-ink-faint">{t('song.rating')}</span>
              <StarRating id={song.id} value={song.userRating} size={13} />
            </div>
          )}

          {song.artistId && (
            <DropdownMenuItem onClick={handleNavigateArtist} className="gap-2">
              <MicrophoneStage className="w-4 h-4" />
              {t('song.viewArtist')}
            </DropdownMenuItem>
          )}
          {song.albumId && (
            <DropdownMenuItem onClick={handleNavigateAlbum} className="gap-2">
              <Disc className="w-4 h-4" />
              {t('song.viewAlbum')}
            </DropdownMenuItem>
          )}

          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={(e) => { e.stopPropagation(); navigate(`/songs/${song.id}`, { state: { song } }) }}
            className="gap-2"
          >
            <FileText className="w-4 h-4" />
            {t('song.viewDetail')}
          </DropdownMenuItem>

          {(onPlaylistAdd || onShare || onRemove) && (
            <>
              <DropdownMenuSeparator />
              {onPlaylistAdd && (
                <DropdownMenuItem onClick={() => onPlaylistAdd(song)} className="gap-2">
                  <Plus className="w-4 h-4" />
                  {t('action.addToPlaylist')}
                </DropdownMenuItem>
              )}
              {onShare && (
                <DropdownMenuItem
                  onClick={(e) => { e.stopPropagation(); onShare(song) }}
                  className="gap-2"
                >
                  <ShareNetwork className="w-4 h-4" />
                  {t('share.link')}
                </DropdownMenuItem>
              )}
              {onRemove && (
                <DropdownMenuItem
                  onClick={(e) => { e.stopPropagation(); onRemove() }}
                  className="gap-2 text-destructive focus:text-destructive"
                >
                  <Trash className="w-4 h-4" />
                  {t('playlist.removeSong')}
                </DropdownMenuItem>
              )}
            </>
          )}

          <DropdownMenuSeparator />
          <div className="px-3 py-2 space-y-1.5">
            <p className="text-xs text-ink-faint uppercase tracking-[0.14em] mb-1">{t('song.info')}</p>
            {song.duration > 0 && (
              <div className="flex items-center gap-2 text-xs text-ink-faint">
                <ClockCounterClockwise className="w-3 h-3 flex-shrink-0" />
                <span className="font-num">{formatDuration(song.duration)}</span>
              </div>
            )}
            {song.bitRate && (
              <div className="flex items-center gap-2 text-xs text-ink-faint">
                <MusicNote className="w-3 h-3 flex-shrink-0" />
                <span className="font-num">{song.bitRate} kbps</span>
                {song.contentType && (
                  <span className="text-ink-faint/60">· {song.contentType.split('/')[1]?.toUpperCase()}</span>
                )}
              </div>
            )}
            {song.year && (
              <div className="flex items-center gap-2 text-xs text-ink-faint">
                <Info className="w-3 h-3 flex-shrink-0" />
                <span className="font-num">{t('song.year', { year: song.year })}</span>
                {song.genre && <span className="text-ink-faint/60">· {song.genre}</span>}
              </div>
            )}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
})
