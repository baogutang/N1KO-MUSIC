/**
 * 歌手详情页 —— 杂志编辑风（DESIGN v2 §3）
 * 顶部：中小圆形头像居左 + 衬线 900 歌手名 + ink-soft bio（限宽 34em，可展开/收起）
 * 分区：热门歌曲 Top5 / 全部歌曲（默认 20，可展开）/ 专辑封面墙 / 相似歌手文字索引行
 */

import { Fragment, useEffect, useState, useMemo, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Play, Shuffle, CaretDown, CaretUp, MicrophoneStage } from '@phosphor-icons/react'
import { DiscographyRail, type ArtistMarginalia } from '@/components/music/DiscographyRail'
import { MarginNote } from '@/components/music/MarginNote'
import { ArtistDossier } from '@/components/music/ArtistDossier'
import { SongList } from '@/components/music/SongList'
import { useArtistDetail } from '@/hooks/useServerQueries'
import { getAdapter, hasAdapter } from '@/api'
import { playAllInOrder, playAllShuffled } from '@/utils/playActions'
import { useServerStore } from '@/store/serverStore'
import { isQualifiedListeningEvent, readListeningEvents } from '@/services/listeningHistory'
import { cn } from '@/lib/utils'
import { spaceCJK } from '@/utils/cjkTypography'
import { useT } from '@/i18n'

/** 全部歌曲默认展示数量 */
const SONGS_INITIAL_SHOW = 20
/** 热门歌曲展示数量 */
const TOP_SONGS_SHOW = 5

export default function ArtistDetailPage() {
  const { t } = useT()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: artist, isLoading } = useArtistDetail(id ?? '')
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
    const key = artist.name.trim().toLocaleLowerCase()
    const events = readListeningEvents(serverId)
      .filter(e => (e.song.artist ?? '').trim().toLocaleLowerCase() === key)
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

  const handlePlayAlbum = useCallback(async (album: { id: string }) => {
    try {
      const detail = await getAdapter().getAlbumDetail(album.id)
      if (detail.songs.length) playAllInOrder(detail.songs)
    } catch {
      // 拉取失败时不做任何事；用户可以点进专辑页再播
    }
  }, [])

  const serverImageUrl = artist?.artistImageUrl ||
    (artist?.coverArt && hasAdapter() ? getAdapter().getCoverUrl(artist.coverArt, 300) : undefined)

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
      <div className="pt-10 animate-fade-in">
        <div className="flex items-center gap-7">
          <div className="h-28 w-28 flex-shrink-0 rounded-full bg-skeleton animate-pulse" />
          <div className="flex-1 space-y-4">
            <div className="h-3 w-28 rounded-sm bg-skeleton animate-pulse" />
            <div className="h-10 w-1/3 rounded-sm bg-skeleton animate-pulse" />
            <div className="h-3 w-2/3 rounded-sm bg-skeleton animate-pulse" />
          </div>
        </div>
      </div>
    )
  }

  if (!artist) {
    // 整页空白既解释不了发生了什么，也没给出路——连返回都要靠浏览器的后退键
    return (
      <div className="pt-24 max-w-[720px] animate-fade-in">
        <MicrophoneStage className="w-8 h-8 text-ink-faint mb-5" />
        <p className="font-serif text-2xl font-semibold">{t('error.load.title')}</p>
        <p className="mt-2 text-sm text-ink-faint">{t('error.load.description')}</p>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="mt-4 text-sm text-primary underline decoration-hair underline-offset-[6px] hover:decoration-primary transition-colors"
        >
          {t('action.back')}
        </button>
      </div>
    )
  }

  const displayedSongs = showAllSongs ? allSongs : allSongs.slice(0, SONGS_INITIAL_SHOW)
  const hasMoreSongs = allSongs.length > SONGS_INITIAL_SHOW

  return (
    <div className="pt-10 animate-fade-in">
      {/* 头部：中小圆形头像居左 + 衬线 900 歌手名 + bio（无巨大 hero 底图） */}
      <div className="flex flex-col gap-7 sm:flex-row sm:items-start">
        <div className="h-28 w-28 flex-shrink-0 lg:h-32 lg:w-32">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={artist.name}
              className="h-full w-full rounded-full object-cover object-top ring-1 ring-hair-soft"
              onError={() => setImgError(true)}
            />
          ) : (
            <div className="grid h-full w-full place-items-center rounded-full bg-paper-deep ring-1 ring-hair-soft">
              <MicrophoneStage size={26} className="text-ink-faint" />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[11px] uppercase tracking-[0.3em] text-primary">{t('artist.eyebrow')}</p>
          <h1 className="mt-3 font-serif text-4xl font-black tracking-[-0.01em] text-ink text-balance lg:text-5xl">
            {spaceCJK(artist.name)}
          </h1>
          {artist.biography && (
            <div className="mt-4 max-w-[34em]">
              <p className={cn('text-sm leading-[1.8] text-ink-soft', !bioExpanded && 'line-clamp-3')}>
                {artist.biography}
              </p>
              <button
                onClick={() => setBioExpanded(v => !v)}
                className="mt-2 text-xs tracking-[0.14em] text-ink-faint transition-colors duration-200 hover:text-primary"
              >
                {bioExpanded ? `${t('action.collapse')} ↑` : `${t('action.expand')} ↓`}
              </button>
            </div>
          )}
          <div className="mt-6 flex items-center gap-6">
            {playableSongs.length > 0 && (
              <button
                onClick={() => playAllInOrder(playableSongs)}
                className="inline-flex items-center gap-2 border-b border-ink pb-1 text-sm font-semibold tracking-[0.1em] text-ink transition-colors duration-200 hover:border-primary hover:text-primary active:scale-[0.97]"
              >
                <Play size={13} weight="fill" />
                {t('player.playAll')}
              </button>
            )}
            {playableSongs.length > 0 && (
              <button
                onClick={() => playAllShuffled(playableSongs)}
                className="inline-flex items-center gap-2 rounded border border-hair px-3.5 py-1.5 text-[13px] text-ink-soft transition-colors duration-200 hover:border-ink hover:text-ink active:scale-[0.97]"
              >
                <Shuffle size={14} />
                {t('player.shuffle')}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 热门歌曲（Top5） */}
      {topSongs.length > 0 && (
        <section>
          <div className="section-head">
            <h2>{t('section.topSongs')}<small>TOP SONGS</small></h2>
          </div>
          <SongList songs={topSongs.slice(0, TOP_SONGS_SHOW)} showCover showAlbum showIndex />
        </section>
      )}

      {/* 全部歌曲（默认 20 首，可展开） */}
      {allSongs.length > 0 && (
        <section>
          <div className="section-head">
            <h2>{t('section.allSongs')}<small>ALL SONGS</small></h2>
            <span className="more num">{t('song.trackTotal', { count: allSongs.length })}</span>
          </div>
          <SongList songs={displayedSongs} showCover showAlbum showIndex />
          {hasMoreSongs && (
            <div className="mt-6 flex justify-center">
              <button
                onClick={() => setShowAllSongs(!showAllSongs)}
                className="inline-flex items-center gap-2 rounded border border-hair px-4 py-1.5 text-[13px] text-ink-soft transition-colors duration-200 hover:border-ink hover:text-ink active:scale-[0.97]"
              >
                {showAllSongs ? (
                  <>{t('action.collapse')} <CaretUp size={13} /></>
                ) : (
                  <>{t('artist.showAllSongs', { count: allSongs.length })} <CaretDown size={13} /></>
                )}
              </button>
            </div>
          )}
        </section>
      )}

      {/*
        唱片目录：年份轨 + 你自己的历史作页边注。
        此前这里是一片 xl:grid-cols-6 的封面墙——恰恰是设计契约想避免的东西
        （卡片堆叠 + 大面积重复色块），却留在最该体现「生涯」的那一页上。
      */}
      <DiscographyRail
        albums={artist.albums}
        marginalia={marginalia}
        onPlayAlbum={handlePlayAlbum}
      />

      {/* 档案：曲库标签里没有的那部分。默认关闭，见设置「歌手档案」 */}
      <ArtistDossier musicBrainzId={artist.musicBrainzId} className="mt-12" />

      {/* 你自己写的那一条，和上面「你与这位歌手」的自动统计并置：
          一边是行为算出来的，一边是你亲手写的 */}
      <MarginNote target="artist" targetId={artist.id} className="mt-10 max-w-[38em]" />

      {/* 相似歌手：文字索引行（逗号分隔链接） */}
      {artist.similarArtists && artist.similarArtists.length > 0 && (
        <section className="pb-4">
          <div className="section-head">
            <h2>{t('section.similarArtists')}<small>SIMILAR ARTISTS</small></h2>
          </div>
          <p className="font-serif text-lg leading-[2.2] md:text-xl">
            {artist.similarArtists.map((similar, i) => (
              <Fragment key={similar.id}>
                {i > 0 && <span className="text-ink-faint">{t('artist.listSeparator')}</span>}
                <button
                  onClick={() => navigate(`/artists/${similar.id}`)}
                  className="border-b border-transparent transition-colors duration-200 hover:border-primary hover:text-primary"
                >
                  {similar.name}
                </button>
              </Fragment>
            ))}
          </p>
        </section>
      )}
    </div>
  )
}
