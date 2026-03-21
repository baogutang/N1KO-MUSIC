/**
 * 专辑卡片组件
 * 用于网格列表展示专辑
 */

import { Play } from 'lucide-react'
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
      className={cn('music-card group cursor-pointer', className)}
      onClick={() => navigate(`/albums/${album.id}`)}
    >
      {/* 封面 */}
      <div className="relative aspect-square overflow-hidden rounded-lg mb-3">
        <ImageWithFallback
          src={coverUrl}
          alt={album.name}
          fallbackType="album"
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          customCoverParams={{ type: 'album', artist: album.artist, album: album.name }}
        />
        {/* 播放按钮悬停效果 */}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-end justify-end p-3">
          <button
            onClick={handlePlay}
            className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-xl hover:scale-105 active:scale-95 transition-transform"
          >
            <Play className="w-4 h-4 ml-0.5" fill="currentColor" />
          </button>
        </div>
      </div>

      {/* 信息 */}
      <div className="px-1 pb-2">
        <p className="font-medium text-sm text-foreground line-clamp-1 group-hover:text-primary transition-colors">
          {album.name}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
          {album.artist}
          {album.year && (
            <span className="ml-1 text-muted-foreground/60">· {album.year}</span>
          )}
        </p>
      </div>
    </div>
  )
}
