import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Heart, Play, Music2, Disc3 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useStarred } from '@/hooks/useServerQueries'
import { usePlayerStore } from '@/store/playerStore'
import { getAdapter, hasAdapter } from '@/api'
import { SongList } from '@/components/music/SongList'

type FavTab = 'songs' | 'albums'

export default function Favorites() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<FavTab>('songs')
  const { data: starred, isLoading } = useStarred()
  const playQueue = usePlayerStore(s => s.playQueue)

  const songs = starred?.songs ?? []
  const albums = starred?.albums ?? []

  function handlePlayAll() {
    if (!songs.length) return
    playQueue(songs, 0)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-full pb-8">
      {/* Header */}
      <div className="px-6 pt-6 pb-6 bg-gradient-to-b from-rose-500/10 to-transparent">
        <div className="flex items-end gap-6">
          <div className="w-40 h-40 rounded-2xl bg-gradient-to-br from-rose-500/30 to-rose-500/5 flex items-center justify-center flex-shrink-0">
            <Heart className="w-20 h-20 text-rose-500/50" fill="currentColor" />
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">收藏</p>
            <h1 className="text-4xl font-bold mb-2">我喜欢的音乐</h1>
            <p className="text-muted-foreground mb-4">
              {songs.length} 首歌曲 · {albums.length} 张专辑
            </p>
            {songs.length > 0 && (
              <button
                onClick={handlePlayAll}
                className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-full font-medium hover:bg-primary/90 transition-colors"
              >
                <Play className="w-4 h-4 fill-current" />
                播放全部
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-6">
        <div className="flex gap-1 bg-muted/50 rounded-xl p-1 w-fit mb-6">
          <button
            onClick={() => setTab('songs')}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all',
              tab === 'songs' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Music2 className="w-4 h-4" />
            歌曲 {songs.length > 0 && <span className="text-xs text-muted-foreground ml-1">({songs.length})</span>}
          </button>
          <button
            onClick={() => setTab('albums')}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all',
              tab === 'albums' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Disc3 className="w-4 h-4" />
            专辑 {albums.length > 0 && <span className="text-xs text-muted-foreground ml-1">({albums.length})</span>}
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
              <Disc3 className="w-12 h-12 mb-3 opacity-20" />
              <p>暂无收藏专辑</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {albums.map(album => (
                <div
                  key={album.id}
                  className="group cursor-pointer"
                  onClick={() => navigate(`/albums/${album.id}`)}
                >
                  <div className="aspect-square rounded-xl overflow-hidden bg-muted mb-2">
                    {album.coverArt ? (
                      <img
                        src={hasAdapter() ? getAdapter().getCoverUrl(album.coverArt, 300) : album.coverArt}
                        alt={album.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Disc3 className="w-10 h-10 text-muted-foreground/30" />
                      </div>
                    )}
                  </div>
                  <p className="font-medium text-sm truncate group-hover:text-primary transition-colors">{album.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{album.artist}</p>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  )
}
