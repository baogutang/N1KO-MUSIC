/**
 * 首页（v6 舞台光）
 * 大标题 + 随便听听｜精选专辑（没有卡片，直接落在外壳的光里）｜今天听什么｜
 * 最近添加（封面书架）｜热门歌手（胶囊索引）｜此刻/继续听/重听｜
 * 最常播放与最近播放（书架）｜多源区块
 */

import { useMemo } from 'react'
import { Play, Shuffle } from '@phosphor-icons/react'
import { Link, useNavigate } from 'react-router-dom'
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
import { Button } from '@/components/ui/button'
import { useRecentAlbums, useArtists } from '@/hooks/useServerQueries'
import { usePersonalizedRecommendations } from '@/hooks/usePersonalizedRecommendations'
import { pickFeaturedAlbum, rankArtistsByAffinity } from '@/services/recommendationEngine'
import { findAdapterFor } from '@/api'
import { formatDurationNatural } from '@/utils/formatters'
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

  // 不 memo：几个字符串拼接本来就不值一个 memo，每次渲染直接算更简单。
  const heroMeta = buildHeroMeta(heroAlbum, t)

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
    <div className="pt-2 regular:pt-4">
      {/* ============ 页头：大标题 + 随便听听 ============ */}
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <h1 className="font-display text-[34px] font-bold leading-[1.05] tracking-[-0.03em] text-ink regular:text-[44px]">
          {t('nav.home')}
        </h1>
        <ShuffleAllAction />
      </header>

      {/* ============ 精选专辑：大封面 + 大标题，直接落在外壳的光里 ============ */}
      {heroAlbum && (
        /*
          整块可点（进专辑页），内层「播放整张」自管按键。
          外层的 Enter/Space 只在焦点落在本体上时才算（e.target === currentTarget），
          与封面卡（CoverCard）同一条约定。焦点环走全局 :focus-visible。
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
          className="group mt-8 flex cursor-pointer flex-col gap-6 rounded-lg regular:mt-10 regular:flex-row regular:items-end regular:gap-9"
        >
          <div className="cover-frame aspect-square w-full flex-none shadow-cover transition-transform duration-4 ease-smooth regular:w-[240px] [@media(hover:hover)]:group-hover:-translate-y-1">
            <ImageWithFallback
              src={heroCoverUrl}
              alt={heroAlbum.name}
              fallbackType="album"
              className="h-full w-full object-cover"
              customCoverParams={{ type: 'album', artist: heroAlbum.artist, album: heroAlbum.name }}
            />
          </div>

          <div className="min-w-0 flex-1">
            {/* 比页标题低一级：这一屏只有一个最大的字 */}
            <h2 className="line-clamp-3 text-balance font-display text-[28px] font-bold leading-[1.08] tracking-[-0.03em] text-ink regular:text-[36px]">
              {heroAlbum.name}
            </h2>
            <p className="mt-2 truncate text-[17px] font-semibold text-leaf">{heroAlbum.artist}</p>
            {heroMeta.length > 0 && (
              <div className="num mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[14px] font-medium text-ink-3">
                {heroMeta.map((item, i) => <span key={`${i}:${item}`}>{item}</span>)}
              </div>
            )}
            <Button className="mt-6" onClick={handleHeroPlay}>
              <Play size={16} weight="fill" />
              {t('home.playWholeAlbum')}
            </Button>
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

      {/* ============ 最近添加：封面书架 ============ */}
      <section aria-labelledby="home-recent">
        <div className="section-head">
          <h2 id="home-recent">{t('section.recentlyAdded')}</h2>
          <Link className="more -my-3 py-3" to="/albums">
            {t('home.allAlbums')}
          </Link>
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

      {/* ============ 热门歌手：文字索引 ============ */}
      {!artistsLoading && recommendedArtists.length > 0 && (
        <section aria-labelledby="home-artists">
          <div className="section-head">
            <h2 id="home-artists">{t('section.topArtists')}</h2>
            <Link className="more -my-3 py-3" to="/artists">
              {t('home.allArtists')}
            </Link>
          </div>
          <div className="flex flex-wrap gap-2.5">
            {recommendedArtists.slice(0, 12).map(artist => (
              <button
                key={artist.id}
                onClick={() => navigate(detailPath('artists', artist.id, artist.serverId))}
                className="press-pop inline-flex min-h-11 items-center gap-2 rounded-pill bg-fill px-4 text-[15px] font-semibold text-ink [@media(hover:hover)]:hover:bg-fill-2"
              >
                {spaceCJK(artist.name)}
                {artist.albumCount !== undefined && (
                  <span className="num text-[13px] font-medium text-ink-3">
                    {artist.albumCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ============ 服务器上此刻在放（多用户服务器才出现）============ */}
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
 * 随便听听：服务端取样，不是对首屏那一页洗牌。
 * 原先住在软陶的问候横幅里，横幅随皮肤一起退场，这个动作留下。
 */
function ShuffleAllAction() {
  const { t } = useT()
  return (
    <Button variant="secondary" onClick={() => void shuffleWholeLibrary()}>
      <Shuffle size={17} weight="bold" />
      {t('home.shuffleAll')}
    </Button>
  )
}

/**
 * 头条的元信息：曲目数、总时长、年份、流派，全部是真实数据，各占一个 span，
 * 缺哪项就少哪项，不虚构编辑文案。
 */
function buildHeroMeta(
  album: Album | null,
  t: (key: string, vars?: Record<string, string | number>) => string
): string[] {
  if (!album) return []
  return [
    album.songCount ? t('song.trackCount', { count: album.songCount }) : '',
    album.duration ? formatDurationNatural(album.duration) : '',
    album.year ? String(album.year) : '',
    album.genre ?? '',
  ].filter(Boolean)
}

/** 书架加载骨架：封面方块 + 两行图注，与 CoverShelf 同一套宽度 */
function AlbumShelfSkeleton({ count }: { count: number }) {
  return (
    <CoverShelf>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} aria-hidden="true">
          <div className="cover-frame skeleton mb-3 aspect-square" />
          <div className="skeleton h-4 w-4/5 rounded-sm" />
          <div className="skeleton mt-1.5 h-3.5 w-3/5 rounded-sm" />
        </div>
      ))}
    </CoverShelf>
  )
}
