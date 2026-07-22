/**
 * 歌手卡片组件 —— 去卡片化（DESIGN v2 §3）
 * 圆形头像（歌手语境惯例，全站统一）+ 衬线歌手名 + mono 数量
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
      className={cn('group cursor-pointer text-center min-w-0', className)}
      onClick={() => navigate(`/artists/${artist.id}`)}
    >
      {/* 圆形头像：发丝 ring，hover 微放大 */}
      <div className="relative aspect-square overflow-hidden rounded-full mb-2.5 ring-1 ring-hair-soft transition-transform duration-300 ease-out group-hover:scale-[1.03]">
        <ImageWithFallback
          src={imageUrl}
          alt={artist.name}
          fallbackType="artist"
          className="w-full h-full object-cover"
          customCoverParams={{ type: 'artist', artist: artist.name }}
        />
      </div>

      {/* 图注：衬线歌手名 + mono 数量 */}
      <p className="font-serif font-semibold text-[15px] leading-snug text-foreground truncate group-hover:text-primary transition-colors">
        {artist.name}
      </p>
      {artist.albumCount !== undefined && (
        <p className="text-xs text-ink-faint mt-0.5">
          <span className="font-num">{artist.albumCount}</span> 张专辑
        </p>
      )}
    </div>
  )
}
