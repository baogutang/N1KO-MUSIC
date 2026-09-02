/**
 * 专辑详情页 —— demo 专辑范式（DESIGN v2 §3，demo-editorial .album-head）
 * 左大封面（圆角 6px + 唯一允许的浮层淡投影）｜右元信息：衬线 900 专辑名、
 * 歌手链接、mono 年份·曲目数·总时长、文字级操作行；下方曲目表 = SongList（自带 border-t）
 */

import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { Play, Shuffle, Heart } from '@phosphor-icons/react'
import { SongList } from '@/components/music/SongList'
import { LinerNotes } from '@/components/music/LinerNotes'
import { useAlbumDetail, useToggleStar } from '@/hooks/useServerQueries'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'
import { findAdapterFor } from '@/api'
import { formatDurationNatural } from '@/utils/formatters'
import { playAllInOrder, playAllShuffled } from '@/utils/playActions'
import { cn } from '@/lib/utils'
import { spaceCJK } from '@/utils/cjkTypography'
import { EmptyState } from '@/components/common/EmptyState'
import { MarginNote } from '@/components/music/MarginNote'
import { useT } from '@/i18n'

export default function AlbumDetailPage() {
  const { t } = useT()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { data: album, isLoading } = useAlbumDetail(id ?? '', searchParams.get('src') ?? undefined)
  const toggleStar = useToggleStar()
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
      <div className="pt-10 animate-fade-in">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-[280px_minmax(0,1fr)] lg:gap-14">
          <div className="aspect-square w-60 max-w-[320px] rounded-md bg-skeleton animate-pulse md:w-full" />
          <div className="space-y-4 pt-2">
            <div className="h-3 w-28 rounded-sm bg-skeleton animate-pulse" />
            <div className="h-12 w-2/3 rounded-sm bg-skeleton animate-pulse" />
            <div className="h-3 w-40 rounded-sm bg-skeleton animate-pulse" />
            <div className="h-3 w-56 rounded-sm bg-skeleton animate-pulse" />
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

  // 年份 / 流派 / 曲目数·时长：缺哪段就少哪段，分隔点不留空
  const meta = [
    album.year ? t('album.metaYear', { year: album.year }) : '',
    album.genre ?? '',
    t('song.trackCountDuration', {
      count: album.songs.length,
      duration: formatDurationNatural(totalDuration),
    }),
  ].filter(Boolean).join(' · ')

  return (
    <div className="pt-10 animate-fade-in">
      <div className="grid grid-cols-1 gap-10 md:grid-cols-[280px_minmax(0,1fr)] lg:gap-14">
        {/* 左：大封面（240–320px、圆角 6px、shadow-float，DESIGN §1.3 唯一允许的投影） */}
        <div className="w-60 max-w-[320px] md:w-full">
          <div className="aspect-square overflow-hidden rounded-md ring-1 ring-hair-soft shadow-float">
            <ImageWithFallback
              src={coverUrl}
              alt={album.name}
              fallbackType="album"
              className="w-full h-full"
              customCoverParams={{ type: 'album', artist: album.artist, album: album.name }}
            />
          </div>
        </div>

        {/* 右：元信息 */}
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-[0.3em] text-primary">{t('album.eyebrow')}</p>
          <h1 className="mt-3 font-serif text-[40px] font-black leading-[1.1] tracking-[-0.01em] text-ink text-balance lg:text-[52px]">
            {spaceCJK(album.name)}
          </h1>
          <p className="mt-3 text-sm tracking-[0.06em] text-ink-soft">
            {album.artistId ? (
              <button
                onClick={() => navigate(`/artists/${album.artistId}`)}
                className="border-b border-hair pb-0.5 transition-colors duration-200 hover:border-primary hover:text-primary"
              >
                {spaceCJK(album.artist)}
              </button>
            ) : (
              album.artist
            )}
          </p>
          <p className="num mt-3 text-xs text-ink-faint">{meta}</p>

          {/* 操作行：文字级主操作 + 细线次操作 + 心形图标键（DESIGN §4.1） */}
          <div className="mt-7 flex items-center gap-6">
            <button
              onClick={() => playAllInOrder(album.songs)}
              className="act-primary inline-flex items-center gap-2 border-b border-ink pb-1 text-sm font-semibold tracking-[0.1em] text-ink transition-colors duration-200 hover:border-primary hover:text-primary active:scale-[0.97]"
            >
              <Play size={13} weight="fill" />
              {t('player.playAll')}
            </button>
            <button
              onClick={() => playAllShuffled(album.songs)}
              className="act-secondary inline-flex items-center gap-2 rounded border border-hair px-3.5 py-1.5 text-[13px] text-ink-soft transition-colors duration-200 hover:border-ink hover:text-ink active:scale-[0.97]"
            >
              <Shuffle size={14} />
              {t('player.shuffle')}
            </button>
            <button
              onClick={() => {
                if (!id) return
                const next = !starred
                setStarred(next)
                toggleStar.mutate(
                  { id, type: 'album', isStarred: !next },
                  { onError: () => setStarred(!next) }
                )
              }}
              className={cn(
                'act-icon grid h-9 w-9 place-items-center rounded-full border transition-colors duration-200 active:scale-[0.94]',
                starred
                  ? 'is-on border-primary text-primary'
                  : 'border-hair text-ink-soft hover:border-primary hover:text-primary'
              )}
              aria-label={starred ? t('album.unfavorite') : t('album.favorite')}
            >
              <Heart size={17} weight={starred ? 'fill' : 'regular'} />
            </button>
          </div>
        </div>
      </div>

      {/* 曲目表 / 唱片说明：两个状态共用一条发丝线下的切换 */}
      <div className="mt-12">
        <div className="mb-5 flex items-center gap-8 border-b border-hair">
          {([
            { id: 'tracks' as const, label: t('album.tabTracks'), tag: 'TRACKS' },
            { id: 'notes' as const, label: t('album.tabNotes'), tag: 'LINER NOTES' },
          ]).map(tab => (
            <button
              key={tab.id}
              onClick={() => setView(tab.id)}
              className={cn(
                'relative pb-3 text-[13px] tracking-[0.2em] transition-colors duration-200',
                view === tab.id ? 'font-semibold text-primary' : 'text-ink-soft hover:text-primary'
              )}
              aria-current={view === tab.id ? 'true' : undefined}
            >
              {tab.label}
              <span className="ml-2 font-num text-[9.5px] tracking-[0.16em] text-ink-faint">
                {tab.tag}
              </span>
              {view === tab.id && (
                <span className="absolute -bottom-px left-0 h-[2px] w-6 bg-primary" />
              )}
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
      <MarginNote target="album" targetId={album.id} className="mt-12 max-w-[38em]" />
    </div>
  )
}
