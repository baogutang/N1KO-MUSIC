/**
 * 专辑卡片组件 —— 封面墙单元（「封面即内容」）
 * 编辑风：纯封面 + 图注，无卡片边框与阴影盒。
 * 波普：  封面是描边 + 硬投影的实体砖，图注不变。
 */

import { Play } from '@phosphor-icons/react'
import { useNavigate } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'
import { usePlayerStore } from '@/store/playerStore'
import { findAdapterFor, getAdapterFor } from '@/api'
import type { Album, Song } from '@/api/types'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/hooks/useServerQueries'
import { playListFrom } from '@/utils/playActions'
import { spaceCJK } from '@/utils/cjkTypography'
import { useT } from '@/i18n'

interface AlbumCardProps {
  album: Album
  className?: string
}

export function AlbumCard({ album, className }: AlbumCardProps) {
  const { t } = useT()
  const navigate = useNavigate()
  const playSong  = usePlayerStore(s => s.playSong)
  const queryClient = useQueryClient()

  const coverUrl = album.coverArt
    ? (findAdapterFor(album.serverId)?.getCoverUrl(album.coverArt, 300) ?? undefined)
    : undefined

  const handlePlay = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      // 尝试从缓存获取专辑详情
      const cached = queryClient.getQueryData(queryKeys.albumDetail(album.id))
      if (cached && (cached as { songs?: unknown[] }).songs) {
        const detail = cached as { songs: Song[] }
        playListFrom(detail.songs)
        return
      }
      // 否则先播放第一首
      const detail = await getAdapterFor(album.serverId).getAlbumDetail(album.id)
      queryClient.setQueryData(queryKeys.albumDetail(album.id), detail)
      if (detail.songs.length) {
        playListFrom(detail.songs)
      }
    } catch (err) {
      console.error('Failed to play album:', err)
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn('group cursor-pointer min-w-0', className)}
      onClick={() => navigate(`/albums/${album.id}`)}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          navigate(`/albums/${album.id}`)
        }
      }}
    >
      {/* 封面砖：编辑风 hover 微放大；波普是描边实体块，hover 往左上抬起（见 .cover-tile） */}
      <div className="relative mb-2.5">
        <div className="cover-tile aspect-square overflow-hidden rounded-md ring-1 ring-hair-soft pop:ring-0">
          <ImageWithFallback
            src={coverUrl}
            alt={album.name}
            fallbackType="album"
            className="w-full h-full object-cover"
            customCoverParams={{ type: 'album', artist: album.artist, album: album.name }}
          />
        </div>
        {/* 播放键：细线圆，hover 浮现；再 hover 填充 accent */}
        <button
          onClick={handlePlay}
          aria-label={t('album.playWhole')}
          className="absolute right-2.5 bottom-2.5 w-9 h-9 rounded-full border border-paper/80 bg-ink/25 text-paper flex items-center justify-center opacity-0 translate-y-1.5 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-200 hover:bg-primary hover:border-primary active:scale-[0.94] pop:border-hair pop:bg-primary pop:text-primary-foreground pop:shadow-press"
        >
          <Play className="w-3.5 h-3.5 ml-px" weight="fill" />
        </button>
      </div>

      {/* 图注：衬线专辑名 + 小字歌手 */}
      <div className="min-w-0 px-0.5">
        <p className="font-serif font-semibold text-[15px] leading-snug text-foreground truncate group-hover:text-primary transition-colors">
          {spaceCJK(album.name)}
        </p>
        <p className="text-xs text-ink-soft mt-0.5 truncate">
          {spaceCJK(album.artist)}
          {album.year && (
            <span className="ml-1 font-num text-ink-faint">· {album.year}</span>
          )}
        </p>
      </div>
    </div>
  )
}
