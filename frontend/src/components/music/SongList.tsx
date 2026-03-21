/**
 * 歌曲列表组件
 * 通用表格式歌曲列表，支持行号、封面、收藏、播放计数等
 * - 歌手名 / 专辑名点击跳转对应页面
 * - 喜欢按钮调用 star/unstar API
 * - 右键菜单 / 更多菜单展示歌曲详情
 * - SongRow 用 React.memo 包装，避免父组件更新时全列表重渲染
 */

import React, { useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Play, Heart, MoreHorizontal, Plus, Clock, Music2, Info, Disc3, Mic2, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'
import { usePlayerStore } from '@/store/playerStore'
import { getAdapter, hasAdapter } from '@/api'
import { formatDuration } from '@/utils/formatters'
import { useToggleStar } from '@/hooks/useServerQueries'
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
  /** 当前上下文歌单标题 */
  contextTitle?: string
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
  const playQueue = usePlayerStore(s => s.playQueue)

  // 用 useMemo 预计算 coverUrl 列表，避免每次渲染重新计算
  const coverUrls = useMemo(() => {
    return songs.map(song =>
      song.coverArt && hasAdapter() ? getAdapter().getCoverUrl(song.coverArt, 64) : undefined
    )
  }, [songs])

  // 把 playQueue + songs 稳定化，避免每次渲染都创建新函数
  // 注意：onPlay 不能用 inline arrow，否则 React.memo 失效
  const songsRef = React.useRef(songs)
  songsRef.current = songs
  const playQueueRef = React.useRef(playQueue)
  playQueueRef.current = playQueue

  const handlePlayIndex = useCallback((index: number) => {
    playQueueRef.current(songsRef.current, index)
  }, []) // 空依赖——通过 ref 访问最新值，函数引用永远稳定

  return (
    <div className={cn('space-y-0.5', className)}>
      {songs.map((song, index) => {
        const isCurrentSong = currentSongId === song.id

        return (
          <SongRow
            key={song.id + '-' + index}
            song={song}
            index={index}
            isCurrentSong={isCurrentSong}
            isPlaying={isPlaying && isCurrentSong}
            coverUrl={coverUrls[index]}
            showCover={showCover}
            showAlbum={showAlbum}
            showIndex={showIndex}
            onPlayIndex={handlePlayIndex}
            onPlaylistAdd={onPlaylistAdd}
          />
        )
      })}
    </div>
  )
}

interface SongRowProps {
  song: Song
  index: number
  isCurrentSong: boolean
  isPlaying: boolean
  coverUrl?: string
  showCover: boolean
  showAlbum: boolean
  showIndex: boolean
  onPlayIndex: (index: number) => void
  onPlaylistAdd?: (song: Song) => void
}

// React.memo：只有 props 变化时才重渲染，播放进度更新不会触发歌曲行重渲染
const SongRow = React.memo(function SongRow({
  song,
  index,
  isCurrentSong,
  isPlaying,
  coverUrl,
  showCover,
  showAlbum,
  showIndex,
  onPlayIndex,
  onPlaylistAdd,
}: SongRowProps) {
  const [localStarred, setLocalStarred] = React.useState(!!song.starred)
  const navigate = useNavigate()
  const toggleStar = useToggleStar()

  // 稳定的 handlePlay，只依赖 index 和 onPlayIndex（均为稳定引用）
  const handlePlay = useCallback(() => onPlayIndex(index), [onPlayIndex, index])

  const handleToggleStar = (e: React.MouseEvent) => {
    e.stopPropagation()
    const newStarred = !localStarred
    setLocalStarred(newStarred)
    toggleStar.mutate(
      { id: song.id, type: 'song', isStarred: !newStarred },
      { onError: () => setLocalStarred(!newStarred) }
    )
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
      className={cn(
        'song-row group',
        isCurrentSong && 'bg-accent/60'
      )}
      onClick={handlePlay}
    >
      {/* 行号 / 播放图标（用 CSS group-hover 替代 JS hover state）*/}
      {showIndex && (
        <div className="w-8 text-center flex-shrink-0 relative">
          {/* 默认：行号 */}
          <span className={cn(
            'text-sm tabular-nums group-hover:opacity-0 transition-opacity',
            isCurrentSong ? 'text-primary font-medium' : 'text-muted-foreground'
          )}>
            {isPlaying && isCurrentSong ? (
              <div className="playing-bar">
                <span /><span /><span />
              </div>
            ) : (
              index + 1
            )}
          </span>
          {/* hover/当前：播放按钮（绝对定位叠在行号上）*/}
          <button
            onClick={(e) => { e.stopPropagation(); handlePlay() }}
            className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-foreground hover:text-primary"
          >
            {isPlaying && isCurrentSong ? (
              <div className="playing-bar">
                <span /><span /><span />
              </div>
            ) : (
              <Play className="w-4 h-4" fill="currentColor" />
            )}
          </button>
        </div>
      )}

      {/* 封面 */}
      {showCover && (
        <div className="w-10 h-10 rounded-md overflow-hidden flex-shrink-0">
          <ImageWithFallback
            src={coverUrl}
            alt={song.album}
            fallbackType="album"
            className="w-full h-full"
            customCoverParams={{ type: 'song', title: song.title, artist: song.artist, album: song.album, path: song.path }}
          />
        </div>
      )}

      {/* 歌曲信息 */}
      <div className="flex-1 min-w-0">
        <p className={cn(
          'text-sm font-medium line-clamp-1 transition-colors',
          isCurrentSong ? 'text-primary' : 'text-foreground'
        )}>
          {song.title}
        </p>
        <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
          <span
            onClick={handleNavigateArtist}
            className={cn(
              'transition-colors',
              song.artistId ? 'hover:text-foreground hover:underline cursor-pointer' : ''
            )}
          >
            {song.artist}
          </span>
        </p>
      </div>

      {/* 专辑名（大屏才显示）*/}
      {showAlbum && (
        <div className="hidden lg:block flex-1 min-w-0 px-4">
          <p className="text-sm text-muted-foreground line-clamp-1">
            <span
              onClick={handleNavigateAlbum}
              className={cn(
                'transition-colors',
                song.albumId ? 'hover:text-foreground hover:underline cursor-pointer' : ''
              )}
            >
              {song.album}
            </span>
          </p>
        </div>
      )}

      {/* 收藏按钮（CSS hover 控制显隐）*/}
      <button
        onClick={handleToggleStar}
        disabled={toggleStar.isPending}
        className={cn(
          'transition-all p-2 rounded-full hover:bg-accent flex-shrink-0',
          localStarred
            ? 'opacity-100 text-red-500'
            : 'opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-500'
        )}
      >
        <Heart
          className="w-4 h-4"
          fill={localStarred ? 'currentColor' : 'none'}
        />
      </button>

      {/* 时长 */}
      <span className="text-sm text-muted-foreground tabular-nums w-12 text-right flex-shrink-0">
        {formatDuration(song.duration)}
      </span>

      {/* 更多操作（CSS hover 控制显隐）*/}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            onClick={(e) => e.stopPropagation()}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-2 rounded-full hover:bg-accent flex-shrink-0"
          >
            <MoreHorizontal className="w-4 h-4 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <div className="px-3 py-2 border-b border-border">
            <p className="font-semibold text-sm truncate">{song.title}</p>
            <p className="text-xs text-muted-foreground truncate mt-0.5">{song.artist}</p>
          </div>

          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handlePlay() }} className="gap-2">
            <Play className="w-4 h-4" />
            立即播放
          </DropdownMenuItem>
          <DropdownMenuItem className="gap-2">
            <Plus className="w-4 h-4" />
            下一首播放
          </DropdownMenuItem>
          <DropdownMenuSeparator />

          <DropdownMenuItem onClick={handleToggleStar} className="gap-2">
            <Heart className={cn('w-4 h-4', localStarred ? 'fill-current text-red-500' : '')} />
            {localStarred ? '取消喜欢' : '加入喜欢'}
          </DropdownMenuItem>

          {song.artistId && (
            <DropdownMenuItem onClick={handleNavigateArtist} className="gap-2">
              <Mic2 className="w-4 h-4" />
              查看歌手
            </DropdownMenuItem>
          )}
          {song.albumId && (
            <DropdownMenuItem onClick={handleNavigateAlbum} className="gap-2">
              <Disc3 className="w-4 h-4" />
              查看专辑
            </DropdownMenuItem>
          )}

          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={(e) => { e.stopPropagation(); navigate('/songs/detail', { state: { song } }) }}
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
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">歌曲信息</p>
            {song.duration > 0 && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="w-3 h-3 flex-shrink-0" />
                <span>{formatDuration(song.duration)}</span>
              </div>
            )}
            {song.bitRate && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Music2 className="w-3 h-3 flex-shrink-0" />
                <span>{song.bitRate} kbps</span>
                {song.contentType && (
                  <span className="text-muted-foreground/50">· {song.contentType.split('/')[1]?.toUpperCase()}</span>
                )}
              </div>
            )}
            {song.year && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Info className="w-3 h-3 flex-shrink-0" />
                <span>{song.year} 年</span>
                {song.genre && <span className="text-muted-foreground/50">· {song.genre}</span>}
              </div>
            )}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
})
