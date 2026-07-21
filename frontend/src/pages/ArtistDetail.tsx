/**
 * 歌手详情页
 */

import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Play, Shuffle, CaretDown, CaretUp } from '@phosphor-icons/react'
import { AlbumCard } from '@/components/music/AlbumCard'
import { SongList } from '@/components/music/SongList'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useArtistDetail } from '@/hooks/useServerQueries'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'
import { getAdapter, hasAdapter } from '@/api'
import { playAllInOrder, playAllShuffled } from '@/utils/playActions'

/** 全部歌曲默认展示数量 */
const SONGS_INITIAL_SHOW = 20

export default function ArtistDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: artist, isLoading } = useArtistDetail(id ?? '')
  const [showAllSongs, setShowAllSongs] = useState(false)
  const [bannerImgError, setBannerImgError] = useState(false)

  const serverImageUrl = artist?.artistImageUrl ||
    (artist?.coverArt && hasAdapter() ? getAdapter().getCoverUrl(artist.coverArt, 400) : undefined)

  const imageUrl = (serverImageUrl && !bannerImgError) ? serverImageUrl : undefined

  // 优先使用 songs（全部歌曲），其次 topSongs
  const allSongs = artist?.songs ?? []
  const rawTopSongs = artist?.topSongs ?? []
  // Navidrome 的 /getTopSongs 需要 Last.fm 集成，未配置时为空
  // 兜底策略：topSongs 为空时取 allSongs 前 10 首展示
  const topSongs = rawTopSongs.length > 0 ? rawTopSongs : allSongs.slice(0, 10)
  const playableSongs = allSongs.length > 0 ? allSongs : topSongs

  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    )
  }

  if (!artist) return null

  const displayedSongs = showAllSongs ? allSongs : allSongs.slice(0, SONGS_INITIAL_SHOW)
  const hasMoreSongs = allSongs.length > SONGS_INITIAL_SHOW

  return (
    <div className="flex flex-col h-full">
      <ScrollArea className="flex-1">
        <div className="px-8 pt-10 pb-10 max-w-[1320px] mx-auto animate-fade-in">
          {/* Hero */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-8">
            <div className="relative w-44 h-44 lg:w-52 lg:h-52 flex-shrink-0">
              <div aria-hidden className="absolute inset-[10%] rounded-full bg-primary/20 blur-[48px]" />
              {imageUrl ? (
                <img
                  src={imageUrl}
                  alt={artist.name}
                  className="relative w-full h-full object-cover object-top rounded-full ring-1 ring-border shadow-2xl shadow-black/40"
                  onError={() => setBannerImgError(true)}
                />
              ) : (
                // 无图片时：用主题渐变背景，不显示破损图标
                <div className="relative w-full h-full rounded-full ring-1 ring-border bg-gradient-to-br from-primary/30 via-primary/10 to-background" />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-[11.5px] uppercase tracking-[0.14em] text-primary mb-2">歌手</p>
              <h1 className="text-3xl lg:text-5xl font-bold tracking-tight text-foreground truncate">{artist.name}</h1>
              {artist.biography && (
                <p className="text-sm text-muted-foreground mt-3 line-clamp-2 max-w-2xl">
                  {artist.biography}
                </p>
              )}
              <div className="flex items-center gap-3 mt-6">
                {playableSongs.length > 0 && (
                  <button
                    onClick={() => playAllInOrder(playableSongs)}
                    className="inline-flex items-center gap-2 h-10 px-5 rounded-full bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors active:scale-[0.97]"
                  >
                    <Play size={16} weight="fill" />
                    播放全部
                  </button>
                )}
                {playableSongs.length > 0 && (
                  <button
                    onClick={() => playAllShuffled(playableSongs)}
                    className="inline-flex items-center gap-2 h-10 px-5 rounded-full border border-border text-sm font-semibold text-foreground hover:border-primary hover:text-primary transition-colors active:scale-[0.97]"
                  >
                    <Shuffle size={16} />
                    随机播放
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="mt-10 space-y-10">
          {/* 热门歌曲 */}
          {topSongs.length > 0 && (
            <section className="border-t border-border pt-8">
              <h2 className="text-lg font-bold tracking-tight mb-5">热门歌曲</h2>
              <SongList songs={topSongs} showCover showAlbum showIndex />
            </section>
          )}

          {/* 全部歌曲 */}
          {allSongs.length > 0 && (
            <section className="border-t border-border pt-8">
              <h2 className="text-lg font-bold tracking-tight mb-5">全部歌曲 <span className="font-num text-sm font-normal text-muted-foreground">({allSongs.length})</span></h2>
              <SongList songs={displayedSongs} showCover showAlbum showIndex />
              {hasMoreSongs && (
                <div className="flex justify-center mt-4">
                  <button
                    onClick={() => setShowAllSongs(!showAllSongs)}
                    className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full text-sm text-muted-foreground hover:text-foreground hover:bg-surface transition-colors active:scale-[0.97]"
                  >
                    {showAllSongs ? (
                      <>收起 <CaretUp size={14} /></>
                    ) : (
                      <>查看全部 <span className="font-num">{allSongs.length}</span> 首歌曲 <CaretDown size={14} /></>
                    )}
                  </button>
                </div>
              )}
            </section>
          )}

          {/* 专辑 */}
          {artist.albums.length > 0 && (
            <section className="border-t border-border pt-8">
              <h2 className="text-lg font-bold tracking-tight mb-5">专辑 <span className="font-num text-sm font-normal text-muted-foreground">({artist.albums.length})</span></h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-5 gap-y-6 [&>*]:min-w-0">
                {artist.albums.map(album => (
                  <AlbumCard key={album.id} album={album} />
                ))}
              </div>
            </section>
          )}

          {/* 相似歌手 */}
          {artist.similarArtists && artist.similarArtists.length > 0 && (
            <section className="border-t border-border pt-8">
              <h2 className="text-lg font-bold tracking-tight mb-5">相似歌手</h2>
              <div className="flex gap-5 overflow-x-auto scrollbar-hide pb-2">
                {artist.similarArtists.map(similar => {
                  const similarImg = similar.artistImageUrl ||
                    (similar.coverArt && hasAdapter() ? getAdapter().getCoverUrl(similar.coverArt, 96) : undefined)
                  return (
                    <div key={similar.id} className="flex-shrink-0 text-center w-20 cursor-pointer group"
                      onClick={() => navigate(`/artists/${similar.id}`)}>
                      <div className="w-20 h-20 rounded-full overflow-hidden mb-2 ring-1 ring-border group-hover:ring-primary transition-[box-shadow,color]">
                        <ImageWithFallback src={similarImg} alt={similar.name} fallbackType="artist" className="w-full h-full"
                          customCoverParams={{ type: 'artist', artist: similar.name }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground group-hover:text-foreground line-clamp-2 transition-colors">
                        {similar.name}
                      </p>
                    </div>
                  )
                })}
              </div>
            </section>
          )}
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
