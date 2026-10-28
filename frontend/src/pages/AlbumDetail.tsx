/**
 * 专辑详情页
 * 头部是 DetailHero：封面带着自己的光，从点开的卡片飞过来，往下滚时收小；
 * 歌手链接是副标题，年份 / 流派 / 曲目数 / 时长是独立的元信息，动作行一枚青柠主键。
 * 下面是曲目（SongList）或唱片说明（LinerNotes），一枚分段控件切换，再下面是边注。
 */

import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { detailPath } from '@/utils/detailPath'
import { useState, useEffect } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Play, Shuffle, Heart } from '@phosphor-icons/react'
import { SongList } from '@/components/music/SongList'
import { LinerNotes } from '@/components/music/LinerNotes'
import { useAlbumDetail, useToggleStar } from '@/hooks/useServerQueries'
import { useSourceCapabilities } from '@/hooks/useSourceQueries'
import { sourceSupportsFavorites } from '@/services/heartCapability'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'
import { DetailHero } from '@/components/common/DetailHero'
import { SongRowsSkeleton } from '@/components/common/SongRowsSkeleton'
import { Button } from '@/components/ui/button'
import { findAdapterFor } from '@/api'
import { formatDurationNatural } from '@/utils/formatters'
import { playAllInOrder, playAllShuffled } from '@/utils/playActions'
import { cn } from '@/lib/utils'
import { SPRING_SNAPPY } from '@/lib/motion'
import { spaceCJK } from '@/utils/cjkTypography'
import { EmptyState } from '@/components/common/EmptyState'
import { MarginNote } from '@/components/music/MarginNote'
import { useT } from '@/i18n'
import { sourceParam } from '@/lib/sourceParam'

/** 加载骨架：与 DetailHero 同一套网格，封面方块 + 文字条 */
function AlbumSkeleton() {
  return (
    <div className="pb-2 pt-2 regular:pt-4" aria-hidden="true">
      <div className="grid grid-cols-1 items-end justify-items-center gap-6 regular:grid-cols-[220px_minmax(0,1fr)] regular:justify-items-start regular:gap-8 wide:grid-cols-[264px_minmax(0,1fr)] wide:gap-10">
        <div className="skeleton cover-frame aspect-square w-[min(72vw,280px)] regular:w-full" />
        <div className="flex w-full min-w-0 flex-col items-center gap-3 regular:items-start">
          <div className="skeleton h-10 w-2/3 rounded-md regular:h-12" />
          <div className="skeleton h-5 w-40 rounded-md" />
          <div className="skeleton h-4 w-56 rounded-md" />
          <div className="mt-2 flex gap-3">
            <div className="skeleton h-11 w-32 rounded-pill" />
            <div className="skeleton h-11 w-36 rounded-pill" />
          </div>
        </div>
      </div>
      <div className="mt-10">
        <SongRowsSkeleton rows={6} />
      </div>
    </div>
  )
}

export default function AlbumDetailPage() {
  const { t } = useT()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { data: album, isLoading } = useAlbumDetail(id ?? '', sourceParam(searchParams))
  const toggleStar = useToggleStar()
  const reduce = useReducedMotion()
  /* B4：专辑收藏只在源声明 favorites 时给入口 */
  const caps = useSourceCapabilities()
  const canStarAlbum = sourceSupportsFavorites(caps, album?.serverId)
  const [starred, setStarred] = useState(false)
  const [view, setView] = useState<'tracks' | 'notes'>('tracks')

  useEffect(() => {
    if (album) setStarred(!!album.starred)
  }, [album])

  /* 大图 600 保证 264px 的封面在高分屏上清楚；取色只要小图，且与卡片同一张，缓存能直接命中 */
  const adapter = album ? findAdapterFor(album.serverId) : undefined
  const coverUrl = album?.coverArt ? (adapter?.getCoverUrl(album.coverArt, 600) ?? undefined) : undefined
  const paletteUrl = album?.coverArt ? (adapter?.getCoverUrl(album.coverArt, 300) ?? undefined) : undefined

  if (isLoading) {
    return <AlbumSkeleton />
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

  const tabs = [
    { id: 'tracks' as const, label: t('album.tabTracks') },
    { id: 'notes' as const, label: t('album.tabNotes') },
  ]

  return (
    <div>
      <DetailHero
        cover={
          <ImageWithFallback
            src={coverUrl}
            alt={album.name}
            fallbackType="album"
            className="h-full w-full"
            customCoverParams={{ type: 'album', artist: album.artist, album: album.name }}
          />
        }
        coverUrl={paletteUrl}
        title={spaceCJK(album.name)}
        subtitle={
          album.artistId ? (
            <button
              type="button"
              onClick={() => navigate(detailPath('artists', album.artistId, album.serverId))}
              className="inline-flex min-h-11 items-center rounded-sm [@media(hover:hover)]:hover:underline"
            >
              {spaceCJK(album.artist)}
            </button>
          ) : (
            <span className="text-ink-2">{album.artist}</span>
          )
        }
        meta={meta.map((item, i) => (
          <span key={`${i}-${item}`}>{item}</span>
        ))}
        actions={
          <>
            {/* 动作行：播放（青柠，一屏唯一）/ 随机（中性胶囊）/ 收藏（中性圆键） */}
            <Button type="button" onClick={() => playAllInOrder(album.songs)}>
              <Play size={18} weight="fill" />
              {t('player.playAll')}
            </Button>
            <Button type="button" variant="secondary" onClick={() => playAllShuffled(album.songs)}>
              <Shuffle size={18} />
              {t('player.shuffle')}
            </Button>
            {canStarAlbum && (
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="h-11 w-11"
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
                aria-label={starred ? t('album.unfavorite') : t('album.favorite')}
              >
                <Heart size={20} weight={starred ? 'fill' : 'regular'} />
              </Button>
            )}
          </>
        }
      />

      {/* 曲目表 / 唱片说明：一枚分段控件切换，当前项下的滑块按弹簧跟过去 */}
      <div className="mt-10">
        <div className="mb-4 inline-flex max-w-full rounded-pill bg-ink/[0.06] p-1">
          {tabs.map(tab => {
            const active = view === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setView(tab.id)}
                className={cn(
                  'press-pop relative isolate h-9 flex-none whitespace-nowrap rounded-pill px-4 text-[14px] font-semibold [@media(pointer:coarse)]:h-11',
                  active ? 'text-ink' : 'text-ink-3 [@media(hover:hover)]:hover:text-ink-2'
                )}
                aria-current={active ? 'true' : undefined}
              >
                {active && (
                  <motion.span
                    layoutId="album-view-pill"
                    transition={reduce ? { duration: 0 } : SPRING_SNAPPY}
                    aria-hidden="true"
                    className="absolute inset-0 -z-10 rounded-pill seg-pill"
                  />
                )}
                {tab.label}
              </button>
            )
          })}
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
      <MarginNote target="album" targetId={album.id} className="mt-10" />
    </div>
  )
}
