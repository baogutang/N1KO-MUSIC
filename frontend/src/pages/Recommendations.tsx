/**
 * 为你推荐页面
 * 展示随机推荐歌曲、最近专辑、热门歌手
 */

import { Sparkle, Play, Shuffle, ArrowsClockwise } from '@phosphor-icons/react'
import { useNavigate } from 'react-router-dom'
import { AlbumCard } from '@/components/music/AlbumCard'
import { ArtistCard } from '@/components/music/ArtistCard'
import { SongList } from '@/components/music/SongList'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useRecentAlbums, useRandomSongs, useArtists } from '@/hooks/useServerQueries'
import { formatDuration } from '@/utils/formatters'
import { playAllInOrder, playAllShuffled } from '@/utils/playActions'

export default function RecommendationsPage() {
  const navigate = useNavigate()

  const { data: recentAlbums, isLoading: albumsLoading } = useRecentAlbums(12)
  const { data: randomSongs, isLoading: songsLoading, refetch: refetchSongs } = useRandomSongs(30)
  const { data: artists, isLoading: artistsLoading } = useArtists()

  function handlePlayAll() {
    if (!randomSongs?.length) return
    playAllInOrder(randomSongs, 0)
  }

  function handleShuffle() {
    if (!randomSongs?.length) return
    playAllShuffled(randomSongs, 0)
  }

  return (
    <div className="flex flex-col h-full">
      <ScrollArea className="flex-1">
        <div className="px-8 pt-8 pb-10 max-w-[1320px] mx-auto animate-fade-in">

          {/* 页面标题 */}
          <div className="flex items-end justify-between mb-9">
            <div>
              <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
                <Sparkle size={28} weight="fill" className="text-primary" />
                为你推荐
              </h1>
              <p className="text-sm text-muted-foreground mt-1.5">根据你的音乐库精选推荐</p>
            </div>
          </div>

          {/* 今日推荐歌曲 */}
          <section className="border-t border-border pt-8">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-lg font-bold tracking-tight text-foreground">今日歌曲推荐</h2>
                {!songsLoading && randomSongs && (
                  <p className="text-sm text-muted-foreground mt-0.5">
                    <span className="font-num">{randomSongs.length}</span> 首 · <span className="font-num">{formatDuration(randomSongs.reduce((s, r) => s + r.duration, 0))}</span>
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => refetchSongs()}
                  className="w-9 h-9 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors active:scale-[0.94]"
                  title="换一批"
                >
                  <ArrowsClockwise size={16} />
                </button>
                <button
                  onClick={handlePlayAll}
                  disabled={!randomSongs?.length}
                  className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none"
                >
                  <Play size={15} weight="fill" />
                  播放全部
                </button>
                <button
                  onClick={handleShuffle}
                  disabled={!randomSongs?.length}
                  className="inline-flex items-center gap-2 h-9 px-4 rounded-full border border-border text-sm font-semibold text-foreground hover:border-primary hover:text-primary transition-colors active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none"
                >
                  <Shuffle size={15} />
                  随机播放
                </button>
              </div>
            </div>

            {songsLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-14 rounded-lg bg-accent animate-pulse" />
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
          <section className="mt-10 border-t border-border pt-8">
            <div className="flex items-baseline justify-between mb-5">
              <h2 className="text-lg font-bold tracking-tight text-foreground">最近添加</h2>
              <button
                onClick={() => navigate('/library')}
                className="text-[12.5px] text-muted-foreground hover:text-primary transition-colors"
              >
                查看全部
              </button>
            </div>
            {albumsLoading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-5">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="aspect-square rounded-lg bg-accent animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-5 [&>*]:min-w-0">
                {recentAlbums?.map(album => (
                  <AlbumCard key={album.id} album={album} />
                ))}
              </div>
            )}
          </section>

          {/* 热门歌手 */}
          {!artistsLoading && artists && artists.length > 0 && (
            <section className="mt-10 border-t border-border pt-8">
              <div className="flex items-baseline justify-between mb-5">
                <h2 className="text-lg font-bold tracking-tight text-foreground">热门歌手</h2>
                <button
                  onClick={() => navigate('/library')}
                  className="text-[12.5px] text-muted-foreground hover:text-primary transition-colors"
                >
                  查看全部
                </button>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-5 [&>*]:min-w-0">
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
