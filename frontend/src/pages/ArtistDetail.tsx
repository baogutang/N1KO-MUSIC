/**
 * 歌手详情页
 * 头部是 DetailHero（圆形头像带着自己的光，往下滚时收小），简介在头部下面（限宽、可展开/收起）。
 * 分区：热门歌曲 Top5（服务端给了才显示）/ 全部歌曲（默认 20，可展开）/ 唱片目录书架 / 档案 / 边注 / 相似歌手
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { detailPath } from '@/utils/detailPath'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { Play, Shuffle, MicrophoneStage } from '@phosphor-icons/react'
import { DiscographyRail, type ArtistMarginalia } from '@/components/music/DiscographyRail'
import { MarginNote } from '@/components/music/MarginNote'
import { ArtistDossier } from '@/components/music/ArtistDossier'
import { SongList } from '@/components/music/SongList'
import { useArtistDetail } from '@/hooks/useServerQueries'
import { findAdapterFor, getAdapterFor } from '@/api'
import { playAllInOrder, playAllShuffled, playAlbum } from '@/utils/playActions'
import { artistKey } from '@/utils/songIdentity'
import { ErrorState } from '@/components/common/ErrorState'
import { DetailHero } from '@/components/common/DetailHero'
import { Button } from '@/components/ui/button'
import { useServerStore } from '@/store/serverStore'
import { isQualifiedListeningEvent, readListeningEvents } from '@/services/listeningHistory'
import { cn } from '@/lib/utils'
import { spaceCJK } from '@/utils/cjkTypography'
import { htmlToPlainText } from '@/utils/plainText'
import { useT } from '@/i18n'
import { sourceParam } from '@/lib/sourceParam'

/** 全部歌曲默认展示数量 */
const SONGS_INITIAL_SHOW = 20
/** 热门歌曲展示数量 */
const TOP_SONGS_SHOW = 5

/** 加载骨架：与 DetailHero 同一套网格，圆形头像 + 文字条 */
function ArtistSkeleton() {
  return (
    <div className="pb-2 pt-2 regular:pt-4" aria-hidden="true">
      <div className="grid grid-cols-1 items-end justify-items-center gap-6 regular:grid-cols-[220px_minmax(0,1fr)] regular:justify-items-start regular:gap-8 wide:grid-cols-[264px_minmax(0,1fr)] wide:gap-10">
        <div className="skeleton cover-frame aspect-square w-[min(72vw,280px)] rounded-full regular:w-full" />
        <div className="flex w-full min-w-0 flex-col items-center gap-3 regular:items-start">
          <div className="skeleton h-10 w-1/2 rounded-md regular:h-12" />
          <div className="skeleton h-4 w-40 rounded-md" />
          <div className="mt-2 flex gap-3">
            <div className="skeleton h-11 w-32 rounded-pill" />
            <div className="skeleton h-11 w-36 rounded-pill" />
          </div>
        </div>
      </div>
    </div>
  )
}

export default function ArtistDetailPage() {
  const { t } = useT()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { data: artist, isLoading } = useArtistDetail(id ?? '', sourceParam(searchParams))
  const [showAllSongs, setShowAllSongs] = useState(false)
  const [bioExpanded, setBioExpanded] = useState(false)
  const [imgError, setImgError] = useState(false)

  // 相似歌手跳转是同路由组件复用：切歌手时重置头像失败态，否则新歌手永远显示占位符；
  // 简介的展开态同理——上一位展开了，这一位不该带着「收起」进来
  useEffect(() => {
    setImgError(false)
    setBioExpanded(false)
  }, [artist?.id])

  /**
   * 简介：服务端给的常是带标签的 HTML（Last.fm 原文），转成纯文本再显示。
   *
   * 「展开」只在文字真的被三行截断时才出现，靠量排版结果：折叠时 scrollHeight > clientHeight。
   * 没有按字数判断——同样的字数，CJK 与拉丁字母、窄屏与宽屏，占的行数差很多，字数阈值要么漏要么多。
   * 展开后内容撑满框，scrollHeight === clientHeight，量不出来，所以展开期间沿用折叠时的结论
   * （「收起」键必须留着）。框宽变了（旋转、分栏）要重量，故挂 ResizeObserver。
   */
  const bio = useMemo(() => htmlToPlainText(artist?.biography), [artist?.biography])
  const bioRef = useRef<HTMLParagraphElement>(null)
  const [bioClamped, setBioClamped] = useState(false)
  useLayoutEffect(() => {
    const el = bioRef.current
    if (!el || bioExpanded) return
    const measure = () => setBioClamped(el.scrollHeight > el.clientHeight + 1)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [bio, bioExpanded])

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
  const handlePlayAlbum = (album: { id: string; serverId: string }) => { void playAlbum(album) }

  const serverImageUrl = artist?.artistImageUrl ||
    (artist?.coverArt ? (findAdapterFor(artist.serverId)?.getCoverUrl(artist.coverArt, 300) ?? undefined) : undefined)

  const imageUrl = (serverImageUrl && !imgError) ? serverImageUrl : undefined

  // 优先使用 songs（全部歌曲），其次 topSongs
  const allSongs = artist?.songs ?? []
  // Navidrome 的 /getTopSongs 需要 Last.fm 集成，未配置时为空。
  // 没有就整节不显示：拿全部歌曲的前几首顶上，只是把下面「全部歌曲」的开头再列一遍。
  const topSongs = artist?.topSongs ?? []
  const playableSongs = allSongs.length > 0 ? allSongs : topSongs

  if (isLoading) {
    return <ArtistSkeleton />
  }

  if (!artist) {
    // 整页空白既解释不了发生了什么，也没给出路——连返回都要靠浏览器的后退键
    return (
      <div className="mx-auto max-w-[560px] pt-6">
        <ErrorState ruled={false} onBack={() => navigate(-1)} />
      </div>
    )
  }

  const displayedSongs = showAllSongs ? allSongs : allSongs.slice(0, SONGS_INITIAL_SHOW)
  const hasMoreSongs = allSongs.length > SONGS_INITIAL_SHOW
  const albumCount = artist.albums?.length ?? 0

  return (
    <div>
      {/* 头部：圆形头像 + 歌手名 + 专辑数 / 曲目数 + 动作行 */}
      <DetailHero
        round
        cover={
          imageUrl ? (
            <img
              src={imageUrl}
              alt={artist.name}
              className="h-full w-full object-cover object-top"
              onError={() => setImgError(true)}
            />
          ) : (
            <div className="grid h-full w-full place-items-center text-ink-3">
              <MicrophoneStage className="h-1/3 w-1/3" aria-hidden="true" />
            </div>
          )
        }
        coverUrl={imageUrl}
        title={spaceCJK(artist.name)}
        meta={
          albumCount > 0 || allSongs.length > 0 ? (
            <>
              {albumCount > 0 && <span>{t('album.count', { count: albumCount })}</span>}
              {allSongs.length > 0 && <span>{t('song.count', { count: allSongs.length })}</span>}
            </>
          ) : undefined
        }
        actions={
          playableSongs.length > 0 ? (
            <>
              <Button type="button" onClick={() => playAllInOrder(playableSongs)}>
                <Play size={18} weight="fill" />
                {t('player.playAll')}
              </Button>
              <Button type="button" variant="secondary" onClick={() => playAllShuffled(playableSongs)}>
                <Shuffle size={18} />
                {t('player.shuffle')}
              </Button>
            </>
          ) : undefined
        }
      />

      {/* 简介：限宽的正文，三行折叠，可展开 */}
      {bio && (
        <div className="mt-6 max-w-[65ch]">
          <p
            ref={bioRef}
            className={cn('whitespace-pre-line text-[15px] leading-[1.75] text-ink-2', !bioExpanded && 'line-clamp-3')}
          >
            {bio}
          </p>
          {(bioClamped || bioExpanded) && (
            <button
              type="button"
              onClick={() => setBioExpanded(v => !v)}
              aria-expanded={bioExpanded}
              className="inline-flex min-h-11 items-center text-[14px] font-semibold text-leaf underline-offset-4 hover:underline"
            >
              {bioExpanded ? t('action.collapse') : t('action.expand')}
            </button>
          )}
        </div>
      )}

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
            <span className="num text-[14px] text-ink-3">{t('song.trackTotal', { count: allSongs.length })}</span>
          </div>
          <SongList songs={displayedSongs} showCover showAlbum showIndex />
          {hasMoreSongs && (
            <div className="mt-6 flex justify-center">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setShowAllSongs(!showAllSongs)}
                aria-expanded={showAllSongs}
              >
                {showAllSongs
                  ? t('action.collapse')
                  : t('artist.showAllSongs', { count: allSongs.length })}
              </Button>
            </div>
          )}
        </section>
      )}

      {/* 唱片目录：横向书架，按年份倒序；你自己的收听历史是书架下的一块安静面板 */}
      <DiscographyRail
        albums={artist.albums}
        marginalia={marginalia}
        onPlayAlbum={handlePlayAlbum}
      />

      {/* 档案：曲库标签里没有的那部分。默认关闭，见设置「歌手档案」 */}
      <ArtistDossier musicBrainzId={artist.musicBrainzId} />

      {/* 你自己写的那一条，和上面「你与这位歌手」的自动统计并置：
          一边是行为算出来的，一边是你亲手写的 */}
      <MarginNote target="artist" targetId={artist.id} className="mt-10" />

      {/* 相似歌手：一排中性胶囊 */}
      {artist.similarArtists && artist.similarArtists.length > 0 && (
        <section className="pb-4">
          <div className="section-head">
            <h2>{t('section.similarArtists')}</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {artist.similarArtists.map(similar => (
              <button
                key={similar.id}
                type="button"
                onClick={() => navigate(detailPath('artists', similar.id, similar.serverId ?? serverId))}
                className="press-pop inline-flex min-h-11 items-center rounded-pill bg-fill px-4 text-[14px] font-semibold text-ink-2 hover:bg-fill-2 hover:text-ink"
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
