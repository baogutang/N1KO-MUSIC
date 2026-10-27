/**
 * 专辑详情页
 * 头部：wide / regular 两栏（左 cover-slab 大封面，右 专辑名、歌手链接、元信息、动作行），
 * compact 封面在上、信息在下。下面是曲目（SongList）或唱片说明（sheet 卡片），再下面是边注卡。
 */

import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { detailPath } from '@/utils/detailPath'
import { useState, useEffect } from 'react'
import { Play, Shuffle, Heart } from '@phosphor-icons/react'
import { SongList } from '@/components/music/SongList'
import { LinerNotes } from '@/components/music/LinerNotes'
import { useAlbumDetail, useToggleStar } from '@/hooks/useServerQueries'
import { useSourceCapabilities } from '@/hooks/useSourceQueries'
import { sourceSupportsFavorites } from '@/services/heartCapability'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'
import { findAdapterFor } from '@/api'
import { formatDurationNatural } from '@/utils/formatters'
import { playAllInOrder, playAllShuffled } from '@/utils/playActions'
import { cn } from '@/lib/utils'
import { spaceCJK } from '@/utils/cjkTypography'
import { EmptyState } from '@/components/common/EmptyState'
import { MarginNote } from '@/components/music/MarginNote'
import { useT } from '@/i18n'
import { sourceParam } from '@/lib/sourceParam'

/** 头部两栏：compact 封面在上；regular 左 260；wide 左 300 */
const HEADER_GRID = 'grid grid-cols-1 items-end gap-6 regular:grid-cols-[260px_minmax(0,1fr)] regular:gap-8 wide:grid-cols-[300px_minmax(0,1fr)] wide:gap-10'

export default function AlbumDetailPage() {
  const { t } = useT()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { data: album, isLoading } = useAlbumDetail(id ?? '', sourceParam(searchParams))
  const toggleStar = useToggleStar()
  /* B4：专辑收藏只在源声明 favorites 时给入口 */
  const caps = useSourceCapabilities()
  const canStarAlbum = sourceSupportsFavorites(caps, album?.serverId)
  const [starred, setStarred] = useState(false)
  const [view, setView] = useState<'tracks' | 'notes'>('tracks')

  useEffect(() => {
    if (album) setStarred(!!album.starred)
  }, [album])

  const coverUrl = album?.coverArt
    ? (findAdapterFor(album.serverId)?.getCoverUrl(album.coverArt, 600) ?? undefined)
    : undefined

  if (isLoading) {
    return (
      <div className="pt-2 regular:pt-4 animate-fade-in" aria-hidden="true">
        <div className={HEADER_GRID}>
          <div className="aspect-square w-full max-w-[300px] rounded-md bg-skeleton animate-pulse regular:max-w-none" />
          <div className="space-y-4">
            <div className="h-10 w-2/3 rounded-sm bg-skeleton animate-pulse" />
            <div className="h-4 w-40 rounded-sm bg-skeleton animate-pulse" />
            <div className="h-3.5 w-56 rounded-sm bg-skeleton animate-pulse" />
            <div className="flex gap-3 pt-3">
              <div className="h-11 w-28 rounded-pill bg-skeleton animate-pulse" />
              <div className="h-11 w-32 rounded-pill bg-skeleton animate-pulse" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!album) {
    return (
      <EmptyState
        title={t('empty.album.title')}
        description={t('empty.album.description')}
      />
    )
  }

  const totalDuration = album.songs.reduce((s, r) => s + r.duration, 0)

  // 年份 / 流派 / 曲目数 / 总时长：缺哪段就少哪段，各自独立成 span，不用分隔点串
  const meta = [
    album.year ? t('album.metaYear', { year: album.year }) : '',
    album.genre ?? '',
    t('song.trackCount', { count: album.songs.length }),
    formatDurationNatural(totalDuration),
  ].filter(Boolean)

  return (
    <div className="pt-2 regular:pt-4 animate-fade-in">
      <header className={HEADER_GRID}>
        {/* 左（compact 在上）：大封面 */}
        <div className="cover-slab aspect-square w-full max-w-[300px] overflow-hidden bg-paper-deep regular:max-w-none">
          <ImageWithFallback
            src={coverUrl}
            alt={album.name}
            fallbackType="album"
            className="w-full h-full"
            customCoverParams={{ type: 'album', artist: album.artist, album: album.name }}
          />
        </div>

        {/* 右：元信息 + 动作行 */}
        <div className="min-w-0">
          <h1 className="font-display text-[34px] regular:text-[40px] font-semibold leading-[1.05] tracking-[-0.02em] text-balance">
            {spaceCJK(album.name)}
          </h1>
          <p className="mt-1 text-[17px] font-medium">
            {album.artistId ? (
              <button
                onClick={() => navigate(detailPath('artists', album.artistId, album.serverId))}
                className="inline-flex min-h-11 items-center text-primary underline-offset-4 [@media(hover:hover)]:hover:underline"
              >
                {spaceCJK(album.artist)}
              </button>
            ) : (
              <span className="text-ink-soft">{album.artist}</span>
            )}
          </p>
          <p className="num flex flex-wrap gap-x-3 gap-y-1 text-sm text-ink-faint">
            {meta.map(item => (
              <span key={item}>{item}</span>
            ))}
          </p>

          {/* 动作行：播放（强调色实心）/ 随机（纸片胶囊）/ 收藏（圆形纸片键） */}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              onClick={() => playAllInOrder(album.songs)}
              className="act-primary inline-flex items-center gap-2 text-sm"
            >
              <Play size={15} weight="fill" />
              {t('player.playAll')}
            </button>
            <button
              onClick={() => playAllShuffled(album.songs)}
              className="act-secondary inline-flex items-center gap-2 text-sm"
            >
              <Shuffle size={15} />
              {t('player.shuffle')}
            </button>
            {canStarAlbum && (
              <button
                onClick={() => {
                  if (!id) return
                  const next = !starred
                  setStarred(next)
                  toggleStar.mutate(
                    // 专辑收藏要按专辑自己的来源走，不能落到主库
                    { id, type: 'album', isStarred: !next, serverId: album.serverId },
                    { onError: () => setStarred(!next) }
                  )
                }}
                className={cn('act-icon grid place-items-center', starred && 'is-on')}
                aria-label={starred ? t('album.unfavorite') : t('album.favorite')}
              >
                <Heart size={18} weight={starred ? 'fill' : 'regular'} className={starred ? 'text-sem-fav' : undefined} />
              </button>
            )}
          </div>
        </div>
      </header>

      {/* 曲目表 / 唱片说明：一枚分段控件切换 */}
      <div className="mt-10">
        <div className="mb-4 inline-flex max-w-full gap-1 overflow-x-auto rounded-pill bg-paper-deep p-1 scrollbar-hide">
          {([
            { id: 'tracks' as const, label: t('album.tabTracks') },
            { id: 'notes' as const, label: t('album.tabNotes') },
          ]).map(tab => (
            <button
              key={tab.id}
              onClick={() => setView(tab.id)}
              className={cn(
                'seg-option min-h-11 flex-none whitespace-nowrap rounded-pill px-5 text-[14px] font-medium transition-colors duration-150',
                view === tab.id
                  ? 'is-on'
                  : 'text-ink-soft [@media(hover:hover)]:hover:text-ink'
              )}
              aria-current={view === tab.id ? 'true' : undefined}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {view === 'tracks' ? (
          <SongList
            songs={album.songs}
            showCover={false}
            showAlbum={false}
            showIndex
          />
        ) : (
          <LinerNotes album={album} />
        )}
      </div>

      {/* 边注：内页说明是唱片公司写的，这一条是你写的 */}
      <MarginNote target="album" targetId={album.id} className="mt-10 max-w-[38em]" />
    </div>
  )
}
