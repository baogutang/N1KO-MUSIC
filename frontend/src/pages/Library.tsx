import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MicrophoneStage, SquaresFour, List, Play, Shuffle, CircleNotch } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { useAlbumsInfinite, useArtists, useSongsInfinite } from '@/hooks/useServerQueries'
import { AlbumCard } from '@/components/music/AlbumCard'
import { ArtistCard } from '@/components/music/ArtistCard'
import { SongList } from '@/components/music/SongList'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'
import { getAdapter, hasAdapter } from '@/api'
import { playAllInOrder, playAllShuffled } from '@/utils/playActions'

type LibraryTab = 'songs' | 'albums' | 'artists' | 'playlists'
type ViewMode = 'grid' | 'list'

export default function Library() {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<LibraryTab>('songs')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')

  // 分页加载专辑，避免静默截断在前 200 张（type 为 Subsonic getAlbumList2 的排序类型）
  const {
    data: albumsData,
    fetchNextPage: fetchNextAlbums,
    hasNextPage: hasNextAlbums,
    isFetchingNextPage: isFetchingNextAlbums,
  } = useAlbumsInfinite(50, 'alphabeticalByName')
  const { data: artists } = useArtists()
  const {
    data: songsData,
    isLoading: songsLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useSongsInfinite(100)

  const albums = albumsData?.pages.flatMap(p => p.items) ?? []
  const songs = songsData?.pages.flatMap(p => p.items) ?? []

  const tabs: { id: LibraryTab; label: string }[] = [
    { id: 'songs', label: '歌曲' },
    { id: 'albums', label: '专辑' },
    { id: 'artists', label: '歌手' },
    { id: 'playlists', label: '歌单' },
  ]

  return (
    <div className="flex flex-col h-full">
      <div className="px-8 pt-8 flex-shrink-0 w-full max-w-[1320px] mx-auto">
        <div className="flex items-end justify-between mb-6">
          <div className="min-w-0">
            <h1 className="text-3xl font-bold tracking-tight text-foreground">音乐库</h1>
            <p className="text-sm text-muted-foreground mt-1.5">
              <span className="font-num">{songs.length}{hasNextPage ? '+' : ''}</span> 首歌曲 · <span className="font-num">{albums.length}{hasNextAlbums ? '+' : ''}</span> 张专辑 · <span className="font-num">{(artists ?? []).length}</span> 位歌手
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
              <button
                onClick={() => setViewMode('grid')}
                className={cn(
                  'w-8 h-8 grid place-items-center rounded-md transition-colors active:scale-[0.94]',
                  viewMode === 'grid' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'
                )}
                aria-label="网格视图"
              >
                <SquaresFour size={16} />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={cn(
                  'w-8 h-8 grid place-items-center rounded-md transition-colors active:scale-[0.94]',
                  viewMode === 'list' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'
                )}
                aria-label="列表视图"
              >
                <List size={16} />
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-6 border-b border-border">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => tab.id === 'playlists' ? navigate('/playlists') : setActiveTab(tab.id)}
              className={cn(
                'relative pt-1 pb-3 text-sm transition-colors',
                activeTab === tab.id
                  ? 'text-foreground font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {tab.label}
              {activeTab === tab.id && (
                <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-primary" />
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="px-8 pt-7 pb-10 w-full max-w-[1320px] mx-auto">
        {activeTab === 'songs' && (
          <div>
            {!songsLoading && songs.length > 0 && (
              <div className="flex items-center gap-3 mb-6">
                <button
                  onClick={() => playAllInOrder(songs, 0)}
                  className="inline-flex items-center gap-2 h-10 px-5 rounded-full bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors active:scale-[0.97]"
                >
                  <Play size={16} weight="fill" />
                  播放全部
                </button>
                <button
                  onClick={() => playAllShuffled(songs, 0)}
                  className="inline-flex items-center gap-2 h-10 px-5 rounded-full border border-border text-sm font-semibold text-foreground hover:border-primary hover:text-primary transition-colors active:scale-[0.97]"
                >
                  <Shuffle size={16} />
                  随机播放
                </button>
                <span className="text-sm text-muted-foreground ml-2"><span className="font-num">{songs.length}</span> 首歌曲{hasNextPage ? '+' : ''}</span>
              </div>
            )}
            {songsLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 10 }).map((_, i) => (
                  <div key={i} className="h-14 rounded-lg bg-accent animate-pulse" />
                ))}
              </div>
            ) : (
              <>
                <SongList songs={songs} showCover showAlbum showIndex />
                {hasNextPage && (
                  <div className="flex justify-center mt-6">
                    <button
                      onClick={() => fetchNextPage()}
                      disabled={isFetchingNextPage}
                      className="inline-flex items-center gap-2 h-10 px-6 rounded-full border border-border text-sm text-foreground hover:border-primary hover:text-primary transition-colors active:scale-[0.97] disabled:opacity-50"
                    >
                      {isFetchingNextPage && <CircleNotch size={16} className="animate-spin" />}
                      加载更多歌曲
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {activeTab === 'albums' && (
          <>
          {viewMode === 'grid' ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-x-5 gap-y-6 [&>*]:min-w-0">
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
                  className="flex items-center gap-4 px-3 py-2.5 rounded-lg hover:bg-surface cursor-pointer transition-colors group"
                >
                  <div className="w-12 h-12 rounded-md overflow-hidden ring-1 ring-border flex-shrink-0">
                    <ImageWithFallback
                      src={album.coverArt && hasAdapter() ? getAdapter().getCoverUrl(album.coverArt, 96) : undefined}
                      alt={album.name}
                      fallbackType="album"
                      className="w-full h-full"
                      customCoverParams={{ type: 'album', artist: album.artist, album: album.name }}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate group-hover:text-primary transition-colors">{album.name}</p>
                    <p className="text-sm text-muted-foreground truncate">{album.artist}</p>
                  </div>
                  <div className="text-sm text-muted-foreground font-num flex-shrink-0">
                    {album.year && <span>{album.year}</span>}
                    {album.songCount && <span className="ml-2">{album.songCount} 首</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
          {hasNextAlbums && (
            <div className="flex justify-center mt-6">
              <button
                onClick={() => fetchNextAlbums()}
                disabled={isFetchingNextAlbums}
                className="inline-flex items-center gap-2 h-10 px-6 rounded-full border border-border text-sm text-foreground hover:border-primary hover:text-primary transition-colors active:scale-[0.97] disabled:opacity-50"
              >
                {isFetchingNextAlbums && <CircleNotch size={16} className="animate-spin" />}
                加载更多专辑
              </button>
            </div>
          )}
          </>
        )}

        {activeTab === 'artists' && (
          viewMode === 'grid' ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-x-5 gap-y-6 [&>*]:min-w-0">
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
                  className="flex items-center gap-4 px-3 py-2.5 rounded-lg hover:bg-surface cursor-pointer transition-colors group"
                >
                  <div className="w-12 h-12 rounded-full bg-accent ring-1 ring-border flex items-center justify-center flex-shrink-0 overflow-hidden">
                    {artist.coverArt ? (
                      <ImageWithFallback
                        src={hasAdapter() ? getAdapter().getCoverUrl(artist.coverArt, 96) : artist.coverArt}
                        alt={artist.name}
                        fallbackType="artist"
                        className="w-full h-full"
                      />
                    ) : (
                      <MicrophoneStage size={20} className="text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate group-hover:text-primary transition-colors">{artist.name}</p>
                    {artist.albumCount && (
                      <p className="text-sm text-muted-foreground"><span className="font-num">{artist.albumCount}</span> 张专辑</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )
        )}
        </div>
      </div>
    </div>
  )
}
