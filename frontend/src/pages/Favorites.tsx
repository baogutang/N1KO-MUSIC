/**
 * 收藏页（PLAN 2.4）：多源时按音源分节（歌曲/专辑双 tab 保留），
 * ?src=<serverId> 只看某一源；单源行为与原版一致。
 */

import { useState } from 'react'
import { Play } from '@phosphor-icons/react'
import { useSearchParams } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { useStarred } from '@/hooks/useServerQueries'
import { useConnectedSources, useSourceStarred } from '@/hooks/useSourceQueries'
import { playAllInOrder } from '@/utils/playActions'
import { SongList } from '@/components/music/SongList'
import { AlbumCard } from '@/components/music/AlbumCard'
import { SourceBadge } from '@/components/sources/SourceBadge'
import { EmptyState } from '@/components/common/EmptyState'
import { useT } from '@/i18n'

type FavTab = 'songs' | 'albums'

export default function Favorites() {
  const { t } = useT()
  const [tab, setTab] = useState<FavTab>('songs')
  const [searchParams] = useSearchParams()
  const srcFilter = searchParams.get('src') ?? undefined

  const sources = useConnectedSources()
  const multi = sources.length > 1 && !srcFilter

  // 单源 / ?src= 过滤：一条查询；多源：每源一条（失败塌缩成该节错误行）。
  // 多源时单源 hook 关掉，避免设了曲库范围后主库同一请求打两遍
  const starredGroups = useSourceStarred().filter(g => g.status !== 'loading')
  const single = useStarred(srcFilter, { enabled: !multi })
  const singleSongs = single.data?.songs ?? []
  const singleAlbums = single.data?.albums ?? []

  const sections = multi
    ? starredGroups.map(g => ({
        serverId: g.serverId,
        name: g.name,
        status: g.status,
        songs: g.data?.songs ?? [],
        albums: g.data?.albums ?? [],
      }))
    : srcFilter
      ? [{ serverId: srcFilter, name: sources.find(s => s.serverId === srcFilter)?.name ?? '', status: 'success' as const, songs: singleSongs, albums: singleAlbums }]
      : [{ serverId: '', name: '', status: 'success' as const, songs: singleSongs, albums: singleAlbums }]

  if (!multi && single.isLoading) {
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

  const allSongs = sections.flatMap(s => s.songs)
  const allAlbums = sections.flatMap(s => s.albums)

  return (
    <div className="pt-8 animate-fade-in">
      {/* 页头：衬线标题 + mono 统计 + 文字级主操作（DESIGN v2 §3/§4.1） */}
      <header className="flex items-end justify-between gap-6 border-b border-hair pb-6">
        <div>
          <h1 className="font-serif text-[30px] font-bold leading-tight tracking-[-0.01em]">
            {t('library.favoritesTitle')}
            <span className="latin-tag ml-4 align-[4px] font-sans text-[11px] font-normal tracking-[0.3em] text-ink-faint">
              FAVORITES
            </span>
          </h1>
          <p className="mt-1.5 font-num text-sm text-ink-faint">
            {t('library.favoritesCounts', { songs: allSongs.length, albums: allAlbums.length })}
          </p>
        </div>
        {allSongs.length > 0 && (
          <button
            onClick={() => playAllInOrder(allSongs, 0)}
            className="inline-flex flex-shrink-0 items-center gap-2 text-sm font-semibold underline decoration-hair decoration-1 underline-offset-[6px] transition-colors hover:text-primary hover:decoration-primary active:scale-[0.97]"
          >
            <Play className="w-3.5 h-3.5" weight="fill" />
            {t('player.playAll')}
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
          {t('library.songs')}
          <span className="ml-1.5 font-num text-xs text-ink-faint">{allSongs.length}</span>
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
          {t('library.albums')}
          <span className="ml-1.5 font-num text-xs text-ink-faint">{allAlbums.length}</span>
        </button>
      </div>

      {sections.map(section => {
        const songs = tab === 'songs' ? section.songs : []
        const albums = tab === 'albums' ? section.albums : []
        return (
          <section key={section.serverId || 'single'} className="mb-10">
            {multi && (
              <div className="section-head">
                <h2 className="flex items-center gap-2.5">
                  <SourceBadge serverId={section.serverId} withName />
                </h2>
              </div>
            )}
            {section.status === 'error' && (
              <p className="py-3 text-[13px] text-ink-faint border-t border-hair">
                {t('sources.loadError')}
              </p>
            )}
            {section.status === 'success' && tab === 'songs' && (
              songs.length === 0 && !multi ? (
                <EmptyState
                  ruled
                  title={t('empty.favoriteSongs.title')}
                  description={t('empty.favoriteSongs.description')}
                />
              ) : songs.length > 0 ? (
                <SongList songs={songs} showAlbum sourceBadge={multi} />
              ) : null
            )}
            {section.status === 'success' && tab === 'albums' && (
              albums.length === 0 && !multi ? (
                <EmptyState
                  ruled
                  title={t('empty.favoriteAlbums.title')}
                  description={t('empty.favoriteAlbums.description')}
                />
              ) : albums.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-x-6 gap-y-8">
                  {albums.map(album => (
                    <AlbumCard key={`${section.serverId}:${album.id}`} album={album} />
                  ))}
                </div>
              ) : null
            )}
          </section>
        )
      })}
    </div>
  )
}
