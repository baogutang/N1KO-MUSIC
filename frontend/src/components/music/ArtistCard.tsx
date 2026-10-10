/**
 * 歌手卡片组件 —— 去卡片化（DESIGN v2 §3）
 * 圆形头像（歌手语境惯例，全站统一）+ 衬线歌手名 + mono 数量
 */

import { useNavigate } from 'react-router-dom'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'
import { CoverCard } from '@/components/common/CoverCard'
import { findAdapterFor } from '@/api'
import type { Artist } from '@/api/types'
import { useT } from '@/i18n'

interface ArtistCardProps {
  artist: Artist
  className?: string
}

export function ArtistCard({ artist, className }: ArtistCardProps) {
  const { t } = useT()
  const navigate = useNavigate()

  const imageUrl = artist.artistImageUrl ||
    (artist.coverArt
      ? (findAdapterFor(artist.serverId)?.getCoverUrl(artist.coverArt, 300) ?? undefined)
      : undefined)

  /* 外壳收敛到 CoverCard（round：歌手语境的圆形头像），居中图注 */
  return (
    <CoverCard
      round
      centered
      className={className}
      aria-label={artist.name}
      onClick={() => navigate(`/artists/${artist.id}?src=${encodeURIComponent(artist.serverId)}`)}
      tile={
        <ImageWithFallback
          src={imageUrl}
          alt={artist.name}
          fallbackType="artist"
          className="w-full h-full object-cover"
          customCoverParams={{ type: 'artist', artist: artist.name }}
        />
      }
      title={artist.name}
      {...(artist.albumCount !== undefined
        ? { meta: <span className="font-num">{t('artist.albumCountShort', { count: artist.albumCount ?? 0 })}</span> }
        : {})}
    />
  )
}
