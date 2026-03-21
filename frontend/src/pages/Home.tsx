/**
 * 首页
 * 展示：欢迎横幅、最近专辑、随机推荐歌曲、歌手推荐
 */

import { Play, Shuffle } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { AlbumCard } from '@/components/music/AlbumCard'
import { ArtistCard } from '@/components/music/ArtistCard'
import { SongList } from '@/components/music/SongList'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { useRecentAlbums, useRandomSongs, useArtists, queryKeys } from '@/hooks/useServerQueries'
import { usePlayerStore } from '@/store/playerStore'
import { useServerStore } from '@/store/serverStore'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'
import { getAdapter, hasAdapter } from '@/api'
import { formatDuration } from '@/utils/formatters'
import { useQueryClient } from '@tanstack/react-query'

export default function HomePage() {
  const navigate = useNavigate()
  const { username } = useServerStore()
  const playQueue     = usePlayerStore(s => s.playQueue)
  const toggleShuffle = usePlayerStore(s => s.toggleShuffle)
  const shuffle       = usePlayerStore(s => s.shuffle)
  const queryClient = useQueryClient()

  const { data: recentAlbums, isLoading: albumsLoading } = useRecentAlbums(20)
  const { data: randomSongs, isLoading: songsLoading } = useRandomSongs(30)
  const { data: artists, isLoading: artistsLoading } = useArtists()

  const greeting = () => {
    const h = new Date().getHours()
    if (h < 12) return '早上好'
    if (h < 18) return '下午好'
    return '晚上好'
  }

  // 精选专辑（第一张，用于 Hero Banner）
  const heroAlbum = recentAlbums?.[0]
  const heroCoverUrl = heroAlbum?.coverArt && hasAdapter()
    ? getAdapter().getCoverUrl(heroAlbum.coverArt, 400)
    : undefined

  const handleHeroPlay = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!heroAlbum) return
    try {
      const cached = queryClient.getQueryData(queryKeys.albumDetail(heroAlbum.id))
      if (cached && (cached as { songs?: unknown[] }).songs) {
        const detail = cached as { songs: Parameters<typeof playQueue>[0] }
        playQueue(detail.songs as Parameters<typeof playQueue>[0])
        return
      }
      const detail = await getAdapter().getAlbumDetail(heroAlbum.id)
      queryClient.setQueryData(queryKeys.albumDetail(heroAlbum.id), detail)
      if (detail.songs.length) playQueue(detail.songs)
    } catch (err) {
      console.error('Failed to play hero album:', err)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <ScrollArea className="flex-1">
        <div className="p-6 pb-8 space-y-10 max-w-7xl mx-auto">

          {/* Hero Banner */}
          {heroAlbum && (
            <section className="relative rounded-2xl overflow-hidden h-48 lg:h-64 group cursor-pointer"
              onClick={() => navigate(`/albums/${heroAlbum.id}`)}>
              {/* 背景图 */}
              <ImageWithFallback
                src={heroCoverUrl}
                alt={heroAlbum.name}
                fallbackType="album"
                className="absolute inset-0 w-full h-full object-cover scale-105 group-hover:scale-110 transition-transform duration-700"
                customCoverParams={{ type: 'album', artist: heroAlbum.artist, album: heroAlbum.name }}
              />
              {/* 渐变遮罩 */}
              <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/40 to-transparent" />
              <div className="absolute inset-0 flex flex-col justify-end p-6 lg:p-8">
                <p className="text-xs text-white/60 uppercase tracking-wider mb-1">最新专辑</p>
                <h2 className="text-xl lg:text-3xl font-bold text-white line-clamp-1">
                  {heroAlbum.name}
                </h2>
                <p className="text-sm text-white/70 mt-1">{heroAlbum.artist}</p>
                <div className="flex gap-3 mt-4">
                  <Button
                    size="sm"
                    className="rounded-full"
                    onClick={handleHeroPlay}
                  >
                    <Play className="w-4 h-4 mr-1.5" fill="currentColor" />
                    播放
                  </Button>
                </div>
              </div>
            </section>
          )}

          {/* 问候语 */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-foreground">
                {greeting()}{username ? `，${username}` : ''} 👋
              </h1>
              <p className="text-sm text-muted-foreground mt-1">发现今天的音乐</p>
            </div>
            {randomSongs && randomSongs.length > 0 && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  playQueue(randomSongs, 0)
                  toggleShuffle()
                }}
              >
                <Shuffle className="w-4 h-4 mr-2" />
                随机播放
              </Button>
            )}
          </div>

          {/* 最近专辑 */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-foreground">最近添加</h2>
              <button
                onClick={() => navigate('/albums')}
                className="text-sm text-muted-foreground hover:text-primary transition-colors"
              >
                查看全部
              </button>
            </div>

            {albumsLoading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="aspect-square rounded-xl bg-card animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                {recentAlbums?.slice(0, 12).map(album => (
                  <AlbumCard key={album.id} album={album} />
                ))}
              </div>
            )}
          </section>

          {/* 推荐歌手 */}
          {!artistsLoading && artists && artists.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-foreground">热门歌手</h2>
                <button
                  onClick={() => navigate('/artists')}
                  className="text-sm text-muted-foreground hover:text-primary transition-colors"
                >
                  查看全部
                </button>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-4">
                {artists.slice(0, 8).map(artist => (
                  <ArtistCard key={artist.id} artist={artist} />
                ))}
              </div>
            </section>
          )}

          {/* 今日推荐歌曲 */}
          {!songsLoading && randomSongs && randomSongs.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-foreground">为你推荐</h2>
                <p className="text-sm text-muted-foreground">
                  共 {randomSongs.length} 首 · {formatDuration(randomSongs.reduce((s, r) => s + r.duration, 0))}
                </p>
              </div>
              <SongList
                songs={randomSongs.slice(0, 15)}
                showCover
                showAlbum
                showIndex
              />
            </section>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
