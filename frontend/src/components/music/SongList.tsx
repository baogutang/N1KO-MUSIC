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
} from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'
import { AddToPlaylistDialog } from '@/components/music/AddToPlaylistDialog'
import { usePlayerStore } from '@/store/playerStore'
import { getAdapter, hasAdapter } from '@/api'
import { formatDuration } from '@/utils/formatters'
import { useToggleStar } from '@/hooks/useServerQueries'
import { playNextInQueue, playListFrom } from '@/utils/playActions'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { Song } from '@/api/types'

interface SongListProps {
  songs: Song[]
  /** 是否显示专辑封面列 */
  showCover?: boolean
  /** 是否显示专辑名列 */
  showAlbum?: boolean
  /** 是否显示行号 */
  showIndex?: boolean
  className?: string
  onPlaylistAdd?: (song: Song) => void
}

export function SongList({
  songs,
  showCover = true,
  showAlbum = true,
  showIndex = true,
  className,
  onPlaylistAdd,
}: SongListProps) {
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

  // 收藏 mutation 提到列表层。此前每一行各持有一个 useMutation 实例，
  // 一千行就是一千个订阅者。
  const toggleStar = useToggleStar()
  const toggleStarRef = React.useRef(toggleStar)
  toggleStarRef.current = toggleStar
  const handleToggleStar = useCallback((song: Song, nextStarred: boolean, revert: () => void) => {
    toggleStarRef.current.mutate(
      { id: song.id, type: 'song', isStarred: !nextStarred, song },
      { onError: revert }
    )
  }, [])

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
      onPlayIndex={handlePlayIndex}
      onPlaylistAdd={handlePlaylistAdd}
      onToggleStar={handleToggleStar}
    />
  ), [currentSongId, isPlaying, showCover, showAlbum, showIndex, handlePlayIndex, handlePlaylistAdd, handleToggleStar])

  return (
    <>
      {songs.length > VIRTUALIZE_THRESHOLD ? (
        <VirtualSongRows songs={songs} className={className} renderRow={renderRow} />
      ) : (
        <div className={cn('border-t border-hair divide-y divide-hair-soft', className)}>
          {songs.map(renderRow)}
        </div>
      )}

      <AddToPlaylistDialog
        open={playlistAddSong !== null}
        onOpenChange={open => { if (!open) setPlaylistAddSong(null) }}
        songs={playlistAddSong ? [playlistAddSong] : []}
      />
    </>
  )
}

/**
 * 超过这个行数才启用虚拟滚动。
 * 专辑详情之类的短列表直接实挂更简单，也避免测量带来的首帧抖动。
 */
const VIRTUALIZE_THRESHOLD = 60
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

  useLayoutEffect(() => {
    const parent = findScrollParent(containerRef.current)
    setScrollEl(parent)
    if (parent && containerRef.current) {
      // 列表在滚动容器里的偏移量，虚拟化据此换算可视区间
      const top = containerRef.current.getBoundingClientRect().top
        - parent.getBoundingClientRect().top
        + parent.scrollTop
      setScrollMargin(top)
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

  return (
    <div
      ref={containerRef}
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
  onPlayIndex: (index: number) => void
  onPlaylistAdd?: (song: Song) => void
  onToggleStar: (song: Song, nextStarred: boolean, revert: () => void) => void
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
  onPlayIndex,
  onPlaylistAdd,
  onToggleStar,
}: SongRowProps) {
  const [localStarred, setLocalStarred] = React.useState(!!song.starred)
  const navigate = useNavigate()
  // 行是 memo 的，封面 URL 只在这首歌变化时才重算
  const coverUrl = useMemo(
    () => (song.coverArt && hasAdapter() ? getAdapter().getCoverUrl(song.coverArt, 64) : undefined),
    [song.coverArt]
  )

  useEffect(() => {
    setLocalStarred(!!song.starred)
  }, [song.id, song.starred])

  // 稳定的 handlePlay，只依赖 index 和 onPlayIndex（均为稳定引用）
  const handlePlay = useCallback(() => onPlayIndex(index), [onPlayIndex, index])

  const handleToggleStar = (e: React.MouseEvent) => {
    e.stopPropagation()
    const newStarred = !localStarred
    setLocalStarred(newStarred)
    onToggleStar(song, newStarred, () => setLocalStarred(!newStarred))
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
    <div className="song-row group" onClick={handlePlay}>
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
            aria-label="播放"
          >
            <span className="w-[22px] h-[22px] rounded-full border border-hair flex items-center justify-center text-ink-soft hover:text-primary hover:border-primary active:scale-[0.94] transition-colors duration-200">
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

      {/* 小封面：40px、发丝 ring */}
      {showCover && (
        <div className="w-10 h-10 rounded-sm overflow-hidden ring-1 ring-hair-soft flex-shrink-0">
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
          'font-serif text-[15px] font-semibold leading-snug line-clamp-1 transition-colors',
          isCurrentSong ? 'text-primary' : 'text-foreground'
        )}>
          {song.title}
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
            {song.artist}
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
              {song.album}
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
            : 'opacity-0 group-hover:opacity-100 text-ink-faint hover:text-primary'
        )}
        aria-label={localStarred ? '取消喜欢' : '加入喜欢'}
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
            className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 p-1.5 flex-shrink-0 text-ink-soft hover:text-ink"
            aria-label="更多操作"
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
            立即播放
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={(e) => { e.stopPropagation(); playNextInQueue([song]) }}
            className="gap-2"
          >
            <Plus className="w-4 h-4" />
            下一首播放
          </DropdownMenuItem>
          <DropdownMenuSeparator />

          <DropdownMenuItem onClick={handleToggleStar} className="gap-2">
            <Heart className={cn('w-4 h-4', localStarred ? 'text-primary' : '')} weight={localStarred ? 'fill' : 'regular'} />
            {localStarred ? '取消喜欢' : '加入喜欢'}
          </DropdownMenuItem>

          {song.artistId && (
            <DropdownMenuItem onClick={handleNavigateArtist} className="gap-2">
              <MicrophoneStage className="w-4 h-4" />
              查看歌手
            </DropdownMenuItem>
          )}
          {song.albumId && (
            <DropdownMenuItem onClick={handleNavigateAlbum} className="gap-2">
              <Disc className="w-4 h-4" />
              查看专辑
            </DropdownMenuItem>
          )}

          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={(e) => { e.stopPropagation(); navigate(`/songs/${song.id}`, { state: { song } }) }}
            className="gap-2"
          >
            <FileText className="w-4 h-4" />
            查看歌曲详情
          </DropdownMenuItem>

          {onPlaylistAdd && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onPlaylistAdd(song)} className="gap-2">
                <Plus className="w-4 h-4" />
                添加到歌单
              </DropdownMenuItem>
            </>
          )}

          <DropdownMenuSeparator />
          <div className="px-3 py-2 space-y-1.5">
            <p className="text-xs text-ink-faint uppercase tracking-[0.14em] mb-1">歌曲信息</p>
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
                <span className="font-num">{song.year} 年</span>
                {song.genre && <span className="text-ink-faint/60">· {song.genre}</span>}
              </div>
            )}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
})
