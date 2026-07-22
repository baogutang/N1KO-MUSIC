/**
 * 歌手详情页 —— 杂志编辑风（DESIGN v2 §3）
 * 顶部：中小圆形头像居左 + 衬线 900 歌手名 + ink-soft bio（限宽 34em，可展开/收起）
 * 分区：热门歌曲 Top5 / 全部歌曲（默认 20，可展开）/ 专辑封面墙 / 相似歌手文字索引行
 */

import { Fragment, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Play, Shuffle, CaretDown, CaretUp, MicrophoneStage } from '@phosphor-icons/react'
import { AlbumCard } from '@/components/music/AlbumCard'
import { SongList } from '@/components/music/SongList'
import { useArtistDetail } from '@/hooks/useServerQueries'
import { getAdapter, hasAdapter } from '@/api'
import { playAllInOrder, playAllShuffled } from '@/utils/playActions'
import { cn } from '@/lib/utils'

/** 全部歌曲默认展示数量 */
const SONGS_INITIAL_SHOW = 20
/** 热门歌曲展示数量 */
const TOP_SONGS_SHOW = 5

export default function ArtistDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: artist, isLoading } = useArtistDetail(id ?? '')
  const [showAllSongs, setShowAllSongs] = useState(false)
  const [bioExpanded, setBioExpanded] = useState(false)
  const [imgError, setImgError] = useState(false)

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
          <div className="h-28 w-28 flex-shrink-0 rounded-full bg-hair-soft animate-pulse" />
          <div className="flex-1 space-y-4">
            <div className="h-3 w-28 rounded-sm bg-hair-soft animate-pulse" />
            <div className="h-10 w-1/3 rounded-sm bg-hair-soft animate-pulse" />
            <div className="h-3 w-2/3 rounded-sm bg-hair-soft animate-pulse" />
          </div>
        </div>
      </div>
    )
  }

  if (!artist) return null

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
          <p className="text-[11px] uppercase tracking-[0.3em] text-primary">歌手 · ARTIST</p>
          <h1 className="mt-3 font-serif text-4xl font-black tracking-[-0.01em] text-ink text-balance lg:text-5xl">
            {artist.name}
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
                {bioExpanded ? '收起 ↑' : '展开 ↓'}
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
                播放全部
              </button>
            )}
            {playableSongs.length > 0 && (
              <button
                onClick={() => playAllShuffled(playableSongs)}
                className="inline-flex items-center gap-2 rounded border border-hair px-3.5 py-1.5 text-[13px] text-ink-soft transition-colors duration-200 hover:border-ink hover:text-ink active:scale-[0.97]"
              >
                <Shuffle size={14} />
                随机播放
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 热门歌曲（Top5） */}
      {topSongs.length > 0 && (
        <section>
          <div className="section-head">
            <h2>热门歌曲<small>TOP SONGS</small></h2>
          </div>
          <SongList songs={topSongs.slice(0, TOP_SONGS_SHOW)} showCover showAlbum showIndex />
        </section>
      )}

      {/* 全部歌曲（默认 20 首，可展开） */}
      {allSongs.length > 0 && (
        <section>
          <div className="section-head">
            <h2>全部歌曲<small>ALL SONGS</small></h2>
            <span className="more num">共 {allSongs.length} 首</span>
          </div>
          <SongList songs={displayedSongs} showCover showAlbum showIndex />
          {hasMoreSongs && (
            <div className="mt-6 flex justify-center">
              <button
                onClick={() => setShowAllSongs(!showAllSongs)}
                className="inline-flex items-center gap-2 rounded border border-hair px-4 py-1.5 text-[13px] text-ink-soft transition-colors duration-200 hover:border-ink hover:text-ink active:scale-[0.97]"
              >
                {showAllSongs ? (
                  <>收起 <CaretUp size={13} /></>
                ) : (
                  <>查看全部 <span className="num">{allSongs.length}</span> 首 <CaretDown size={13} /></>
                )}
              </button>
            </div>
          )}
        </section>
      )}

      {/* 专辑封面墙 */}
      {artist.albums.length > 0 && (
        <section>
          <div className="section-head">
            <h2>专辑<small>ALBUMS</small></h2>
            <span className="more num">共 {artist.albums.length} 张</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-5 gap-y-7 [&>*]:min-w-0">
            {artist.albums.map(album => (
              <AlbumCard key={album.id} album={album} />
            ))}
          </div>
        </section>
      )}

      {/* 相似歌手：文字索引行（逗号分隔链接） */}
      {artist.similarArtists && artist.similarArtists.length > 0 && (
        <section className="pb-4">
          <div className="section-head">
            <h2>相似歌手<small>SIMILAR ARTISTS</small></h2>
          </div>
          <p className="font-serif text-lg leading-[2.2] md:text-xl">
            {artist.similarArtists.map((similar, i) => (
              <Fragment key={similar.id}>
                {i > 0 && <span className="text-ink-faint">，</span>}
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
