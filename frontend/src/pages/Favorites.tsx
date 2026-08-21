import { useState } from 'react'
import { Play } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { useStarred } from '@/hooks/useServerQueries'
import { playAllInOrder } from '@/utils/playActions'
import { SongList } from '@/components/music/SongList'
import { AlbumCard } from '@/components/music/AlbumCard'
import { EmptyState } from '@/components/common/EmptyState'

type FavTab = 'songs' | 'albums'

export default function Favorites() {
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
      <div className="pt-8 animate-fade-in">
        <div className="h-9 w-56 rounded-sm bg-paper-deep animate-pulse" />
        <div className="mt-3 h-4 w-32 rounded-sm bg-paper-deep animate-pulse" />
        <div className="mt-10 border-t border-hair divide-y divide-hair-soft">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-3 py-2.5">
              <div className="h-4 w-6 rounded-sm bg-paper-deep animate-pulse" />
              <div className="h-10 w-10 rounded-sm bg-paper-deep animate-pulse" />
              <div className="h-4 flex-1 rounded-sm bg-paper-deep animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="pt-8 animate-fade-in">
      {/* 页头：衬线标题 + mono 统计 + 文字级主操作（DESIGN v2 §3/§4.1） */}
      <header className="flex items-end justify-between gap-6 border-b border-hair pb-6">
        <div>
          <h1 className="font-serif text-[30px] font-bold leading-tight tracking-[-0.01em]">
            我喜欢的音乐
            <span className="ml-4 align-[4px] font-sans text-[11px] font-normal tracking-[0.3em] text-ink-faint">
              FAVORITES
            </span>
          </h1>
          <p className="mt-1.5 text-sm text-ink-faint">
            <span className="font-num">{songs.length}</span> 首歌
            <span className="mx-1.5 text-ink-faint/60">·</span>
            <span className="font-num">{albums.length}</span> 张专辑
          </p>
        </div>
        {songs.length > 0 && (
          <button
            onClick={handlePlayAll}
            className="inline-flex flex-shrink-0 items-center gap-2 text-sm font-semibold underline decoration-hair decoration-1 underline-offset-[6px] transition-colors hover:text-primary hover:decoration-primary active:scale-[0.97]"
          >
            <Play className="w-3.5 h-3.5" weight="fill" />
            播放全部
          </button>
        )}
      </header>

      {/* 文字 tab：当前项 accent 短划线（同主导航范式） */}
      <div className="mb-8 flex items-center gap-8">
        <button
          onClick={() => setTab('songs')}
          className={cn(
            'relative pb-2.5 pt-5 text-sm tracking-[0.08em] transition-colors',
            tab === 'songs'
              ? 'font-semibold text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-primary'
              : 'text-ink-soft hover:text-foreground'
          )}
        >
          歌曲
          <span className="ml-1.5 font-num text-xs text-ink-faint">{songs.length}</span>
        </button>
        <button
          onClick={() => setTab('albums')}
          className={cn(
            'relative pb-2.5 pt-5 text-sm tracking-[0.08em] transition-colors',
            tab === 'albums'
              ? 'font-semibold text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-primary'
              : 'text-ink-soft hover:text-foreground'
          )}
        >
          专辑
          <span className="ml-1.5 font-num text-xs text-ink-faint">{albums.length}</span>
        </button>
      </div>

      {tab === 'songs' && (
        songs.length === 0 ? (
          <EmptyState
            ruled
            title="还没有收藏的歌曲。"
            description="在歌曲行点击心形图标，把喜欢的歌收进来。"
          />
        ) : (
          <SongList songs={songs} showAlbum />
        )
      )}

      {tab === 'albums' && (
        albums.length === 0 ? (
          <EmptyState
            ruled
            title="还没有收藏的专辑。"
            description="在专辑页点击心形图标，收藏整张专辑。"
          />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-x-6 gap-y-8">
            {albums.map(album => (
              <AlbumCard key={album.id} album={album} />
            ))}
          </div>
        )
      )}
    </div>
  )
}
