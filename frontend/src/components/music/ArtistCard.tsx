/**
 * 歌手卡片组件
 */

import { useNavigate } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'
import { getAdapter, hasAdapter } from '@/api'
import type { Artist } from '@/api/types'

interface ArtistCardProps {
  artist: Artist
  className?: string
}

export function ArtistCard({ artist, className }: ArtistCardProps) {
  const navigate = useNavigate()

  const imageUrl = artist.artistImageUrl ||
    (artist.coverArt && hasAdapter()
      ? getAdapter().getCoverUrl(artist.coverArt, 300)
      : undefined)

  return (
    <div
      className={cn('group cursor-pointer text-center', className)}
      onClick={() => navigate(`/artists/${artist.id}`)}
    >
      {/* 圆形头像 */}
      <div className="relative aspect-square overflow-hidden rounded-full mb-3 ring-2 ring-transparent group-hover:ring-primary transition-all duration-300">
        <ImageWithFallback
          src={imageUrl}
          alt={artist.name}
          fallbackType="artist"
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
          customCoverParams={{ type: 'artist', artist: artist.name }}
        />
      </div>

      {/* 名字 */}
      <p className="font-medium text-sm text-foreground line-clamp-1 group-hover:text-primary transition-colors">
        {artist.name}
      </p>
      {artist.albumCount !== undefined && (
        <p className="text-xs text-muted-foreground mt-0.5">
          {artist.albumCount} 张专辑
        </p>
      )}
    </div>
  )
}
