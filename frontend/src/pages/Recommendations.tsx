/**
 * 为你推荐页面
 * 展示随机推荐歌曲、最近专辑、热门歌手
 */

import { Sparkles, Play, Shuffle, RefreshCw } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { AlbumCard } from '@/components/music/AlbumCard'
import { ArtistCard } from '@/components/music/ArtistCard'
import { SongList } from '@/components/music/SongList'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { useRecentAlbums, useRandomSongs, useArtists } from '@/hooks/useServerQueries'
import { usePlayerStore } from '@/store/playerStore'
import { formatDuration } from '@/utils/formatters'

export default function RecommendationsPage() {
  const navigate = useNavigate()
  const playQueue     = usePlayerStore(s => s.playQueue)
  const toggleShuffle = usePlayerStore(s => s.toggleShuffle)
  const shuffle       = usePlayerStore(s => s.shuffle)

  const { data: recentAlbums, isLoading: albumsLoading } = useRecentAlbums(12)
  const { data: randomSongs, isLoading: songsLoading, refetch: refetchSongs } = useRandomSongs(30)
  const { data: artists, isLoading: artistsLoading } = useArtists()

  function handlePlayAll() {
    if (!randomSongs?.length) return
    if (shuffle) toggleShuffle()
    playQueue(randomSongs, 0)
  }

  function handleShuffle() {
    if (!randomSongs?.length) return
    if (!shuffle) toggleShuffle()
    playQueue(randomSongs, 0)
  }

  return (
    <div className="flex flex-col h-full">
      <ScrollArea className="flex-1">
        <div className="p-6 pb-8 space-y-10 max-w-7xl mx-auto">

          {/* 页面标题 */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold flex items-center gap-3">
                <Sparkles className="w-8 h-8 text-primary" />
                为你推荐
              </h1>
              <p className="text-sm text-muted-foreground mt-1">根据你的音乐库精选推荐</p>
            </div>
          </div>

          {/* 今日推荐歌曲 */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-foreground">今日歌曲推荐</h2>
                {!songsLoading && randomSongs && (
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {randomSongs.length} 首 · {formatDuration(randomSongs.reduce((s, r) => s + r.duration, 0))}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => refetchSongs()}
                  className="p-2 rounded-full hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
                  title="换一批"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
                <Button size="sm" onClick={handlePlayAll} disabled={!randomSongs?.length}>
                  <Play className="w-4 h-4 mr-1.5" fill="currentColor" />
                  播放全部
                </Button>
                <Button size="sm" variant="secondary" onClick={handleShuffle} disabled={!randomSongs?.length}>
                  <Shuffle className="w-4 h-4 mr-1.5" />
                  随机播放
                </Button>
              </div>
            </div>

            {songsLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-14 rounded-lg bg-muted animate-pulse" />
                ))}
              </div>
            ) : randomSongs && randomSongs.length > 0 ? (
              <SongList
                songs={randomSongs}
                showCover
                showAlbum
                showIndex
              />
            ) : null}
          </section>

          {/* 最近添加专辑 */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-foreground">最近添加</h2>
              <button
                onClick={() => navigate('/library')}
                className="text-sm text-muted-foreground hover:text-primary transition-colors"
              >
                查看全部
              </button>
            </div>
            {albumsLoading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="aspect-square rounded-xl bg-muted animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {recentAlbums?.map(album => (
                  <AlbumCard key={album.id} album={album} />
                ))}
              </div>
            )}
          </section>

          {/* 热门歌手 */}
          {!artistsLoading && artists && artists.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-foreground">热门歌手</h2>
                <button
                  onClick={() => navigate('/library')}
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

        </div>
      </ScrollArea>
    </div>
  )
}
