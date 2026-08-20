/**
 * 为你推荐页 —— 杂志化推荐（DESIGN v2 §3）
 * 今日推荐编号列表（文字级操作：播放全部/随机播放/换一批）｜最近添加封面墙｜热门歌手文字索引
 */

import { Fragment, useMemo } from 'react'
import { ArrowsClockwise } from '@phosphor-icons/react'
import { useNavigate } from 'react-router-dom'
import { AlbumCard } from '@/components/music/AlbumCard'
import { SongList } from '@/components/music/SongList'
import { useRecentAlbums, useArtists } from '@/hooks/useServerQueries'
import { usePersonalizedRecommendations } from '@/hooks/usePersonalizedRecommendations'
import { rankArtistsByAffinity } from '@/services/recommendationEngine'
import { formatDuration } from '@/utils/formatters'
import { playAllInOrder, playAllShuffled } from '@/utils/playActions'

export default function RecommendationsPage() {
  const navigate = useNavigate()

  const { data: recentAlbums, isLoading: albumsLoading } = useRecentAlbums(12)
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

  function handlePlayAll() {
    if (!randomSongs?.length) return
    playAllInOrder(randomSongs, 0)
  }

  function handleShuffle() {
    if (!randomSongs?.length) return
    playAllShuffled(randomSongs, 0)
  }

  return (
    <div className="animate-fade-in">
      {/* ============ 今日推荐 · 编号列表 ============ */}
      <section aria-labelledby="rec-today">
        <div className="section-head">
          <h2 id="rec-today">
            今日推荐<small>DAILY PICKS</small>
          </h2>
          <div className="flex items-baseline gap-7">
            {randomSongs && randomSongs.length > 0 && (
              <>
                <span className="num text-[11.5px] tracking-[0.12em] text-ink-faint">
                  {randomSongs.length} 首 ·{' '}
                  {formatDuration(randomSongs.reduce((s, r) => s + r.duration, 0))}
                </span>
                <button className="more" onClick={handlePlayAll}>
                  播放全部
                </button>
                <button className="more" onClick={handleShuffle}>
                  随机播放
                </button>
              </>
            )}
            <button
              className="more inline-flex items-center gap-1.5"
              onClick={refreshSongs}
              disabled={songsFetching}
            >
              <ArrowsClockwise size={12} className={songsFetching ? 'animate-spin' : undefined} />
              换一批
            </button>
          </div>
        </div>
        <p className="-mt-2 mb-6 max-w-[52ch] text-[13px] text-ink-faint">
          根据你的收听、收藏与跳过行为动态推荐
        </p>
        {songsFetching && !randomSongs?.length ? (
          <SongRowsSkeleton rows={8} />
        ) : randomSongs && randomSongs.length > 0 ? (
          <div className={songsFetching ? 'opacity-60 transition-opacity duration-200' : undefined}>
            <SongList songs={randomSongs} showCover showAlbum showIndex />
          </div>
        ) : null}
      </section>

      {/* ============ 最近添加 · 封面墙 ============ */}
      <section aria-labelledby="rec-recent">
        <div className="section-head">
          <h2 id="rec-recent">
            最近添加<small>RECENTLY ADDED</small>
          </h2>
          <button className="more" onClick={() => navigate('/library')}>
            查看全部 →
          </button>
        </div>
        {albumsLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-x-5 gap-y-7">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i}>
                <div className="aspect-square rounded-md bg-hair-soft/70 animate-pulse" />
                <div className="mt-2.5 h-4 w-3/4 rounded-sm bg-hair-soft/70 animate-pulse" />
                <div className="mt-1.5 h-3 w-1/2 rounded-sm bg-hair-soft/70 animate-pulse" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-x-5 gap-y-7 [&>*]:min-w-0">
            {recentAlbums?.map(album => (
              <AlbumCard key={album.id} album={album} />
            ))}
          </div>
        )}
      </section>

      {/* ============ 热门歌手 · 文字索引 ============ */}
      {!artistsLoading && recommendedArtists.length > 0 && (
        <section aria-labelledby="rec-artists">
          <div className="section-head">
            <h2 id="rec-artists">
              热门歌手<small>ARTISTS A–Z</small>
            </h2>
            <button className="more" onClick={() => navigate('/library')}>
              查看全部 →
            </button>
          </div>
          <p className="font-serif text-[20px] lg:text-[24px] font-semibold leading-[2.1]">
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
    </div>
  )
}

/** 曲目加载骨架：hair-soft 行闪烁（DESIGN §4.5） */
function SongRowsSkeleton({ rows }: { rows: number }) {
  return (
    <div className="border-t border-hair">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-3 py-3 border-b border-hair-soft">
          <span className="w-8 h-3 rounded-sm bg-hair-soft/70 animate-pulse" />
          <span className="w-10 h-10 rounded-sm bg-hair-soft/70 animate-pulse" />
          <span className="flex-1 h-4 rounded-sm bg-hair-soft/70 animate-pulse" />
          <span className="hidden lg:block flex-1 h-3.5 rounded-sm bg-hair-soft/70 animate-pulse" />
          <span className="w-12 h-3.5 rounded-sm bg-hair-soft/70 animate-pulse" />
        </div>
      ))}
    </div>
  )
}
