import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Heart, Play, MusicNote, VinylRecord } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { useStarred } from '@/hooks/useServerQueries'
import { playAllInOrder } from '@/utils/playActions'
import { getAdapter, hasAdapter } from '@/api'
import { SongList } from '@/components/music/SongList'
import { AlbumCard } from '@/components/music/AlbumCard'

type FavTab = 'songs' | 'albums'

export default function Favorites() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<FavTab>('songs')
  const { data: starred, isLoading } = useStarred()
  const songs = starred?.songs ?? []
  const albums = starred?.albums ?? []

  function handlePlayAll() {
    if (!songs.length) return
    playAllInOrder(songs, 0)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-full pb-8 animate-fade-in">
      {/* Header */}
      <div className="px-6 pt-6 pb-8">
        <div className="flex items-end gap-7">
          <div className="w-40 h-40 rounded-lg ring-1 ring-border bg-gradient-to-br from-primary/25 to-primary/5 flex items-center justify-center flex-shrink-0 shadow-2xl">
            <Heart className="w-20 h-20 text-primary/60" weight="fill" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-primary tracking-[0.14em] mb-3">收藏</p>
            <h1 className="text-4xl font-bold tracking-tight mb-2 truncate">我喜欢的音乐</h1>
            <p className="text-muted-foreground text-[13.5px] mb-5">
              <span className="font-num">{songs.length}</span> 首歌曲 · <span className="font-num">{albums.length}</span> 张专辑
            </p>
            {songs.length > 0 && (
              <button
                onClick={handlePlayAll}
                className="flex items-center gap-2 h-10 px-5 bg-primary text-primary-foreground rounded-full text-sm font-semibold hover:brightness-110 transition-all active:scale-[0.97]"
              >
                <Play className="w-4 h-4" weight="fill" />
                播放全部
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-6">
        <div className="flex items-center gap-6 border-b border-border mb-7">
          <button
            onClick={() => setTab('songs')}
            className={cn(
              'relative flex items-center gap-1.5 pb-3 pt-1 text-sm transition-colors',
              tab === 'songs'
                ? 'text-foreground font-semibold after:absolute after:left-0 after:right-0 after:-bottom-px after:h-0.5 after:rounded-full after:bg-primary'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <MusicNote className="w-4 h-4" />
            歌曲 {songs.length > 0 && <span className="font-num text-xs text-muted-foreground ml-1">({songs.length})</span>}
          </button>
          <button
            onClick={() => setTab('albums')}
            className={cn(
              'relative flex items-center gap-1.5 pb-3 pt-1 text-sm transition-colors',
              tab === 'albums'
                ? 'text-foreground font-semibold after:absolute after:left-0 after:right-0 after:-bottom-px after:h-0.5 after:rounded-full after:bg-primary'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <VinylRecord className="w-4 h-4" />
            专辑 {albums.length > 0 && <span className="font-num text-xs text-muted-foreground ml-1">({albums.length})</span>}
          </button>
        </div>

        {tab === 'songs' && (
          songs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
              <Heart className="w-12 h-12 mb-3 opacity-20" />
              <p>暂无收藏歌曲</p>
              <p className="text-sm">点击歌曲旁边的❤️按钮收藏</p>
            </div>
          ) : (
            <SongList songs={songs} showAlbum />
          )
        )}

        {tab === 'albums' && (
          albums.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
              <VinylRecord className="w-12 h-12 mb-3 opacity-20" />
              <p>暂无收藏专辑</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-x-5 gap-y-6">
              {albums.map(album => (
                <AlbumCard key={album.id} album={album} />
              ))}
            </div>
          )
        )}
      </div>
    </div>
  )
}
