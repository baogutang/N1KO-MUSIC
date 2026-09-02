import { useState, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { MicrophoneStage, SquaresFour, List, Play, Shuffle } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { useAlbumsInfinite, useArtists, useSongsInfinite } from '@/hooks/useServerQueries'
import { EmptyState } from '@/components/common/EmptyState'
import { AlbumCard } from '@/components/music/AlbumCard'
import { ArtistCard } from '@/components/music/ArtistCard'
import { SongList } from '@/components/music/SongList'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'
import { findAdapterFor } from '@/api'
import { playAllInOrder, shuffleWholeLibrary } from '@/utils/playActions'
import { spaceCJK } from '@/utils/cjkTypography'
import { useT } from '@/i18n'

type LibraryTab = 'songs' | 'albums' | 'artists' | 'playlists'
type ViewMode = 'grid' | 'list'

/** 骨架行（hair-soft 底色闪烁，DESIGN §4.5，不用 spinner） */
function SkeletonRows({ count, cover }: { count: number; cover: boolean }) {
  return (
    <div className="border-t border-hair divide-y divide-hair-soft">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-3 py-2.5">
          <div className="h-3 w-8 rounded-sm bg-skeleton animate-pulse" />
          {cover && <div className="h-10 w-10 rounded-sm bg-skeleton animate-pulse" />}
          <div className="flex-1 space-y-2">
            <div className="h-3 w-1/3 rounded-sm bg-skeleton animate-pulse" />
            <div className="h-2.5 w-1/5 rounded-sm bg-skeleton animate-pulse" />
          </div>
          <div className="h-3 w-10 rounded-sm bg-skeleton animate-pulse" />
        </div>
      ))}
    </div>
  )
}

export default function Library() {
  const { t } = useT()
  const navigate = useNavigate()
  /**
   * 当前分页存进地址栏，而不是组件 state。
   *
   * 「点进一张专辑，看完退回来」是逛曲库的基本回路。tab 只活在组件里时，
   * 返回后一律回到「歌曲」，而滚动记忆又把你放回原来的偏移量——于是落在
   * 一个陌生 tab 的陌生位置上，比单纯回到顶部更让人失去方向。
   *
   * 用 replace 写入：切 tab 是改变当前位置的呈现，不是一个新去处，
   * 否则返回键要按掉每一次 tab 切换才能真正离开曲库页。
   */
  const [params, setParams] = useSearchParams()
  const tabParam = params.get('tab')
  const activeTab: LibraryTab =
    tabParam === 'albums' || tabParam === 'artists' ? tabParam : 'songs'
  const setActiveTab = useCallback((tab: LibraryTab) => {
    const updated = new URLSearchParams(params)
    if (tab === 'songs') updated.delete('tab')
    else updated.set('tab', tab)
    setParams(updated, { replace: true })
  }, [params, setParams])
  const [viewMode, setViewMode] = useState<ViewMode>('grid')

  // 分页加载专辑，避免静默截断在前 200 张（type 为 Subsonic getAlbumList2 的排序类型）
  const {
    data: albumsData,
    isError: albumsError,
    refetch: refetchAlbums,
    fetchNextPage: fetchNextAlbums,
    hasNextPage: hasNextAlbums,
    isFetchingNextPage: isFetchingNextAlbums,
  } = useAlbumsInfinite(50, 'alphabeticalByName')
  const { data: artists, isError: artistsError, refetch: refetchArtists } = useArtists()
  const {
    data: songsData,
    isLoading: songsLoading,
    isError: songsError,
    refetch: refetchSongs,
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
    { id: 'songs', label: t('library.songs') },
    { id: 'albums', label: t('library.albums') },
    { id: 'artists', label: t('nav.artists') },
    { id: 'playlists', label: t('nav.playlists') },
  ]

  return (
    <div className="pt-9 animate-fade-in">
      {/* 页头：衬线标题 + mono 计数；右侧细线小图标键切换视图 */}
      <div className="flex items-end justify-between gap-6">
        <div className="min-w-0">
          <h1 className="font-serif text-3xl font-bold tracking-tight text-ink">{t('nav.library')}</h1>
          <p className="num text-sm text-ink-soft mt-1.5">
            {t('library.counts', {
              songs: songCountText,
              albums: albumCountText,
              artists: (artists ?? []).length,
            })}
          </p>
        </div>
        {/* 歌曲 tab 是行列表，没有网格形态——开关在那里点了没反应，
            而它偏偏是默认 tab。不适用就不出现，别让人怀疑是不是坏了。 */}
        <div className={cn(
          'flex items-center gap-1.5 flex-shrink-0',
          activeTab === 'songs' && 'hidden'
        )}>
          <button
            onClick={() => setViewMode('grid')}
            className={cn(
              'act-icon w-8 h-8 grid place-items-center rounded-full border transition-colors duration-200 active:scale-[0.94]',
              viewMode === 'grid'
                ? 'border-primary text-primary'
                : 'border-transparent text-ink-soft hover:border-hair hover:text-ink'
            )}
            aria-label={t('library.gridView')}
          >
            <SquaresFour size={16} />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={cn(
              'act-icon w-8 h-8 grid place-items-center rounded-full border transition-colors duration-200 active:scale-[0.94]',
              viewMode === 'list'
                ? 'border-primary text-primary'
                : 'border-transparent text-ink-soft hover:border-hair hover:text-ink'
            )}
            aria-label={t('library.listView')}
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
                  <h2 className="font-serif text-xl font-bold text-ink">{t('library.allSongs')}</h2>
                  <span className="num text-xs text-ink-faint">{t('library.loaded', { count: songs.length })}</span>
                </div>
                <div className="flex items-center gap-6">
                  {/* 主操作：纯文字 ▶ + 发丝下划线，hover 变 accent（DESIGN §4.1） */}
                  <button
                    onClick={() => playAllInOrder(songs, 0)}
                    className="act-primary inline-flex items-center gap-2 border-b border-ink pb-1 text-sm font-semibold tracking-[0.1em] text-ink transition-colors duration-200 hover:border-primary hover:text-primary active:scale-[0.97]"
                  >
                    <Play size={13} weight="fill" />
                    {t('player.playAll')}
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
                    className="act-secondary inline-flex items-center gap-2 rounded border border-hair px-3.5 py-1.5 text-[13px] text-ink-soft transition-colors duration-200 hover:border-ink hover:text-ink active:scale-[0.97] disabled:opacity-50"
                  >
                    <Shuffle size={14} className={shufflingAll ? 'animate-spin' : undefined} />
                    {shufflingAll ? t('library.shuffling') : t('player.shuffleAll')}
                  </button>
                </div>
              </div>
            )}
            {songsError && songs.length === 0 ? (
              /* 查询失败时若直接渲染空列表，「服务器出错」和「曲库是空的」
                 长得一模一样，用户既得不到解释也没有重试入口。

                 但只在**一条都没有**时才整页换成错误态：否则「加载更多」
                 失败会把已经看到的几百首整个抹掉，代价远大于那条错误信息
                 的价值。已有内容时保留列表，让底部的分页按钮自己表达失败。 */
              <EmptyState
                ruled
                title={t('error.load.title')}
                description={t('error.load.description')}
                action={{ label: t('action.retry'), onClick: () => { void refetchSongs() } }}
              />
            ) : songsLoading ? (
              <SkeletonRows count={10} cover />
            ) : (
              <>
                <SongList songs={songs} showCover showAlbum showIndex />
                {isFetchingNextPage && <SkeletonRows count={3} cover />}
                {hasNextPage && !isFetchingNextPage && (
                  <div className="mt-8 flex justify-center">
                    <button
                      onClick={() => fetchNextPage()}
                      className="act-secondary inline-flex items-center gap-2 rounded border border-hair px-5 py-2 text-[13px] text-ink-soft transition-colors duration-200 hover:border-ink hover:text-ink active:scale-[0.97]"
                    >
                      {t('library.loadMoreSongs')}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {activeTab === 'albums' && (albumsError && albums.length === 0 ? (
          <EmptyState
            ruled
            title={t('error.load.title')}
            description={t('error.load.description')}
            action={{ label: t('action.retry'), onClick: () => { void refetchAlbums() } }}
          />
        ) : (
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
                        src={album.coverArt ? (findAdapterFor(album.serverId)?.getCoverUrl(album.coverArt, 96) ?? undefined) : undefined}
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
                      {album.songCount != null && <span className="ml-3">{t('song.count', { count: album.songCount })}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {isFetchingNextAlbums && (
              viewMode === 'grid' ? (
                <div className="mt-7 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-x-5 gap-y-7">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="aspect-square rounded-md bg-skeleton animate-pulse" />
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
                  className="act-secondary inline-flex items-center gap-2 rounded border border-hair px-5 py-2 text-[13px] text-ink-soft transition-colors duration-200 hover:border-ink hover:text-ink active:scale-[0.97]"
                >
                  {t('library.loadMoreAlbums')}
                </button>
              </div>
            )}
          </>
        ))}

        {activeTab === 'artists' && (artistsError && (artists ?? []).length === 0 ? (
          <EmptyState
            ruled
            title={t('error.load.title')}
            description={t('error.load.description')}
            action={{ label: t('action.retry'), onClick: () => { void refetchArtists() } }}
          />
        ) : (
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
                        src={findAdapterFor(artist.serverId)?.getCoverUrl(artist.coverArt, 96) ?? artist.coverArt}
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
                      <p className="num text-xs text-ink-soft mt-0.5">{t('album.count', { count: artist.albumCount })}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )
        ))}
      </div>
    </div>
  )
}
