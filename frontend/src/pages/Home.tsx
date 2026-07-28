/**
 * 首页 —— 杂志封面页（DESIGN v2 §3，demo 首页范式）
 * 首屏「本期封面」头条区（最新专辑）｜最近添加编号行｜热门歌手文字索引｜为你推荐编号列表
 */

import { Fragment, useCallback, useMemo } from 'react'
import { ArrowsClockwise, Play, Shuffle } from '@phosphor-icons/react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { SongList } from '@/components/music/SongList'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'
import { useRecentAlbums, useArtists, queryKeys } from '@/hooks/useServerQueries'
import { usePersonalizedRecommendations } from '@/hooks/usePersonalizedRecommendations'
import { pickFeaturedAlbum, rankArtistsByAffinity } from '@/services/recommendationEngine'
import { usePlayerStore } from '@/store/playerStore'
import { getAdapter, hasAdapter } from '@/api'
import { formatDuration } from '@/utils/formatters'
import { playAllInOrder, playAllShuffled } from '@/utils/playActions'
import type { Album } from '@/api/types'

export default function HomePage() {
  const navigate = useNavigate()
  const playQueue = usePlayerStore(s => s.playQueue)
  const queryClient = useQueryClient()

  const { data: recentAlbums, isLoading: albumsLoading } = useRecentAlbums(20)
  const {
    data: randomSongs,
    isLoading: songsLoading,
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

  // 头条说明：全部由真实数据拼成（曲目数/总时长/年份/流派），不虚构编辑文案
  const heroLede = useMemo(() => {
    if (!heroAlbum) return ''
    const sentences: string[] = []
    if (heroAlbum.songCount) {
      sentences.push(
        `共收录 ${heroAlbum.songCount} 首曲目` +
          (heroAlbum.duration ? `，总时长 ${formatDuration(heroAlbum.duration)}` : '') +
          '。'
      )
    }
    const issue: string[] = []
    if (heroAlbum.year) issue.push(`${heroAlbum.year} 年发行`)
    if (heroAlbum.genre) issue.push(`流派 ${heroAlbum.genre}`)
    if (issue.length) sentences.push(issue.join('，') + '。')
    return sentences.join('')
  }, [heroAlbum])

  // 播放整张专辑（先查缓存再拉详情，与 AlbumCard 同一策略）
  const playAlbum = useCallback(
    async (album: Album) => {
      try {
        const cached = queryClient.getQueryData(queryKeys.albumDetail(album.id))
        if (cached && (cached as { songs?: unknown[] }).songs) {
          playQueue((cached as { songs: Parameters<typeof playQueue>[0] }).songs)
          return
        }
        const detail = await getAdapter().getAlbumDetail(album.id)
        queryClient.setQueryData(queryKeys.albumDetail(album.id), detail)
        if (detail.songs.length) playQueue(detail.songs)
      } catch (err) {
        console.error('Failed to play album:', err)
      }
    },
    [playQueue, queryClient]
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
              本期封面 · FEATURED ALBUM
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
                播放整张专辑
              </button>
              {heroAlbum.songCount ? (
                <span className="num text-[11.5px] tracking-[0.14em] text-ink-faint">
                  {heroAlbum.songCount} 首
                  {heroAlbum.duration ? ` · ${formatDuration(heroAlbum.duration)}` : ''}
                </span>
              ) : null}
            </div>
          </div>

          <figure className="group w-full max-w-[300px] lg:justify-self-end">
            <button
              onClick={() => navigate(`/albums/${heroAlbum.id}`)}
              aria-label={`查看专辑《${heroAlbum.name}》`}
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
              《{heroAlbum.name}》 · {heroAlbum.artist}
              {heroAlbum.year ? ` · ${heroAlbum.year}` : ''}
            </figcaption>
          </figure>
        </article>
      )}

      {/* ============ 最近添加 · 编号行 ============ */}
      <section aria-labelledby="home-recent">
        <div className="section-head">
          <h2 id="home-recent">
            最近添加<small>RECENTLY ADDED</small>
          </h2>
          <button className="more" onClick={() => navigate('/albums')}>
            全部专辑 →
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
              热门歌手<small>ARTISTS A–Z</small>
            </h2>
            <button className="more" onClick={() => navigate('/artists')}>
              全部歌手 →
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
                  {artist.name}
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

      {/* ============ 为你推荐 · 编号列表 ============ */}
      {!songsLoading && randomSongs && randomSongs.length > 0 && (
        <section aria-labelledby="home-for-you">
          <div className="section-head">
            <h2 id="home-for-you">
              为你推荐<small>FOR YOU</small>
            </h2>
            <div className="flex items-baseline gap-7">
              <span className="num text-[11.5px] tracking-[0.12em] text-ink-faint">
                {randomSongs.length} 首 ·{' '}
                {formatDuration(randomSongs.reduce((s, r) => s + r.duration, 0))}
              </span>
              <button
                className="more inline-flex items-center gap-1.5"
                onClick={() => playAllInOrder(randomSongs, 0)}
              >
                <Play size={12} />
                播放全部
              </button>
              <button
                className="more inline-flex items-center gap-1.5"
                onClick={() => playAllShuffled(randomSongs, 0)}
              >
                <Shuffle size={12} />
                随机播放
              </button>
              <button
                className="more inline-flex items-center gap-1.5"
                onClick={refreshSongs}
                disabled={songsLoading}
              >
                <ArrowsClockwise size={12} className={songsLoading ? 'animate-spin' : undefined} />
                换一批
              </button>
            </div>
          </div>
          <SongList songs={randomSongs.slice(0, 15)} showCover showAlbum showIndex />
        </section>
      )}
    </div>
  )
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
  const coverUrl = album.coverArt && hasAdapter()
    ? getAdapter().getCoverUrl(album.coverArt, 64)
    : undefined

  const meta = [
    album.songCount ? `${album.songCount} 首` : '',
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
          {album.name}
        </span>
        <span className="hidden md:block flex-1 min-w-0 text-[13px] text-ink-soft truncate">
          {album.artist}
        </span>
        <span className="num flex-shrink-0 text-right text-[11.5px] text-ink-faint">{meta}</span>
        <button
          onClick={e => {
            e.stopPropagation()
            onPlay()
          }}
          aria-label={`播放专辑《${album.name}》`}
          className="w-[30px] h-[30px] flex-shrink-0 grid place-items-center rounded-full border border-hair text-ink-soft opacity-0 group-hover:opacity-100 transition-all duration-200 hover:bg-primary hover:border-primary hover:text-paper active:scale-[0.94]"
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
          <span className="w-8 h-3 rounded-sm bg-hair-soft/70 animate-pulse" />
          <span className="w-[52px] h-[52px] rounded-sm bg-hair-soft/70 animate-pulse" />
          <span className="flex-1 h-4 rounded-sm bg-hair-soft/70 animate-pulse" />
          <span className="hidden md:block flex-1 h-3.5 rounded-sm bg-hair-soft/70 animate-pulse" />
          <span className="w-16 h-3.5 rounded-sm bg-hair-soft/70 animate-pulse" />
        </li>
      ))}
    </ol>
  )
}
