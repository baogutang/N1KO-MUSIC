/**
 * 首页（v5 暖纸）
 * 大标题 + 全库随机｜精选专辑（一张纸片）｜今天听什么｜最近添加（封面书架）｜
 * 热门歌手（胶囊索引）｜此刻/继续听/重听｜最常播放与最近播放（书架）｜多源区块
 */

import { useMemo } from 'react'
import { Play, Shuffle } from '@phosphor-icons/react'
import { useNavigate } from 'react-router-dom'
import { AlbumCoverCard, AlbumShelf } from '@/components/music/AlbumShelf'
import { CoverShelf } from '@/components/common/CoverCard'
import { RediscoveryShelf } from '@/components/music/RediscoveryShelf'
import { ContinueShelf } from '@/components/music/ContinueShelf'
import { NowPlayingOnServer } from '@/components/music/NowPlayingOnServer'
import {
  MergedDailyRail,
  SourceCollections,
  SourceRecommendSheetsRail,
  SourceTopListsRail,
} from '@/components/sources/SourceShelves'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'
import { useRecentAlbums, useArtists } from '@/hooks/useServerQueries'
import { usePersonalizedRecommendations } from '@/hooks/usePersonalizedRecommendations'
import { pickFeaturedAlbum, rankArtistsByAffinity } from '@/services/recommendationEngine'
import { findAdapterFor } from '@/api'
import { formatDuration } from '@/utils/formatters'
import { shuffleWholeLibrary, playAlbum } from '@/utils/playActions'
import type { Album } from '@/api/types'
import { spaceCJK } from '@/utils/cjkTypography'
import { useT } from '@/i18n'
import { detailPath } from '@/utils/detailPath'

export default function HomePage() {
  const { t } = useT()
  const navigate = useNavigate()

  const { data: recentAlbums, isLoading: albumsLoading } = useRecentAlbums(20)
  /* 只要画像（给热门歌手排序用）。推荐列表本身由 MergedDailyRail 负责，
     这里再取一份就是同一份推荐算两遍、发两轮请求。 */
  const { profile } = usePersonalizedRecommendations(20)
  const { data: artists, isLoading: artistsLoading } = useArtists()
  const recommendedArtists = useMemo(
    () => rankArtistsByAffinity(artists ?? [], profile),
    [artists, profile]
  )

  // 本期封面：在最近入库的专辑里按天轮换，同一天内保持稳定
  const heroAlbum = useMemo(() => pickFeaturedAlbum(recentAlbums ?? []), [recentAlbums])
  const heroCoverUrl = heroAlbum?.coverArt
    ? (findAdapterFor(heroAlbum.serverId)?.getCoverUrl(heroAlbum.coverArt, 600) ?? undefined)
    : undefined

  // 不 memo：几句字符串拼接本来就不值一个 memo，每次渲染直接算更简单。
  // （useT 返回的 t 引用其实是随语言变的，放进依赖数组是有效的——
  //  只是这里根本用不着 memo。）
  const heroLede = buildHeroLede(heroAlbum, t)

  const openHero = () => {
    if (heroAlbum) navigate(detailPath('albums', heroAlbum.id, heroAlbum.serverId))
  }

  const handleHeroPlay = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (heroAlbum) void playAlbum(heroAlbum)
  }

  // 精选专辑已展示的那张不再进书架（封面按天轮换，位置不固定，需按 id 排除）
  const recentList = useMemo(
    () => (recentAlbums ?? []).filter(album => album.id !== heroAlbum?.id).slice(0, 12),
    [recentAlbums, heroAlbum]
  )

  return (
    <div className="pt-2 regular:pt-4 animate-fade-in">
      {/* ============ 页头：大标题 + 全库随机 ============ */}
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <h1 className="font-display text-[34px] regular:text-[40px] font-semibold leading-[1.05] tracking-[-0.02em]">
          {t('nav.home')}
        </h1>
        <ShuffleAllAction />
      </header>

      {/* ============ 精选专辑：一张纸片 ============ */}
      {heroAlbum && (
        /*
          整张纸片可点（进专辑页），内层「播放整张」自管按键。
          外层的 Enter/Space 只在焦点落在纸片本身时才算（e.target === currentTarget），
          与封面卡（CoverCard）同一条约定。
        */
        <article
          role="button"
          tabIndex={0}
          aria-label={t('album.viewLabel', { name: heroAlbum.name })}
          onClick={openHero}
          onKeyDown={e => {
            if (e.target !== e.currentTarget) return
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              openHero()
            }
          }}
          className="sheet mt-6 flex cursor-pointer flex-col gap-5 p-4 transition-shadow duration-200 focus-visible:outline-none motion-reduce:transition-none [@media(hover:hover)]:hover:shadow-float focus-visible:ring-2 focus-visible:ring-primary/40 regular:flex-row regular:items-center regular:gap-7 regular:p-5"
        >
          <div className="cover-slab aspect-square w-full flex-none overflow-hidden bg-paper-deep regular:w-[220px] wide:w-[260px]">
            <ImageWithFallback
              src={heroCoverUrl}
              alt={heroAlbum.name}
              fallbackType="album"
              className="h-full w-full object-cover"
              customCoverParams={{ type: 'album', artist: heroAlbum.artist, album: heroAlbum.name }}
            />
          </div>

          <div className="min-w-0 flex-1">
            <h2 className="font-display text-balance text-[26px] font-semibold leading-[1.1] tracking-[-0.02em] regular:text-[32px]">
              {heroAlbum.name}
            </h2>
            <p className="mt-2 text-[15px] font-medium text-ink-soft">{heroAlbum.artist}</p>
            {heroLede && (
              <p className="mt-3 max-w-[46ch] text-[14px] leading-relaxed text-ink-faint">
                {heroLede}
              </p>
            )}
            <button
              type="button"
              onClick={handleHeroPlay}
              className="act-primary mt-5 inline-flex items-center gap-2 text-[14px]"
            >
              <Play size={14} weight="fill" />
              {t('home.playWholeAlbum')}
            </button>
          </div>
        </article>
      )}

      {/*
        「今天听什么」紧跟头条。
        它此前排在整页最底下，三源用户要滑过八块纯主库内容才看得见——
        而这恰恰是多音源最有价值的一块。上下半页数据来源完全不同，
        「像拼起来的」有一半是这个顺序造成的。
      */}
      <MergedDailyRail />

      {/* ============ 最近添加 · 封面书架 ============ */}
      <section aria-labelledby="home-recent">
        <div className="section-head">
          <h2 id="home-recent">{t('section.recentlyAdded')}</h2>
          <button className="more -my-3 py-3" onClick={() => navigate('/albums')}>
            {t('home.allAlbums')}
          </button>
        </div>
        {albumsLoading ? (
          <AlbumShelfSkeleton count={6} />
        ) : recentList.length > 0 ? (
          <CoverShelf>
            {recentList.map(album => (
              <AlbumCoverCard
                key={album.id}
                album={album}
                details={[
                  album.songCount ? t('song.trackCount', { count: album.songCount }) : '',
                  album.year ? String(album.year) : '',
                ].filter(Boolean)}
              />
            ))}
          </CoverShelf>
        ) : null}
      </section>

      {/* ============ 热门歌手 · 文字索引 ============ */}
      {!artistsLoading && recommendedArtists.length > 0 && (
        <section aria-labelledby="home-artists">
          <div className="section-head">
            <h2 id="home-artists">{t('section.topArtists')}</h2>
            <button className="more -my-3 py-3" onClick={() => navigate('/artists')}>
              {t('home.allArtists')}
            </button>
          </div>
          <div className="flex flex-wrap gap-2.5">
            {recommendedArtists.slice(0, 12).map(artist => (
              <button
                key={artist.id}
                onClick={() => navigate(detailPath('artists', artist.id, artist.serverId))}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-pill bg-sheet px-4 text-[15px] font-medium shadow-press transition-[transform,color] duration-200 hover:text-primary motion-reduce:transition-none [@media(hover:hover)]:hover:-translate-y-px"
              >
                {spaceCJK(artist.name)}
                {artist.albumCount !== undefined && (
                  <span className="num text-[13px] font-normal text-ink-faint">
                    {artist.albumCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ============ 此刻 · 服务器上（多用户服务器才出现）============ */}
      <NowPlayingOnServer />

      {/* ============ 服务端已算好的书架：最常播放 / 最近播放 ============ */}
      {/* 重听：从自己的历史里翻出来的，放在「最常播放」之前——
          最常播放是你已经知道的，这一栏才是你忘了的 */}
      <ContinueShelf />

      <RediscoveryShelf />

      <AlbumShelf type="frequent" label={t('section.mostPlayed')} limit={6} />
      <AlbumShelf type="recent" label={t('nav.history')} limit={6} />

      {/* ============ 多源区块（PLAN 2.3）：各源歌单入口 / 榜单 / 推荐歌单 ============ */}
      {/* 三块都是「有内容才渲染」：单源用户看不到任何变化 */}
      <SourceCollections />
      <SourceTopListsRail />
      <SourceRecommendSheetsRail />
    </div>
  )
}

/**
 * 全库随机：服务端取样，不是对首屏那一页洗牌。
 * 原先住在软陶的问候横幅里，横幅随皮肤一起退场，这个动作留下。
 */
function ShuffleAllAction() {
  const { t } = useT()
  return (
    <button
      type="button"
      className="act-secondary inline-flex items-center gap-2"
      onClick={() => void shuffleWholeLibrary()}
    >
      <Shuffle size={17} weight="bold" />
      {t('home.shuffleAll')}
    </button>
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

/** 书架加载骨架：封面方块 + 两行图注，与 CoverShelf 同一套宽度 */
function AlbumShelfSkeleton({ count }: { count: number }) {
  return (
    <CoverShelf>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} aria-hidden="true">
          <div className="mb-3 aspect-square rounded-md bg-skeleton animate-pulse motion-reduce:animate-none" />
          <div className="h-4 w-4/5 rounded-sm bg-skeleton animate-pulse motion-reduce:animate-none" />
          <div className="mt-1.5 h-3.5 w-3/5 rounded-sm bg-skeleton animate-pulse motion-reduce:animate-none" />
        </div>
      ))}
    </CoverShelf>
  )
}
