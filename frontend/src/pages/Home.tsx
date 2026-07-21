/**
 * 首页
 * 展示：欢迎横幅、最近专辑、随机推荐歌曲、歌手推荐
 */

import { Play, Shuffle } from '@phosphor-icons/react'
import { useNavigate } from 'react-router-dom'
import { AlbumCard } from '@/components/music/AlbumCard'
import { ArtistCard } from '@/components/music/ArtistCard'
import { SongList } from '@/components/music/SongList'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useRecentAlbums, useRandomSongs, useArtists, queryKeys } from '@/hooks/useServerQueries'
import { usePlayerStore } from '@/store/playerStore'
import { useServerStore } from '@/store/serverStore'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'
import { getAdapter, hasAdapter } from '@/api'
import { formatDuration } from '@/utils/formatters'
import { useQueryClient } from '@tanstack/react-query'
import { playAllInOrder, playAllShuffled } from '@/utils/playActions'

export default function HomePage() {
  const navigate = useNavigate()
  const { username } = useServerStore()
  const playQueue     = usePlayerStore(s => s.playQueue)
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
        <div className="px-8 pt-9 pb-10 max-w-[1320px] mx-auto animate-fade-in">

          {/* 问候语 */}
          <div className="flex items-end justify-between gap-6">
            <div className="min-w-0">
              <h1 className="text-4xl font-bold tracking-tight text-foreground truncate">
                {greeting()}{username ? `，${username}` : ''}
              </h1>
              <p className="text-sm text-muted-foreground mt-2">发现今天的音乐</p>
            </div>
            {randomSongs && randomSongs.length > 0 && (
              <button
                onClick={() => playAllShuffled(randomSongs, 0)}
                className="inline-flex items-center gap-2 h-10 px-5 rounded-full border border-border text-sm font-semibold text-foreground hover:border-primary hover:text-primary transition-colors active:scale-[0.97] flex-shrink-0"
              >
                <Shuffle size={16} />
                随机播放
              </button>
            )}
          </div>

          {/* 精选专辑：非对称分栏 */}
          {heroAlbum && (
            <section
              className="mt-10 border-t border-border pt-10 pb-2 grid grid-cols-1 lg:grid-cols-[1fr_360px] items-center gap-10 lg:gap-[72px] cursor-pointer group"
              onClick={() => navigate(`/albums/${heroAlbum.id}`)}
            >
              {/* 左：文本块 */}
              <div className="min-w-0">
                <p className="text-[11.5px] uppercase tracking-[0.14em] text-primary mb-3">最新专辑</p>
                <h2 className="text-3xl lg:text-4xl font-bold tracking-tight leading-tight text-foreground truncate mb-2">
                  {heroAlbum.name}
                </h2>
                <p className="text-sm text-muted-foreground mb-7 truncate">{heroAlbum.artist}</p>
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleHeroPlay}
                    className="inline-flex items-center gap-2 h-10 px-5 rounded-full bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors active:scale-[0.97]"
                  >
                    <Play size={16} weight="fill" />
                    播放
                  </button>
                </div>
              </div>
              {/* 右：封面 + 氛围光 */}
              <div className="relative w-full max-w-[360px] mx-auto lg:mx-0">
                <div aria-hidden className="absolute inset-[8%] rounded-[40%] bg-primary/20 blur-[56px]" />
                <div className="relative aspect-square rounded-lg overflow-hidden ring-1 ring-border shadow-2xl shadow-black/40 transition-transform duration-300 group-hover:-translate-y-1">
                  <ImageWithFallback
                    src={heroCoverUrl}
                    alt={heroAlbum.name}
                    fallbackType="album"
                    className="w-full h-full object-cover"
                    customCoverParams={{ type: 'album', artist: heroAlbum.artist, album: heroAlbum.name }}
                  />
                </div>
              </div>
            </section>
          )}

          {/* 最近专辑 */}
          <section className="mt-10 border-t border-border pt-8">
            <div className="flex items-baseline justify-between mb-5">
              <h2 className="text-lg font-bold tracking-tight text-foreground">最近添加</h2>
              <button
                onClick={() => navigate('/albums')}
                className="text-[12.5px] text-muted-foreground hover:text-primary transition-colors"
              >
                查看全部
              </button>
            </div>

            {albumsLoading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="aspect-square rounded-lg bg-accent animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5 [&>*]:min-w-0">
                {recentAlbums?.slice(0, 12).map(album => (
                  <AlbumCard key={album.id} album={album} />
                ))}
              </div>
            )}
          </section>

          {/* 推荐歌手 */}
          {!artistsLoading && artists && artists.length > 0 && (
            <section className="mt-10 border-t border-border pt-8">
              <div className="flex items-baseline justify-between mb-5">
                <h2 className="text-lg font-bold tracking-tight text-foreground">热门歌手</h2>
                <button
                  onClick={() => navigate('/artists')}
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

          {/* 今日推荐歌曲 */}
          {!songsLoading && randomSongs && randomSongs.length > 0 && (
            <section className="mt-10 border-t border-border pt-8">
              <div className="flex items-baseline justify-between mb-5">
                <h2 className="text-lg font-bold tracking-tight text-foreground">为你推荐</h2>
                <p className="text-sm text-muted-foreground">
                  共 <span className="font-num">{randomSongs.length}</span> 首 · <span className="font-num">{formatDuration(randomSongs.reduce((s, r) => s + r.duration, 0))}</span>
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
