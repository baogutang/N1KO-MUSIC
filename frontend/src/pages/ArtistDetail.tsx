/**
 * 歌手详情页 —— 杂志编辑风（DESIGN v2 §3）
 * 顶部：中小圆形头像居左 + 衬线 900 歌手名 + ink-soft bio（限宽 34em，可展开/收起）
 * 分区：热门歌曲 Top5 / 全部歌曲（默认 20，可展开）/ 专辑封面墙 / 相似歌手文字索引行
 */

import { useEffect, useState, useMemo } from 'react'
import { detailPath } from '@/utils/detailPath'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { Play, Shuffle, CaretDown, CaretUp, MicrophoneStage } from '@phosphor-icons/react'
import { DiscographyRail, type ArtistMarginalia } from '@/components/music/DiscographyRail'
import { MarginNote } from '@/components/music/MarginNote'
import { ArtistDossier } from '@/components/music/ArtistDossier'
import { SongList } from '@/components/music/SongList'
import { useArtistDetail } from '@/hooks/useServerQueries'
import { findAdapterFor, getAdapterFor } from '@/api'
import { playAllInOrder, playAllShuffled, playAlbum } from '@/utils/playActions'
import { artistKey } from '@/utils/songIdentity'
import { ErrorState } from '@/components/common/ErrorState'
import { useServerStore } from '@/store/serverStore'
import { isQualifiedListeningEvent, readListeningEvents } from '@/services/listeningHistory'
import { cn } from '@/lib/utils'
import { spaceCJK } from '@/utils/cjkTypography'
import { useT } from '@/i18n'
import { sourceParam } from '@/lib/sourceParam'

/** 全部歌曲默认展示数量 */
const SONGS_INITIAL_SHOW = 20
/** 热门歌曲展示数量 */
const TOP_SONGS_SHOW = 5

export default function ArtistDetailPage() {
  const { t } = useT()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { data: artist, isLoading } = useArtistDetail(id ?? '', sourceParam(searchParams))
  const [showAllSongs, setShowAllSongs] = useState(false)
  const [bioExpanded, setBioExpanded] = useState(false)
  const [imgError, setImgError] = useState(false)

  // 相似歌手跳转是同路由组件复用：切歌手时重置头像失败态，否则新歌手永远显示占位符
  useEffect(() => {
    setImgError(false)
  }, [artist?.id])

  /**
   * 页边注：你自己与这位歌手的关系。
   * 全部来自本地收听历史，不需要任何额外请求。
   */
  const serverId = useServerStore(st => st.activeServerId)
  const marginalia: ArtistMarginalia | undefined = useMemo(() => {
    if (!artist?.name || !serverId) return undefined
    const key = artistKey(artist.name)
    const events = readListeningEvents(serverId)
      .filter(e => artistKey(e.song.artist ?? '') === key)
    if (!events.length) return undefined

    const qualified = events.filter(isQualifiedListeningEvent)
    const albumCounts = new Map<string, number>()
    for (const e of qualified) {
      if (!e.song.album) continue
      albumCounts.set(e.song.album, (albumCounts.get(e.song.album) ?? 0) + 1)
    }
    const favourite = Array.from(albumCounts.entries()).sort((a, b) => b[1] - a[1])[0]
    const playedAlbums = new Set(qualified.map(e => e.song.albumId ?? e.song.album))

    return {
      firstHeardAt: Math.min(...events.map(e => e.endedAt)),
      lastHeardAt: Math.max(...events.map(e => e.endedAt)),
      plays: qualified.length,
      favouriteAlbum: favourite?.[0],
      neverPlayedAlbums: (artist.albums ?? [])
        .filter(a => !playedAlbums.has(a.id) && !playedAlbums.has(a.name)).length,
    }
  }, [artist?.name, artist?.albums, serverId])

  /* 播整张专辑走共享的 playActions.playAlbum（阶段 8.7，缓存优先策略归一） */
  /* 播整张专辑走共享的 playActions.playAlbum（阶段 8.7，缓存优先策略归一） */
  const handlePlayAlbum = (album: { id: string; serverId: string }) => { void playAlbum(album) }

  const serverImageUrl = artist?.artistImageUrl ||
    (artist?.coverArt ? (findAdapterFor(artist.serverId)?.getCoverUrl(artist.coverArt, 300) ?? undefined) : undefined)

  const imageUrl = (serverImageUrl && !imgError) ? serverImageUrl : undefined

  // 优先使用 songs（全部歌曲），其次 topSongs
  const allSongs = artist?.songs ?? []
  const rawTopSongs = artist?.topSongs ?? []
  // Navidrome 的 /getTopSongs 需要 Last.fm 集成，未配置时为空
  // 兜底策略：topSongs 为空时取 allSongs 前 10 首展示
  const topSongs = rawTopSongs.length > 0 ? rawTopSongs : allSongs.slice(0, 10)
  const playableSongs = allSongs.length > 0 ? allSongs : topSongs

  if (isLoading) {
    return (
      <div className="pt-2 regular:pt-4 animate-fade-in" aria-hidden="true">
        <div className="flex flex-col gap-6 regular:flex-row regular:items-center regular:gap-8">
          <div className="h-36 w-36 flex-shrink-0 rounded-pill bg-skeleton animate-pulse regular:h-40 regular:w-40" />
          <div className="flex-1 space-y-4">
            <div className="h-10 w-1/3 rounded-sm bg-skeleton animate-pulse" />
            <div className="h-3.5 w-2/3 rounded-sm bg-skeleton animate-pulse" />
            <div className="flex gap-3 pt-2">
              <div className="h-11 w-28 rounded-pill bg-skeleton animate-pulse" />
              <div className="h-11 w-28 rounded-pill bg-skeleton animate-pulse" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!artist) {
    // 整页空白既解释不了发生了什么，也没给出路——连返回都要靠浏览器的后退键
    return (
      <div className="pt-4 max-w-[720px] animate-fade-in">
        <ErrorState ruled={false} onBack={() => navigate(-1)} />
      </div>
    )
  }

  const displayedSongs = showAllSongs ? allSongs : allSongs.slice(0, SONGS_INITIAL_SHOW)
  const hasMoreSongs = allSongs.length > SONGS_INITIAL_SHOW

  return (
    <div className="pt-2 regular:pt-4 animate-fade-in">
      {/* 头部：圆形头像 + 歌手名 + bio + 动作行 */}
      <header className="flex flex-col gap-6 regular:flex-row regular:items-center regular:gap-8">
        <div className="h-36 w-36 flex-shrink-0 overflow-hidden rounded-pill bg-paper-deep shadow-float regular:h-40 regular:w-40">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={artist.name}
              className="h-full w-full object-cover object-top"
              onError={() => setImgError(true)}
            />
          ) : (
            <div className="grid h-full w-full place-items-center">
              <MicrophoneStage size={32} className="text-ink-faint" />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[34px] regular:text-[40px] font-semibold leading-[1.05] tracking-[-0.02em] text-balance">
            {spaceCJK(artist.name)}
          </h1>
          {artist.biography && (
            <div className="mt-3 max-w-[34em]">
              <p className={cn('text-sm leading-[1.8] text-ink-soft', !bioExpanded && 'line-clamp-3')}>
                {artist.biography}
              </p>
              <button
                onClick={() => setBioExpanded(v => !v)}
                className="inline-flex min-h-11 items-center gap-1 text-[13px] font-medium text-primary underline-offset-4 hover:underline"
              >
                {bioExpanded ? t('action.collapse') : t('action.expand')}
                {bioExpanded ? <CaretUp size={13} /> : <CaretDown size={13} />}
              </button>
            </div>
          )}
          {playableSongs.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                onClick={() => playAllInOrder(playableSongs)}
                className="act-primary inline-flex items-center gap-2 text-sm"
              >
                <Play size={15} weight="fill" />
                {t('player.playAll')}
              </button>
              <button
                onClick={() => playAllShuffled(playableSongs)}
                className="act-secondary inline-flex items-center gap-2 text-sm"
              >
                <Shuffle size={15} />
                {t('player.shuffle')}
              </button>
            </div>
          )}
        </div>
      </header>

      {/* 热门歌曲（Top5） */}
      {topSongs.length > 0 && (
        <section>
          <div className="section-head">
            <h2>{t('section.topSongs')}</h2>
          </div>
          <SongList songs={topSongs.slice(0, TOP_SONGS_SHOW)} showCover showAlbum showIndex />
        </section>
      )}

      {/* 全部歌曲（默认 20 首，可展开） */}
      {allSongs.length > 0 && (
        <section>
          <div className="section-head">
            <h2>{t('section.allSongs')}</h2>
            <span className="num text-sm text-ink-faint">{t('song.trackTotal', { count: allSongs.length })}</span>
          </div>
          <SongList songs={displayedSongs} showCover showAlbum showIndex />
          {hasMoreSongs && (
            <div className="mt-6 flex justify-center">
              <button
                onClick={() => setShowAllSongs(!showAllSongs)}
                className="act-secondary inline-flex items-center gap-2 text-sm"
              >
                {showAllSongs ? (
                  <>{t('action.collapse')} <CaretUp size={14} /></>
                ) : (
                  <>{t('artist.showAllSongs', { count: allSongs.length })} <CaretDown size={14} /></>
                )}
              </button>
            </div>
          )}
        </section>
      )}

      {/* 唱片目录：横向书架，按年份倒序；你自己的收听历史是书架下的一张纸片 */}
      <DiscographyRail
        albums={artist.albums}
        marginalia={marginalia}
        onPlayAlbum={handlePlayAlbum}
      />

      {/* 档案：曲库标签里没有的那部分。默认关闭，见设置「歌手档案」 */}
      <ArtistDossier musicBrainzId={artist.musicBrainzId} className="mt-10" />

      {/* 你自己写的那一条，和上面「你与这位歌手」的自动统计并置：
          一边是行为算出来的，一边是你亲手写的 */}
      <MarginNote target="artist" targetId={artist.id} className="mt-10 max-w-[38em]" />

      {/* 相似歌手：一排纸片胶囊 */}
      {artist.similarArtists && artist.similarArtists.length > 0 && (
        <section className="pb-4">
          <div className="section-head">
            <h2>{t('section.similarArtists')}</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {artist.similarArtists.map(similar => (
              <button
                key={similar.id}
                onClick={() => navigate(detailPath('artists', similar.id, similar.serverId ?? serverId))}
                className="press-pop inline-flex min-h-11 items-center rounded-pill bg-sheet px-4 text-[14.5px] font-medium text-ink shadow-press hover:text-primary"
              >
                {similar.name}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
