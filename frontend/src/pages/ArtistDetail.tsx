/**
 * 歌手详情页
 */

import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Play, Shuffle, ChevronDown, ChevronUp } from 'lucide-react'
import { AlbumCard } from '@/components/music/AlbumCard'
import { SongList } from '@/components/music/SongList'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { useArtistDetail } from '@/hooks/useServerQueries'
import { usePlayerStore } from '@/store/playerStore'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'
import { getAdapter, hasAdapter } from '@/api'

/** 全部歌曲默认展示数量 */
const SONGS_INITIAL_SHOW = 20

export default function ArtistDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: artist, isLoading } = useArtistDetail(id ?? '')
  const playQueue = usePlayerStore(s => s.playQueue)
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
        {/* Banner */}
        <div className="relative h-56 lg:h-72 overflow-hidden">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={artist.name}
              className="w-full h-full object-cover object-top"
              onError={() => setBannerImgError(true)}
            />
          ) : (
            // 无图片时：用主题渐变背景，不显示破损图标
            <div className="w-full h-full bg-gradient-to-br from-primary/30 via-primary/10 to-background" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-6">
            <h1 className="text-3xl lg:text-5xl font-bold text-foreground">{artist.name}</h1>
            {artist.biography && (
              <p className="text-sm text-muted-foreground mt-2 line-clamp-2 max-w-2xl">
                {artist.biography}
              </p>
            )}
            <div className="flex gap-3 mt-4">
              {playableSongs.length > 0 && (
                <Button onClick={() => playQueue(playableSongs)}>
                  <Play className="w-4 h-4 mr-2" fill="currentColor" />
                  播放全部
                </Button>
              )}
              {playableSongs.length > 0 && (
                <Button variant="secondary" onClick={() => {
                  const shuffled = [...playableSongs].sort(() => Math.random() - 0.5)
                  playQueue(shuffled)
                }}>
                  <Shuffle className="w-4 h-4 mr-2" />
                  随机播放
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="p-6 max-w-7xl mx-auto space-y-8">
          {/* 热门歌曲 */}
          {topSongs.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold mb-4">热门歌曲</h2>
              <SongList songs={topSongs} showCover showAlbum showIndex />
            </section>
          )}

          {/* 全部歌曲 */}
          {allSongs.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold mb-4">全部歌曲 ({allSongs.length})</h2>
              <SongList songs={displayedSongs} showCover showAlbum showIndex />
              {hasMoreSongs && (
                <div className="flex justify-center mt-4">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowAllSongs(!showAllSongs)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    {showAllSongs ? (
                      <>收起 <ChevronUp className="w-4 h-4 ml-1" /></>
                    ) : (
                      <>查看全部 {allSongs.length} 首歌曲 <ChevronDown className="w-4 h-4 ml-1" /></>
                    )}
                  </Button>
                </div>
              )}
            </section>
          )}

          {/* 专辑 */}
          {artist.albums.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold mb-4">专辑 ({artist.albums.length})</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                {artist.albums.map(album => (
                  <AlbumCard key={album.id} album={album} />
                ))}
              </div>
            </section>
          )}

          {/* 相似歌手 */}
          {artist.similarArtists && artist.similarArtists.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold mb-4">相似歌手</h2>
              <div className="flex gap-4 overflow-x-auto scrollbar-hide pb-2">
                {artist.similarArtists.map(similar => {
                  const similarImg = similar.artistImageUrl ||
                    (similar.coverArt && hasAdapter() ? getAdapter().getCoverUrl(similar.coverArt, 96) : undefined)
                  return (
                    <div key={similar.id} className="flex-shrink-0 text-center w-20 cursor-pointer group"
                      onClick={() => navigate(`/artists/${similar.id}`)}>
                      <div className="w-20 h-20 rounded-full overflow-hidden mb-2 ring-2 ring-transparent group-hover:ring-primary transition-colors">
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
      </ScrollArea>
    </div>
  )
}
