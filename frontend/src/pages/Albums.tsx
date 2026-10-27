/**
 * 专辑列表页 —— 封面墙（封面是唯一的大面积色块）
 * 大标题 + 总数；多源时一排分段胶囊切换音源；无限分页「加载更多」，加载中显示封面形骨架块
 *
 * 多源（PLAN 2.4）：只列声明 libraryBrowse 的音源；多个可浏览源时页头
 * 出现源切换 chip（?src=），浏览的是「选中的那一个源」而不是跨源拼接——
 * 专辑墙跨源混排需要先解决排序与去重语义，留给聚合视图迭代。
 */

import { useSearchParams } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { AlbumCard } from '@/components/music/AlbumCard'
import { CoverGrid } from '@/components/common/CoverCard'
import { useAlbumsInfinite } from '@/hooks/useServerQueries'
import { useBrowseSource } from '@/hooks/useSourceQueries'
import { SourceBadge } from '@/components/sources/SourceBadge'
import { EmptyState } from '@/components/common/EmptyState'
import { useT } from '@/i18n'
import { sourceParam } from '@/lib/sourceParam'

/** 封面形骨架：方块 + 两行图注，位置和真实卡片一致，换成真内容时版面不跳 */
function AlbumSkeletons({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} aria-hidden="true">
          <div className="aspect-square rounded-md bg-skeleton animate-pulse" />
          <div className="mt-3 h-3.5 w-3/4 rounded-sm bg-skeleton animate-pulse" />
          <div className="mt-2 h-3 w-1/2 rounded-sm bg-skeleton animate-pulse" />
        </div>
      ))}
    </>
  )
}

export default function AlbumsPage() {
  const { t } = useT()
  const [searchParams, setSearchParams] = useSearchParams()
  const srcParam = sourceParam(searchParams)
  const { available, current } = useBrowseSource(srcParam)
  const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useAlbumsInfinite(50, 'newest', current?.serverId)

  if (!current) {
    return (
      <div className="pt-2 regular:pt-4 animate-fade-in">
        <h1 className="font-display text-[34px] regular:text-[40px] font-semibold leading-[1.05] tracking-[-0.02em]">{t('section.albums')}</h1>
        <div className="mt-8">
          <EmptyState ruled title={t('sources.noBrowseTitle')} description={t('sources.noBrowseDesc')} />
        </div>
      </div>
    )
  }

  const albums = data?.pages.flatMap(p => p.items) ?? []

  // 计数：服务器返回精确总数时显示总数；否则显示已加载数量，有更多页时以 + 提示
  const total = data?.pages[0]?.total
  const countText = total != null ? String(total) : `${albums.length}${hasNextPage ? '+' : ''}`

  return (
    <div className="pt-2 regular:pt-4 animate-fade-in">
      <h1 className="font-display text-[34px] regular:text-[40px] font-semibold leading-[1.05] tracking-[-0.02em]">{t('section.albums')}</h1>
      {!isLoading && (
        <p className="num mt-3 text-sm text-ink-faint">
          {t('album.total', { count: countText })}
        </p>
      )}
      {available.length > 1 && (
        <div className="mt-5 inline-flex max-w-full gap-1 overflow-x-auto rounded-pill bg-paper-deep p-1 scrollbar-hide">
          {available.map(s => (
            <button
              key={s.serverId}
              /* 点当前项什么都不做。原来这里清空 ?src=，而 useBrowseSource 在没有
                 ?src= 时会回落「主库或第一个可浏览源」——于是点亮着的那个 chip，
                 浏览的库会跳到另一个源去。 */
              disabled={s.serverId === current.serverId}
              onClick={() => setSearchParams({ src: s.serverId }, { replace: true })}
              className={cn(
                'seg-option inline-flex min-h-11 flex-none items-center gap-2 whitespace-nowrap rounded-pill px-4 text-[14px] font-medium transition-colors duration-150',
                s.serverId === current.serverId
                  ? 'is-on disabled:cursor-default'
                  : 'text-ink-soft [@media(hover:hover)]:hover:text-ink'
              )}
            >
              <SourceBadge serverId={s.serverId} />
              <span>{s.name}</span>
            </button>
          ))}
        </div>
      )}

      <div className="mt-8">
        {isError && albums.length === 0 ? (
          <EmptyState
            ruled
            title={t('error.load.title')}
            description={t('error.load.description')}
            action={{ label: t('action.retry'), onClick: () => { void refetch() } }}
          />
        ) : isLoading ? (
          <CoverGrid>
            <AlbumSkeletons count={15} />
          </CoverGrid>
        ) : (
          <>
            <CoverGrid className="[&>*]:min-w-0">
              {albums.map(album => (
                <AlbumCard key={album.id} album={album} />
              ))}
            </CoverGrid>
            {isFetchingNextPage && (
              <CoverGrid className="mt-6">
                <AlbumSkeletons count={5} />
              </CoverGrid>
            )}
            {hasNextPage && !isFetchingNextPage && (
              <div className="mt-10 flex justify-center">
                <button
                  onClick={() => fetchNextPage()}
                  className="act-secondary inline-flex items-center gap-2 text-sm"
                >
                  {t('action.loadMore')}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
