/**
 * 首页 —— 杂志封面页（DESIGN v2 §3，demo 首页范式）
 * 首屏「本期封面」头条区（最新专辑）｜最近添加编号行｜热门歌手文字索引｜为你推荐编号列表
 */

import { Fragment, useCallback, useMemo } from 'react'
import { ArrowsClockwise, Play, Shuffle } from '@phosphor-icons/react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { SongList } from '@/components/music/SongList'
import { AlbumShelf } from '@/components/music/AlbumShelf'
import { RediscoveryShelf } from '@/components/music/RediscoveryShelf'
import { NowPlayingOnServer } from '@/components/music/NowPlayingOnServer'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'
import { useRecentAlbums, useArtists, queryKeys } from '@/hooks/useServerQueries'
import { usePersonalizedRecommendations } from '@/hooks/usePersonalizedRecommendations'
import { pickFeaturedAlbum, rankArtistsByAffinity } from '@/services/recommendationEngine'
import { usePlayerStore } from '@/store/playerStore'
import { getAdapter, hasAdapter } from '@/api'
import { formatDuration } from '@/utils/formatters'
import { playAllInOrder, playAllShuffled, playListFrom } from '@/utils/playActions'
import type { Album, Song } from '@/api/types'
import { spaceCJK } from '@/utils/cjkTypography'
import { useT } from '@/i18n'

export default function HomePage() {
  const { t } = useT()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data: recentAlbums, isLoading: albumsLoading } = useRecentAlbums(20)
  const {
    data: randomSongs,
    isFetching: songsFetching,
    refresh: refreshSongs,
    profile,
  } = usePersonalizedRecommendations(30)
  const { data: artists, isLoading: artistsLoading } = useArtists()
  const recommendedArtists = useMemo(
    () => rankArtistsByAffinity(artists ?? [], profile),
    [artists, profile]
  )

  // 本期封面：在最近入库的专辑里按天轮换，同一天内保持稳定
  const heroAlbum = useMemo(() => pickFeaturedAlbum(recentAlbums ?? []), [recentAlbums])
  const heroCoverUrl = heroAlbum?.coverArt && hasAdapter()
    ? getAdapter().getCoverUrl(heroAlbum.coverArt, 600)
    : undefined

  // 不 memo：几句字符串拼接本来就不值一个 memo，每次渲染直接算更简单。
  // （useT 返回的 t 引用其实是随语言变的，放进依赖数组是有效的——
  //  只是这里根本用不着 memo。）
  const heroLede = buildHeroLede(heroAlbum, t)

  // 播放整张专辑（先查缓存再拉详情，与 AlbumCard 同一策略）
  const playAlbum = useCallback(
    async (album: Album) => {
      try {
        const cached = queryClient.getQueryData(queryKeys.albumDetail(album.id))
        if (cached && (cached as { songs?: unknown[] }).songs) {
          playListFrom((cached as { songs: Song[] }).songs)
          return
        }
        const detail = await getAdapter().getAlbumDetail(album.id)
        queryClient.setQueryData(queryKeys.albumDetail(album.id), detail)
        if (detail.songs.length) playListFrom(detail.songs)
      } catch (err) {
        console.error('Failed to play album:', err)
      }
    },
    [queryClient]
  )

  const handleHeroPlay = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (heroAlbum) void playAlbum(heroAlbum)
  }

  // 头条区已展示的那张不再进编号行（封面按天轮换，位置不固定，需按 id 排除）
  const recentList = useMemo(
    () => (recentAlbums ?? []).filter(album => album.id !== heroAlbum?.id).slice(0, 12),
    [recentAlbums, heroAlbum]
  )

  return (
    <div className="animate-fade-in">
      {/* ============ 本期封面 · 头条区 ============ */}
      {heroAlbum && (
        <article className="grid grid-cols-1 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] items-center gap-10 lg:gap-14 pt-10 pb-12 border-b border-hair">
          <div className="min-w-0">
            <p className="flex items-center gap-3.5 mb-5 text-[11px] tracking-[0.34em] text-primary">
              {t('home.featuredAlbum')}
              <span aria-hidden className="h-px w-14 bg-primary" />
            </p>
            <h1
              className="font-serif font-black text-[36px] lg:text-[48px] leading-[1.08] tracking-[-0.01em] text-balance cursor-pointer hover:text-primary transition-colors duration-200"
              onClick={() => navigate(`/albums/${heroAlbum.id}`)}
            >
              {heroAlbum.name}
            </h1>
            <p className="num mt-3 text-[12px] tracking-[0.16em] text-ink-soft">
              {heroAlbum.artist}
              {heroAlbum.year ? ` · ${heroAlbum.year}` : ''}
            </p>
            {heroLede && (
              <p className="mt-5 max-w-[46ch] text-[14px] leading-relaxed text-ink-soft">
                {heroLede}
              </p>
            )}
            <div className="mt-7 flex items-center gap-7">
              <button
                onClick={handleHeroPlay}
                className="inline-flex items-center gap-2.5 pb-1.5 text-[13.5px] font-semibold tracking-[0.12em] text-foreground border-b border-foreground hover:text-primary hover:border-primary transition-colors duration-200 active:scale-[0.97]"
              >
                <span aria-hidden>▶</span>
                {t('home.playWholeAlbum')}
              </button>
              {heroAlbum.songCount ? (
                <span className="num text-[11.5px] tracking-[0.14em] text-ink-faint">
                  {heroAlbum.duration
                    ? t('song.trackCountDuration', {
                        count: heroAlbum.songCount,
                        duration: formatDuration(heroAlbum.duration),
                      })
                    : t('song.trackCount', { count: heroAlbum.songCount })}
                </span>
              ) : null}
            </div>
          </div>

          <figure className="group w-full max-w-[300px] lg:justify-self-end">
            <button
              onClick={() => navigate(`/albums/${heroAlbum.id}`)}
              aria-label={t('album.viewLabel', { name: heroAlbum.name })}
              className="block w-full aspect-square rounded-md overflow-hidden ring-1 ring-hair-soft shadow-float rotate-[1.5deg] transition-all duration-300 group-hover:rotate-0 group-hover:-translate-y-1.5"
            >
              <ImageWithFallback
                src={heroCoverUrl}
                alt={heroAlbum.name}
                fallbackType="album"
                className="w-full h-full object-cover"
                customCoverParams={{ type: 'album', artist: heroAlbum.artist, album: heroAlbum.name }}
              />
            </button>
            <figcaption className="mt-4 text-right text-[11px] tracking-[0.16em] text-ink-faint">
              {heroAlbum.year
                ? t('album.captionWithYear', {
                    name: heroAlbum.name,
                    artist: heroAlbum.artist,
                    year: heroAlbum.year,
                  })
                : t('album.caption', { name: heroAlbum.name, artist: heroAlbum.artist })}
            </figcaption>
          </figure>
        </article>
      )}

      {/* ============ 最近添加 · 编号行 ============ */}
      <section aria-labelledby="home-recent">
        <div className="section-head">
          <h2 id="home-recent">
            {t('section.recentlyAdded')}<small>RECENTLY ADDED</small>
          </h2>
          <button className="more" onClick={() => navigate('/albums')}>
            {t('home.allAlbums')} →
          </button>
        </div>
        {albumsLoading ? (
          <AlbumRowsSkeleton rows={6} />
        ) : recentList.length > 0 ? (
          <ol className="border-t border-hair">
            {recentList.map((album, i) => (
              <RecentAlbumRow
                key={album.id}
                album={album}
                index={i}
                onOpen={() => navigate(`/albums/${album.id}`)}
                onPlay={() => void playAlbum(album)}
              />
            ))}
          </ol>
        ) : null}
      </section>

      {/* ============ 热门歌手 · 文字索引 ============ */}
      {!artistsLoading && recommendedArtists.length > 0 && (
        <section aria-labelledby="home-artists">
          <div className="section-head">
            <h2 id="home-artists">
              {t('section.topArtists')}<small>ARTISTS A–Z</small>
            </h2>
            <button className="more" onClick={() => navigate('/artists')}>
              {t('home.allArtists')} →
            </button>
          </div>
          <p className="font-serif text-[20px] lg:text-[26px] font-semibold leading-[2.1]">
            {recommendedArtists.slice(0, 12).map((artist, i) => (
              <Fragment key={artist.id}>
                {i > 0 && (
                  <span aria-hidden className="mx-2 align-middle text-[0.7em] font-normal text-ink-faint">
                    ·
                  </span>
                )}
                <button
                  onClick={() => navigate(`/artists/${artist.id}`)}
                  className="border-b border-transparent hover:text-primary hover:border-primary transition-colors duration-200"
                >
                  {spaceCJK(artist.name)}
                  {artist.albumCount !== undefined && (
                    <span className="num ml-1.5 align-middle text-[11px] font-normal text-ink-faint">
                      {artist.albumCount}
                    </span>
                  )}
                </button>
              </Fragment>
            ))}
          </p>
        </section>
      )}

      {/* ============ 此刻 · 服务器上（多用户服务器才出现）============ */}
      <NowPlayingOnServer />

      {/* ============ 服务端已算好的书架：最常播放 / 最近播放 ============ */}
      {/* 重听：从自己的历史里翻出来的，放在「最常播放」之前——
          最常播放是你已经知道的，这一栏才是你忘了的 */}
      <RediscoveryShelf />

      <AlbumShelf type="frequent" label={t('section.mostPlayed')} tag="MOST PLAYED" limit={6} />
      <AlbumShelf type="recent" label={t('nav.history')} tag="RECENTLY PLAYED" limit={6} />

      {/*
        ============ 为你推荐 · 编号列表 ============
        门只看「有没有数据」，不看「是不是在加载」：否则点「换一批」时
        整个区块连同按钮自己一起被卸载，加载完再整块闪回。
      */}
      {randomSongs && randomSongs.length > 0 && (
        <section aria-labelledby="home-for-you">
          <div className="section-head">
            <h2 id="home-for-you">
              {t('section.forYou')}<small>FOR YOU</small>
            </h2>
            <div className="flex items-baseline gap-7">
              <span className="num text-[11.5px] tracking-[0.12em] text-ink-faint">
                {t('song.trackCountDuration', {
                  count: randomSongs.length,
                  duration: formatDuration(randomSongs.reduce((s, r) => s + r.duration, 0)),
                })}
              </span>
              <button
                className="more inline-flex items-center gap-1.5"
                onClick={() => playAllInOrder(randomSongs, 0)}
              >
                <Play size={12} />
                {t('player.playAll')}
              </button>
              <button
                className="more inline-flex items-center gap-1.5"
                onClick={() => playAllShuffled(randomSongs, 0)}
              >
                <Shuffle size={12} />
                {t('player.shuffle')}
              </button>
              <button
                className="more inline-flex items-center gap-1.5"
                onClick={refreshSongs}
                disabled={songsFetching}
              >
                <ArrowsClockwise size={12} className={songsFetching ? 'animate-spin' : undefined} />
                {t('action.newBatch')}
              </button>
            </div>
          </div>
          <SongList songs={randomSongs.slice(0, 15)} showCover showAlbum showIndex />
        </section>
      )}
    </div>
  )
}

/**
 * 头条说明：全部由真实数据拼成（曲目数/总时长/年份/流派），不虚构编辑文案。
 * 两句之间怎么接由 home.heroLedePair 决定——中文句号自带右侧留白，英文要一个空格。
 */
function buildHeroLede(
  album: Album | null,
  t: (key: string, vars?: Record<string, string | number>) => string
): string {
  if (!album) return ''
  const sentences: string[] = []
  if (album.songCount) {
    sentences.push(
      album.duration
        ? t('home.heroTracksDuration', {
            count: album.songCount,
            duration: formatDuration(album.duration),
          })
        : t('home.heroTracks', { count: album.songCount })
    )
  }
  if (album.year && album.genre) {
    sentences.push(t('home.heroYearGenre', { year: album.year, genre: album.genre }))
  } else if (album.year) {
    sentences.push(t('home.heroYear', { year: album.year }))
  } else if (album.genre) {
    sentences.push(t('home.heroGenre', { genre: album.genre }))
  }
  if (sentences.length === 2) {
    return t('home.heroLedePair', { first: sentences[0], second: sentences[1] })
  }
  return sentences[0] ?? ''
}

/** 最近添加编号行：mono 序号｜小封面｜衬线专辑名｜歌手｜mono 元数据｜hover 细线圆播放键 */
function RecentAlbumRow({
  album,
  index,
  onOpen,
  onPlay,
}: {
  album: Album
  index: number
  onOpen: () => void
  onPlay: () => void
}) {
  const { t } = useT()
  const coverUrl = album.coverArt && hasAdapter()
    ? getAdapter().getCoverUrl(album.coverArt, 64)
    : undefined

  const meta = [
    album.songCount ? t('song.trackCount', { count: album.songCount }) : '',
    album.year ? String(album.year) : '',
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <li className="border-b border-hair-soft">
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpen()
          }
        }}
        className="group flex items-center gap-5 px-2 py-2.5 cursor-pointer transition-all duration-200 hover:bg-paper-deep/60 hover:translate-x-1"
      >
        <span className="num w-8 flex-shrink-0 text-center text-xs text-ink-faint transition-colors group-hover:text-primary">
          {String(index + 1).padStart(2, '0')}
        </span>
        <span className="w-[52px] h-[52px] flex-shrink-0 rounded-sm overflow-hidden ring-1 ring-hair-soft">
          <ImageWithFallback
            src={coverUrl}
            alt={album.name}
            fallbackType="album"
            className="w-full h-full object-cover"
            customCoverParams={{ type: 'album', artist: album.artist, album: album.name }}
          />
        </span>
        <span className="flex-1 min-w-0 font-serif text-[16px] font-semibold truncate transition-colors group-hover:text-primary">
          {spaceCJK(album.name)}
        </span>
        <span className="hidden md:block flex-1 min-w-0 text-[13px] text-ink-soft truncate">
          {spaceCJK(album.artist)}
        </span>
        <span className="num flex-shrink-0 text-right text-[11.5px] text-ink-faint">{meta}</span>
        <button
          onClick={e => {
            e.stopPropagation()
            onPlay()
          }}
          aria-label={t('album.playLabel', { name: album.name })}
          className="w-[30px] h-[30px] flex-shrink-0 grid place-items-center rounded-full border border-hair text-ink-soft transition-all duration-200 hover:bg-primary hover:border-primary hover:text-paper active:scale-[0.94] [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-visible:opacity-100"
        >
          <Play size={11} weight="fill" />
        </button>
      </div>
    </li>
  )
}

/** 编号行加载骨架（hair-soft 行闪烁，DESIGN §4.5） */
function AlbumRowsSkeleton({ rows }: { rows: number }) {
  return (
    <ol className="border-t border-hair">
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="flex items-center gap-5 px-2 py-2.5 border-b border-hair-soft">
          <span className="w-8 h-3 rounded-sm bg-skeleton animate-pulse" />
          <span className="w-[52px] h-[52px] rounded-sm bg-skeleton animate-pulse" />
          <span className="flex-1 h-4 rounded-sm bg-skeleton animate-pulse" />
          <span className="hidden md:block flex-1 h-3.5 rounded-sm bg-skeleton animate-pulse" />
          <span className="w-16 h-3.5 rounded-sm bg-skeleton animate-pulse" />
        </li>
      ))}
    </ol>
  )
}
