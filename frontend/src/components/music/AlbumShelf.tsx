/**
 * 服务端已经算好的专辑书架。
 *
 * getAlbumList2 有十种排序维度，此前只用了 newest 与 alphabeticalByName 两种，
 * frequent / recent / highest / starred 全都白放着。
 *
 * 渲染成一排横向的封面书架：封面是暖纸页面上唯一的大面积色块，
 * 标题、歌手、次数/年份退到图注里。
 *
 * 同文件导出 AlbumCoverCard：首页「最近添加」用同一张卡，
 * 键盘语义（外层 Enter/Space 进详情、内层播放键自管）由 CoverCard 统一提供。
 */

import { Play } from '@phosphor-icons/react'
import { useNavigate } from 'react-router-dom'
import { findAdapterFor } from '@/api'
import { CoverCard, CoverShelf } from '@/components/common/CoverCard'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'
import { useAlbumShelf, type AlbumShelfType } from '@/hooks/useServerQueries'
import { playAlbum } from '@/utils/playActions'
import { spaceCJK } from '@/utils/cjkTypography'
import { useT } from '@/i18n'
import { detailPath } from '@/utils/detailPath'
import type { Album } from '@/api/types'

/**
 * 书架上的专辑卡：封面 + 标题 + 歌手，右下角悬浮播放键。
 * details 是图注第三行的若干条独立信息（曲目数、年份、播放次数），各占一个 span。
 */
export function AlbumCoverCard({ album, details = [] }: { album: Album; details?: string[] }) {
  const { t } = useT()
  const navigate = useNavigate()
  const coverUrl = album.coverArt
    ? (findAdapterFor(album.serverId)?.getCoverUrl(album.coverArt, 300) ?? undefined)
    : undefined

  return (
    <CoverCard
      aria-label={album.name}
      onClick={() => navigate(detailPath('albums', album.id, album.serverId))}
      tile={
        <ImageWithFallback
          src={coverUrl}
          alt={album.name}
          fallbackType="album"
          className="h-full w-full object-cover"
          customCoverParams={{ type: 'album', artist: album.artist, album: album.name }}
        />
      }
      overlay={
        /* 触屏常显；有 hover 的设备上悬停才浮现，键盘聚焦也会浮现 */
        <button
          type="button"
          onClick={e => {
            e.stopPropagation()
            void playAlbum(album)
          }}
          aria-label={t('album.playLabel', { name: album.name })}
          className="absolute bottom-2 right-2 grid h-11 w-11 place-items-center rounded-pill bg-sheet text-ink shadow-press transition-opacity duration-200 hover:text-primary focus-visible:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
        >
          <Play size={16} weight="fill" />
        </button>
      }
      title={spaceCJK(album.name)}
      meta={spaceCJK(album.artist)}
      captionExtra={
        details.length > 0 ? (
          <p className="num mt-0.5 flex flex-wrap gap-x-3 text-[13px] text-ink-faint">
            {details.map(detail => <span key={detail}>{detail}</span>)}
          </p>
        ) : undefined
      }
    />
  )
}

export function AlbumShelf({
  type,
  label,
  limit = 6,
}: {
  type: AlbumShelfType
  label: string
  limit?: number
}) {
  const { t } = useT()
  const { data, isLoading } = useAlbumShelf(type, limit)
  const albums = data?.items ?? []

  // 服务器没有这个维度的数据（或不支持）时整块不渲染，而不是留一个空标题
  if (isLoading || !albums.length) return null

  return (
    <section aria-labelledby={`shelf-${type}`}>
      <div className="section-head">
        <h2 id={`shelf-${type}`}>{label}</h2>
      </div>
      <CoverShelf>
        {albums.map(album => (
          <AlbumCoverCard
            key={album.id}
            album={album}
            details={
              album.playCount
                ? [t('album.playCount', { count: album.playCount })]
                : album.year
                  ? [String(album.year)]
                  : []
            }
          />
        ))}
      </CoverShelf>
    </section>
  )
}
