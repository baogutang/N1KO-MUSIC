/**
 * 歌手卡片组件
 * 圆形头像（歌手语境惯例，全站统一，抬起一层卡片投影）+ 歌手名 + 专辑数
 */

import { useNavigate } from 'react-router-dom'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'
import { CoverCard } from '@/components/common/CoverCard'
import { findAdapterFor } from '@/api'
import type { Artist } from '@/api/types'
import { useT } from '@/i18n'
import { detailPath } from '@/utils/detailPath'

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
      onClick={() => navigate(detailPath('artists', artist.id, artist.serverId))}
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
        ? { meta: <span className="num">{t('artist.albumCountShort', { count: artist.albumCount ?? 0 })}</span> }
        : {})}
    />
  )
}
