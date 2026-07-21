/**
 * 专辑卡片组件
 * 用于网格列表展示专辑
 */

import { Play } from '@phosphor-icons/react'
import { useNavigate } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'
import { usePlayerStore } from '@/store/playerStore'
import { getAdapter, hasAdapter } from '@/api'
import type { Album } from '@/api/types'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/hooks/useServerQueries'

interface AlbumCardProps {
  album: Album
  className?: string
}

export function AlbumCard({ album, className }: AlbumCardProps) {
  const navigate = useNavigate()
  const playSong  = usePlayerStore(s => s.playSong)
  const playQueue = usePlayerStore(s => s.playQueue)
  const queryClient = useQueryClient()

  const coverUrl = album.coverArt && hasAdapter()
    ? getAdapter().getCoverUrl(album.coverArt, 300)
    : undefined

  const handlePlay = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      // 尝试从缓存获取专辑详情
      const cached = queryClient.getQueryData(queryKeys.albumDetail(album.id))
      if (cached && (cached as { songs?: unknown[] }).songs) {
        const detail = cached as { songs: Parameters<typeof playQueue>[0] }
        playQueue(detail.songs as Parameters<typeof playQueue>[0])
        return
      }
      // 否则先播放第一首
      const detail = await getAdapter().getAlbumDetail(album.id)
      queryClient.setQueryData(queryKeys.albumDetail(album.id), detail)
      if (detail.songs.length) {
        playQueue(detail.songs)
      }
    } catch (err) {
      console.error('Failed to play album:', err)
    }
  }

  return (
    <div
      className={cn('group cursor-pointer min-w-0', className)}
      onClick={() => navigate(`/albums/${album.id}`)}
    >
      {/* 封面 */}
      <div className="relative mb-3">
        <div className="aspect-square overflow-hidden rounded-lg ring-1 ring-border shadow-md transition-all duration-300 ease-out group-hover:-translate-y-1 group-hover:shadow-xl">
          <ImageWithFallback
            src={coverUrl}
            alt={album.name}
            fallbackType="album"
            className="w-full h-full object-cover"
            customCoverParams={{ type: 'album', artist: album.artist, album: album.name }}
          />
        </div>
        {/* 播放按钮悬停浮现 */}
        <button
          onClick={handlePlay}
          className="absolute right-2.5 bottom-2.5 w-[38px] h-[38px] rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg opacity-0 translate-y-1.5 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-200 hover:brightness-110 active:scale-[0.94]"
        >
          <Play className="w-[17px] h-[17px] ml-0.5" weight="fill" />
        </button>
      </div>

      {/* 信息 */}
      <div className="min-w-0 px-1 pb-2">
        <p className="font-medium text-sm text-foreground truncate group-hover:text-primary transition-colors">
          {album.name}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">
          {album.artist}
          {album.year && (
            <span className="ml-1 font-num text-muted-foreground/60">· {album.year}</span>
          )}
        </p>
      </div>
    </div>
  )
}
