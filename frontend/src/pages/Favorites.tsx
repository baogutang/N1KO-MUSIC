/**
 * 收藏页（PLAN 2.4）：多源时按音源分节（歌曲/专辑双分段保留），
 * ?src=<serverId> 只看某一源；单源行为与原版一致。
 * 版式：大标题 + 体量说明 + 播放全部（青柠）；一枚分段控件切歌曲 / 专辑；专辑是封面网格。
 */

import { useState } from 'react'
import { Play } from '@phosphor-icons/react'
import { useSearchParams } from 'react-router-dom'
import { motion } from 'motion/react'
import { cn } from '@/lib/utils'
import { SPRING_SNAPPY } from '@/lib/motion'
import { useStarred } from '@/hooks/useServerQueries'
import { useConnectedSources, useSourceStarred } from '@/hooks/useSourceQueries'
import { playAllInOrder } from '@/utils/playActions'
import { SongList } from '@/components/music/SongList'
import { AlbumCard } from '@/components/music/AlbumCard'
import { useQueryClient } from '@tanstack/react-query'
import { SourceBadge } from '@/components/sources/SourceBadge'
import { SourceGroupState } from '@/components/sources/SourceGroupState'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/common/EmptyState'
import { SongRowsSkeleton } from '@/components/common/SongRowsSkeleton'
import { CoverGrid } from '@/components/common/CoverCard'
import { useT } from '@/i18n'
import { sourceParam } from '@/lib/sourceParam'

type FavTab = 'songs' | 'albums'

/**
 * 分段控件的一格：看起来 36px，触点用 ::before 向上下各多出 4px（落在轨道的内边距里），凑足 44px。
 */
const SEG_OPTION =
  'press-pop relative isolate inline-flex h-9 flex-none items-center gap-2 whitespace-nowrap rounded-pill px-4 text-[14px] font-semibold before:absolute before:inset-x-0 before:-inset-y-1'

/** 当前格底下托起的那块片。暗色下 surface 与轨道（ink 6%）几乎同亮（对比 1.03:1），改用 fill-2 才托得起来 */
const SEG_PILL = 'absolute inset-0 -z-10 rounded-pill seg-pill'

export default function Favorites() {
  const { t } = useT()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<FavTab>('songs')
  const [searchParams] = useSearchParams()
  const srcFilter = sourceParam(searchParams)

  const sources = useConnectedSources()
  const multi = sources.length > 1 && !srcFilter

  // 单源 / ?src= 过滤：一条查询；多源：每源一条（失败塌缩成该节错误行）。
  // 多源时单源 hook 关掉，避免设了曲库范围后主库同一请求打两遍
  /*
   * 保留加载中的分组。
   *
   * 丢掉它们的后果是：慢源返回的那一刻，一整节凭空插进页面中部，
   * 正在看的内容被顶下去；而且「这个源在转」和「这个源坏了」长得一模一样。
   * 三态各自呈现，位置从一开始就占住。
   */
  const starredGroups = useSourceStarred()
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
      ? [{ serverId: srcFilter, name: sources.find(s => s.serverId === srcFilter)?.name ?? '', status: single.isError ? 'error' as const : single.isLoading ? 'loading' as const : 'success' as const, songs: singleSongs, albums: singleAlbums }]
      : [{ serverId: '', name: '', status: single.isError ? 'error' as const : single.isLoading ? 'loading' as const : 'success' as const, songs: singleSongs, albums: singleAlbums }]

  if (!multi && single.isLoading) {
    return (
      <div className="pt-2 regular:pt-4" aria-hidden="true">
        <div className="skeleton h-9 w-60 rounded-md regular:h-11" />
        <div className="skeleton mt-4 h-4 w-40 rounded-pill" />
        <div className="mt-10">
          <SongRowsSkeleton rows={8} />
        </div>
      </div>
    )
  }

  const allSongs = sections.flatMap(s => s.songs)
  const allAlbums = sections.flatMap(s => s.albums)

  const tabs: { key: FavTab; label: string; count: number }[] = [
    { key: 'songs', label: t('library.songs'), count: allSongs.length },
    { key: 'albums', label: t('library.albums'), count: allAlbums.length },
  ]

  return (
    <div className="pt-2 regular:pt-4">
      {/* 页头：大标题 + 体量说明（各自独立的 span）+ 青柠主操作 */}
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <h1 className="font-display text-[34px] font-bold leading-[1.05] tracking-[-0.03em] text-ink regular:text-[44px]">
            {t('library.favoritesTitle')}
          </h1>
          <p className="num mt-3 flex flex-wrap gap-x-3 text-[14px] font-medium text-ink-3">
            <span>{t('library.songsCount', { count: allSongs.length })}</span>
            <span>{t('library.albumsCount', { count: allAlbums.length })}</span>
          </p>
        </div>
        {allSongs.length > 0 && (
          <Button className="flex-shrink-0" onClick={() => playAllInOrder(allSongs, 0)}>
            <Play size={18} weight="fill" />
            {t('player.playAll')}
          </Button>
        )}
      </header>

      {/* 分段控件：歌曲 / 专辑，当前项是轨道里被托起的一块，换项时它会滑过去 */}
      <div className="mt-6 inline-flex max-w-full overflow-x-auto rounded-pill bg-ink/[0.06] p-1 scrollbar-hide">
        {tabs.map(item => {
          const active = tab === item.key
          return (
            <button
              key={item.key}
              onClick={() => setTab(item.key)}
              aria-pressed={active}
              className={cn(SEG_OPTION, active ? 'text-ink' : 'text-ink-3 hover:text-ink-2')}
            >
              {active && (
                <motion.span
                  layoutId="favorites-tabs"
                  transition={SPRING_SNAPPY}
                  aria-hidden="true"
                  className={SEG_PILL}
                />
              )}
              {item.label}
              <span className="num text-[13px] text-ink-3">{item.count}</span>
            </button>
          )
        })}
      </div>

      <div className="mt-6">
        {sections.map(section => {
          const songs = tab === 'songs' ? section.songs : []
          const albums = tab === 'albums' ? section.albums : []
          return (
            <section key={section.serverId || 'single'} className="mb-10">
              {multi && (
                <div className="section-head !pt-4">
                  <h2 className="flex items-center gap-2.5">
                    <SourceBadge serverId={section.serverId} withName />
                  </h2>
                </div>
              )}
              {section.status !== 'success' && (
                <SourceGroupState
                  serverId={section.serverId}
                  status={section.status}
                  onRetry={() =>
                    queryClient.invalidateQueries({
                      predicate: query => query.queryKey[1] === 'starred',
                    })
                  }
                />
              )}
              {section.status === 'success' && tab === 'songs' && (
                songs.length === 0 ? (
                  /* 多源下也要给空态：只留一个孤零零的音源名，
                     「这个源没有收藏」和「这个源坏了」就分不出来了 */
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
                albums.length === 0 ? (
                  <EmptyState
                    ruled
                    title={t('empty.favoriteAlbums.title')}
                    description={t('empty.favoriteAlbums.description')}
                  />
                ) : albums.length > 0 ? (
                  <CoverGrid>
                    {albums.map(album => (
                      <AlbumCard key={`${section.serverId}:${album.id}`} album={album} />
                    ))}
                  </CoverGrid>
                ) : null
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
