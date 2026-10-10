/**
 * 专辑卡片组件 —— 封面墙单元（「封面即内容」）
 * 编辑风：纯封面 + 图注，无卡片边框与阴影盒。
 * 波普：  封面是描边 + 硬投影的实体砖，图注不变。
 */

import { Play } from '@phosphor-icons/react'
import { useNavigate } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'
import { CoverCard } from '@/components/common/CoverCard'
import { usePlayerStore } from '@/store/playerStore'
import { findAdapterFor, getAdapterFor } from '@/api'
import type { Album, Song } from '@/api/types'
import { useQueryClient } from '@tanstack/react-query'
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
      // 尝试从缓存获取专辑详情（键带来源，与 useAlbumDetail 一致）
      const cacheKey = [album.serverId, 'albums', album.id] as const
      const cached = queryClient.getQueryData(cacheKey)
      if (cached && (cached as { songs?: unknown[] }).songs) {
        const detail = cached as { songs: Song[] }
        playListFrom(detail.songs)
        return
      }
      // 否则先播放第一首
      const detail = await getAdapterFor(album.serverId).getAlbumDetail(album.id)
      queryClient.setQueryData(cacheKey, detail)
      if (detail.songs.length) {
        playListFrom(detail.songs)
      }
    } catch (err) {
      console.error('Failed to play album:', err)
    }
  }

  // 详情按专辑来源解析（多源下主库路由会打错适配器）；缓存键同样带来源
  const detailHref = `/albums/${album.id}?src=${encodeURIComponent(album.serverId)}`

  /* 外壳与封面砖样式收敛到 CoverCard（阶段 7.4），播放键与图注是本卡的语义 */
  return (
    <CoverCard
      className={className}
      aria-label={album.name}
      onClick={() => navigate(detailHref)}
      tile={
        <ImageWithFallback
          src={coverUrl}
          alt={album.name}
          fallbackType="album"
          className="w-full h-full object-cover"
          customCoverParams={{ type: 'album', artist: album.artist, album: album.name }}
        />
      }
      overlay={
        /* 播放键：细线圆，hover 浮现；再 hover 填充 accent */
        <button
          onClick={handlePlay}
          aria-label={t('album.playWhole')}
          className="absolute right-2.5 bottom-2.5 w-9 h-9 rounded-full border border-paper/80 bg-ink/25 text-paper flex items-center justify-center opacity-0 translate-y-1.5 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-200 hover:bg-primary hover:border-primary active:scale-[0.94] pop:border-hair pop:bg-primary pop:text-primary-foreground pop:shadow-press"
        >
          <Play className="w-3.5 h-3.5 ml-px" weight="fill" />
        </button>
      }
      title={spaceCJK(album.name)}
      meta={
        <>
          <span className="text-ink-soft">{spaceCJK(album.artist)}</span>
          {album.year && <span className="ml-1 font-num text-ink-faint">· {album.year}</span>}
        </>
      }
    />
  )
}
