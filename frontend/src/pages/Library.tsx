import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Music, Disc3, Mic2, ListMusic, LayoutGrid, List, Play, Shuffle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAlbums, useArtists, useSongs } from '@/hooks/useServerQueries'
import { usePlayerStore } from '@/store/playerStore'
import { AlbumCard } from '@/components/music/AlbumCard'
import { ArtistCard } from '@/components/music/ArtistCard'
import { SongList } from '@/components/music/SongList'

type LibraryTab = 'songs' | 'albums' | 'artists' | 'playlists'
type ViewMode = 'grid' | 'list'

export default function Library() {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<LibraryTab>('songs')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const playQueue     = usePlayerStore(s => s.playQueue)
  const toggleShuffle = usePlayerStore(s => s.toggleShuffle)
  const shuffle       = usePlayerStore(s => s.shuffle)

  const { data: albumPage } = useAlbums({ size: 200, sortBy: 'alphabeticalByName' })
  const { data: artists } = useArtists()
  const { data: songsPage, isLoading: songsLoading } = useSongs({ size: 500 })

  const albums = albumPage?.items ?? []
  const songs = songsPage?.items ?? []

  const tabs: { id: LibraryTab; label: string; icon: React.ComponentType<{className?: string}> }[] = [
    { id: 'songs', label: '歌曲', icon: Music },
    { id: 'albums', label: '专辑', icon: Disc3 },
    { id: 'artists', label: '歌手', icon: Mic2 },
    { id: 'playlists', label: '歌单', icon: ListMusic },
  ]

  function handlePlayAll() {
    if (!songs.length) return
    if (shuffle) toggleShuffle()
    playQueue(songs, 0)
  }

  function handleShuffle() {
    if (!songs.length) return
    if (!shuffle) toggleShuffle()
    playQueue(songs, 0)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 pt-6 pb-4 flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Music className="w-8 h-8 text-primary" />
            音乐库
          </h1>
          <div className="flex items-center gap-2">
            {/* View toggle */}
            <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
              <button
                onClick={() => setViewMode('grid')}
                className={cn(
                  'p-1.5 rounded transition-colors',
                  viewMode === 'grid' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={cn(
                  'p-1.5 rounded transition-colors',
                  viewMode === 'list' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <List className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-muted/50 rounded-xl p-1 w-fit">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all',
                activeTab === tab.id
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {activeTab === 'songs' && (
          <div>
            {/* 歌曲操作栏 */}
            {!songsLoading && songs.length > 0 && (
              <div className="flex items-center gap-3 mb-4">
                <button
                  onClick={handlePlayAll}
                  className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-full font-medium hover:bg-primary/90 transition-colors text-sm"
                >
                  <Play className="w-4 h-4" fill="currentColor" />
                  播放全部
                </button>
                <button
                  onClick={handleShuffle}
                  className="flex items-center gap-2 px-5 py-2.5 bg-muted hover:bg-muted/80 rounded-full font-medium transition-colors text-sm"
                >
                  <Shuffle className="w-4 h-4" />
                  随机播放
                </button>
                <span className="text-sm text-muted-foreground ml-2">{songs.length} 首歌曲</span>
              </div>
            )}
            {songsLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 10 }).map((_, i) => (
                  <div key={i} className="h-14 rounded-lg bg-muted animate-pulse" />
                ))}
              </div>
            ) : (
              <SongList songs={songs} showCover showAlbum showIndex />
            )}
          </div>
        )}

        {activeTab === 'albums' && (
          viewMode === 'grid' ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {albums.map(album => (
                <AlbumCard key={album.id} album={album} />
              ))}
            </div>
          ) : (
            <div className="space-y-1">
              {albums.map(album => (
                <div
                  key={album.id}
                  onClick={() => navigate(`/albums/${album.id}`)}
                  className="flex items-center gap-4 p-3 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors group"
                >
                  <img
                    src={album.coverArt ?? ''}
                    alt={album.name}
                    className="w-12 h-12 rounded-lg object-cover flex-shrink-0"
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate group-hover:text-primary transition-colors">{album.name}</p>
                    <p className="text-sm text-muted-foreground truncate">{album.artist}</p>
                  </div>
                  <div className="text-sm text-muted-foreground flex-shrink-0">
                    {album.year && <span>{album.year}</span>}
                    {album.songCount && <span className="ml-2">{album.songCount} 首</span>}
                  </div>
                </div>
              ))}
            </div>
          )
        )}

        {activeTab === 'artists' && (
          viewMode === 'grid' ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {(artists ?? []).map(artist => (
                <ArtistCard key={artist.id} artist={artist} />
              ))}
            </div>
          ) : (
            <div className="space-y-1">
              {(artists ?? []).map(artist => (
                <div
                  key={artist.id}
                  onClick={() => navigate(`/artists/${artist.id}`)}
                  className="flex items-center gap-4 p-3 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors group"
                >
                  <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center flex-shrink-0 overflow-hidden">
                    {artist.coverArt ? (
                      <img src={artist.coverArt} alt={artist.name} className="w-full h-full object-cover" />
                    ) : (
                      <Mic2 className="w-5 h-5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate group-hover:text-primary transition-colors">{artist.name}</p>
                    {artist.albumCount && (
                      <p className="text-sm text-muted-foreground">{artist.albumCount} 张专辑</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )
        )}

        {activeTab === 'playlists' && (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
            <ListMusic className="w-12 h-12 mb-3 opacity-30" />
            <p>请前往"歌单"页面管理</p>
            <button
              onClick={() => navigate('/playlists')}
              className="mt-3 text-primary hover:underline text-sm"
            >
              查看所有歌单
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
