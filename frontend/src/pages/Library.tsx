import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MicrophoneStage, SquaresFour, List, Play, Shuffle } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { useAlbumsInfinite, useArtists, useSongsInfinite } from '@/hooks/useServerQueries'
import { AlbumCard } from '@/components/music/AlbumCard'
import { ArtistCard } from '@/components/music/ArtistCard'
import { SongList } from '@/components/music/SongList'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'
import { getAdapter, hasAdapter } from '@/api'
import { playAllInOrder, shuffleWholeLibrary } from '@/utils/playActions'
import { spaceCJK } from '@/utils/cjkTypography'

type LibraryTab = 'songs' | 'albums' | 'artists' | 'playlists'
type ViewMode = 'grid' | 'list'

/** 骨架行（hair-soft 底色闪烁，DESIGN §4.5，不用 spinner） */
function SkeletonRows({ count, cover }: { count: number; cover: boolean }) {
  return (
    <div className="border-t border-hair divide-y divide-hair-soft">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-3 py-2.5">
          <div className="h-3 w-8 rounded-sm bg-hair-soft animate-pulse" />
          {cover && <div className="h-10 w-10 rounded-sm bg-hair-soft animate-pulse" />}
          <div className="flex-1 space-y-2">
            <div className="h-3 w-1/3 rounded-sm bg-hair-soft animate-pulse" />
            <div className="h-2.5 w-1/5 rounded-sm bg-hair-soft animate-pulse" />
          </div>
          <div className="h-3 w-10 rounded-sm bg-hair-soft animate-pulse" />
        </div>
      ))}
    </div>
  )
}

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

  const [shufflingAll, setShufflingAll] = useState(false)
  async function handleShuffleAll() {
    if (shufflingAll) return
    setShufflingAll(true)
    try {
      await shuffleWholeLibrary(songs)
    } finally {
      setShufflingAll(false)
    }
  }

  // 计数展示：服务器返回精确总数时直接显示总数；否则显示已加载数量，还有更多页时以 + 提示
  const songsTotal = songsData?.pages[0]?.total
  const songCountText = songsTotal != null ? String(songsTotal) : `${songs.length}${hasNextPage ? '+' : ''}`
  const albumsTotal = albumsData?.pages[0]?.total
  const albumCountText = albumsTotal != null ? String(albumsTotal) : `${albums.length}${hasNextAlbums ? '+' : ''}`

  const tabs: { id: LibraryTab; label: string }[] = [
    { id: 'songs', label: '歌曲' },
    { id: 'albums', label: '专辑' },
    { id: 'artists', label: '歌手' },
    { id: 'playlists', label: '歌单' },
  ]

  return (
    <div className="pt-9 animate-fade-in">
      {/* 页头：衬线标题 + mono 计数；右侧细线小图标键切换视图 */}
      <div className="flex items-end justify-between gap-6">
        <div className="min-w-0">
          <h1 className="font-serif text-3xl font-bold tracking-tight text-ink">音乐库</h1>
          <p className="text-sm text-ink-soft mt-1.5">
            <span className="num">{songCountText}</span> 首歌曲 · <span className="num">{albumCountText}</span> 张专辑 · <span className="num">{(artists ?? []).length}</span> 位歌手
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={() => setViewMode('grid')}
            className={cn(
              'w-8 h-8 grid place-items-center rounded-full border transition-colors duration-200 active:scale-[0.94]',
              viewMode === 'grid'
                ? 'border-primary text-primary'
                : 'border-transparent text-ink-soft hover:border-hair hover:text-ink'
            )}
            aria-label="网格视图"
          >
            <SquaresFour size={16} />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={cn(
              'w-8 h-8 grid place-items-center rounded-full border transition-colors duration-200 active:scale-[0.94]',
              viewMode === 'list'
                ? 'border-primary text-primary'
                : 'border-transparent text-ink-soft hover:border-hair hover:text-ink'
            )}
            aria-label="列表视图"
          >
            <List size={16} />
          </button>
        </div>
      </div>

      {/* 文字 tab：sans 小标签 wide-tracking，当前项 accent + 2px 短划线（DESIGN §3 导航范式） */}
      <div className="mt-7 flex items-center gap-8 border-b border-hair">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => tab.id === 'playlists' ? navigate('/playlists') : setActiveTab(tab.id)}
            className={cn(
              'relative pb-3 text-[13px] tracking-[0.2em] transition-colors duration-200',
              activeTab === tab.id
                ? 'text-primary font-semibold'
                : 'text-ink-soft hover:text-primary'
            )}
          >
            {tab.label}
            {activeTab === tab.id && (
              <span className="absolute -bottom-px left-1/2 h-[2px] w-6 -translate-x-1/2 bg-primary" />
            )}
          </button>
        ))}
      </div>

      <div className="pt-8">
        {activeTab === 'songs' && (
          <div>
            {!songsLoading && songs.length > 0 && (
              <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
                <div className="flex items-baseline gap-3">
                  <h2 className="font-serif text-xl font-bold text-ink">全部歌曲</h2>
                  <span className="num text-xs text-ink-faint">已加载 {songs.length} 首</span>
                </div>
                <div className="flex items-center gap-6">
                  {/* 主操作：纯文字 ▶ + 发丝下划线，hover 变 accent（DESIGN §4.1） */}
                  <button
                    onClick={() => playAllInOrder(songs, 0)}
                    className="inline-flex items-center gap-2 border-b border-ink pb-1 text-sm font-semibold tracking-[0.1em] text-ink transition-colors duration-200 hover:border-primary hover:text-primary active:scale-[0.97]"
                  >
                    <Play size={13} weight="fill" />
                    播放全部
                  </button>
                  {/* 次操作：细线小钮，hover 边框变 ink（DESIGN §4.1） */}
                  {/*
                    全库随机：向服务端要一批随机取样，而不是对已加载的这一页洗牌。
                    列表分页加载，首屏只有 100 首且是服务端固定排序的前 100 首，
                    对它洗牌听感上就是「随机播放还是按排序在放」。
                  */}
                  <button
                    onClick={handleShuffleAll}
                    disabled={shufflingAll}
                    className="inline-flex items-center gap-2 rounded border border-hair px-3.5 py-1.5 text-[13px] text-ink-soft transition-colors duration-200 hover:border-ink hover:text-ink active:scale-[0.97] disabled:opacity-50"
                  >
                    <Shuffle size={14} className={shufflingAll ? 'animate-spin' : undefined} />
                    {shufflingAll ? '抽取中' : '全库随机'}
                  </button>
                </div>
              </div>
            )}
            {songsLoading ? (
              <SkeletonRows count={10} cover />
            ) : (
              <>
                <SongList songs={songs} showCover showAlbum showIndex />
                {isFetchingNextPage && <SkeletonRows count={3} cover />}
                {hasNextPage && !isFetchingNextPage && (
                  <div className="mt-8 flex justify-center">
                    <button
                      onClick={() => fetchNextPage()}
                      className="inline-flex items-center gap-2 rounded border border-hair px-5 py-2 text-[13px] text-ink-soft transition-colors duration-200 hover:border-ink hover:text-ink active:scale-[0.97]"
                    >
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
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-x-5 gap-y-7 [&>*]:min-w-0">
                {albums.map(album => (
                  <AlbumCard key={album.id} album={album} />
                ))}
              </div>
            ) : (
              <div className="border-t border-hair divide-y divide-hair-soft">
                {albums.map(album => (
                  <div
                    key={album.id}
                    onClick={() => navigate(`/albums/${album.id}`)}
                    className="group flex cursor-pointer items-center gap-4 px-2 py-3 transition-all duration-200 hover:translate-x-1 hover:bg-paper-deep"
                  >
                    <div className="h-11 w-11 flex-shrink-0 overflow-hidden rounded-sm ring-1 ring-hair-soft">
                      <ImageWithFallback
                        src={album.coverArt && hasAdapter() ? getAdapter().getCoverUrl(album.coverArt, 96) : undefined}
                        alt={album.name}
                        fallbackType="album"
                        className="w-full h-full"
                        customCoverParams={{ type: 'album', artist: album.artist, album: album.name }}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-serif text-[15px] font-semibold truncate transition-colors group-hover:text-primary">{spaceCJK(album.name)}</p>
                      <p className="text-xs text-ink-soft truncate mt-0.5">{spaceCJK(album.artist)}</p>
                    </div>
                    <div className="num flex-shrink-0 text-xs text-ink-faint">
                      {album.year && <span>{album.year}</span>}
                      {album.songCount != null && <span className="ml-3">{album.songCount} 首</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {isFetchingNextAlbums && (
              viewMode === 'grid' ? (
                <div className="mt-7 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-x-5 gap-y-7">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="aspect-square rounded-md bg-hair-soft animate-pulse" />
                  ))}
                </div>
              ) : (
                <SkeletonRows count={3} cover />
              )
            )}
            {hasNextAlbums && !isFetchingNextAlbums && (
              <div className="mt-8 flex justify-center">
                <button
                  onClick={() => fetchNextAlbums()}
                  className="inline-flex items-center gap-2 rounded border border-hair px-5 py-2 text-[13px] text-ink-soft transition-colors duration-200 hover:border-ink hover:text-ink active:scale-[0.97]"
                >
                  加载更多专辑
                </button>
              </div>
            )}
          </>
        )}

        {activeTab === 'artists' && (
          viewMode === 'grid' ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-x-5 gap-y-7 [&>*]:min-w-0">
              {(artists ?? []).map(artist => (
                <ArtistCard key={artist.id} artist={artist} />
              ))}
            </div>
          ) : (
            <div className="border-t border-hair divide-y divide-hair-soft">
              {(artists ?? []).map(artist => (
                <div
                  key={artist.id}
                  onClick={() => navigate(`/artists/${artist.id}`)}
                  className="group flex cursor-pointer items-center gap-4 px-2 py-3 transition-all duration-200 hover:translate-x-1 hover:bg-paper-deep"
                >
                  <div className="h-11 w-11 flex-shrink-0 overflow-hidden rounded-full ring-1 ring-hair-soft">
                    {artist.coverArt ? (
                      <ImageWithFallback
                        src={hasAdapter() ? getAdapter().getCoverUrl(artist.coverArt, 96) : artist.coverArt}
                        alt={artist.name}
                        fallbackType="artist"
                        className="w-full h-full"
                      />
                    ) : (
                      <div className="grid h-full w-full place-items-center bg-paper-deep">
                        <MicrophoneStage size={18} className="text-ink-faint" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-serif text-[15px] font-semibold truncate transition-colors group-hover:text-primary">{spaceCJK(artist.name)}</p>
                    {artist.albumCount != null && (
                      <p className="text-xs text-ink-soft mt-0.5"><span className="num">{artist.albumCount}</span> 张专辑</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  )
}
