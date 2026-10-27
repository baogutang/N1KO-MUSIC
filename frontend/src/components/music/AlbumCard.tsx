/**
 * 专辑卡片组件 —— 封面墙单元（封面是唯一的大面积色块）
 * 封面是一块 cover-tile（抬起的方片，hover 再抬一点），下面两行图注：
 * 专辑名 + 歌手 / 年份。卡片里不再套卡片。
 */

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Play } from '@phosphor-icons/react'
import { findAdapterFor } from '@/api'
import { playAlbum } from '@/utils/playActions'
import { useNavigate } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'
import { CoverCard } from '@/components/common/CoverCard'
import { usePlayerStore } from '@/store/playerStore'
import type { Album, Song } from '@/api/types'
import { useQueryClient } from '@tanstack/react-query'
import { spaceCJK } from '@/utils/cjkTypography'
import { useT } from '@/i18n'

/**
 * 封面右下角的动作簇：鼠标下 hover 才浮现，触屏常显（没有 hover 可等），
 * 键盘聚焦到里面的按钮时也现身。专辑卡、书架、歌单卡共用。
 */
export function CoverActions({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'absolute bottom-2 right-2 flex items-center gap-2 transition-[opacity,transform] duration-200',
        'focus-within:translate-y-0 focus-within:opacity-100',
        '[@media(hover:hover)]:translate-y-1.5 [@media(hover:hover)]:opacity-0',
        '[@media(hover:hover)]:group-hover:translate-y-0 [@media(hover:hover)]:group-hover:opacity-100',
        className
      )}
    >
      {children}
    </div>
  )
}

/** 动作簇里的一粒纸片圆键；hover 时换陶土。触屏 44px，鼠标下收小一点 */
export const CoverActionButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { small?: boolean }
>(({ small = false, className, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    className={cn(
      'grid place-items-center rounded-pill bg-sheet text-ink shadow-press transition-[transform,background-color,color] duration-200 active:scale-[0.94]',
      small
        ? 'h-11 w-11 [@media(hover:hover)]:h-8 [@media(hover:hover)]:w-8'
        : 'h-11 w-11 [@media(hover:hover)]:h-9 [@media(hover:hover)]:w-9',
      '[@media(hover:hover)]:hover:bg-primary [@media(hover:hover)]:hover:text-primary-foreground',
      className
    )}
    {...props}
  />
))
CoverActionButton.displayName = 'CoverActionButton'

interface AlbumCardProps {
  album: Album
  className?: string
}

export function AlbumCard({ album, className }: AlbumCardProps) {
  const { t } = useT()
  const navigate = useNavigate()

  const coverUrl = album.coverArt
    ? (findAdapterFor(album.serverId)?.getCoverUrl(album.coverArt, 300) ?? undefined)
    : undefined

  /* 播整张专辑走共享的 playActions.playAlbum（阶段 8.7） */
  const handlePlay = (e: React.MouseEvent) => {
    e.stopPropagation()
    void playAlbum(album)
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
        <CoverActions>
          <CoverActionButton onClick={handlePlay} aria-label={t('album.playWhole')}>
            <Play className="ml-px h-3.5 w-3.5" weight="fill" />
          </CoverActionButton>
        </CoverActions>
      }
      title={spaceCJK(album.name)}
      meta={
        <>
          <span>{spaceCJK(album.artist)}</span>
          {album.year && <span className="num ml-2">{album.year}</span>}
        </>
      }
    />
  )
}
