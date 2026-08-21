/**
 * 专辑列表页 —— 封面墙（封面即内容，DESIGN v2 §3）
 * 衬线页头 + mono 总数；无限分页「加载更多」，加载中显示封面形骨架块
 */

import { AlbumCard } from '@/components/music/AlbumCard'
import { useAlbumsInfinite } from '@/hooks/useServerQueries'
import { useT } from '@/i18n'

const GRID_CLASS = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-x-5 gap-y-7'

export default function AlbumsPage() {
  const { t } = useT()
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useAlbumsInfinite(50)

  const albums = data?.pages.flatMap(p => p.items) ?? []

  // 计数：服务器返回精确总数时显示总数；否则显示已加载数量，有更多页时以 + 提示
  const total = data?.pages[0]?.total
  const countText = total != null ? String(total) : `${albums.length}${hasNextPage ? '+' : ''}`

  return (
    <div className="pt-9 animate-fade-in">
      <div className="mb-8">
        <h1 className="font-serif text-3xl font-bold tracking-tight text-ink">{t('section.albums')}</h1>
        {!isLoading && (
          <p className="text-sm text-ink-soft mt-1.5">
            {t('album.total', { count: countText })}
          </p>
        )}
      </div>

      {isLoading ? (
        <div className={GRID_CLASS}>
          {Array.from({ length: 15 }).map((_, i) => (
            <div key={i} className="aspect-square rounded-md bg-hair-soft animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          <div className={`${GRID_CLASS} [&>*]:min-w-0`}>
            {albums.map(album => (
              <AlbumCard key={album.id} album={album} />
            ))}
          </div>
          {isFetchingNextPage && (
            <div className={`${GRID_CLASS} mt-7`}>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="aspect-square rounded-md bg-hair-soft animate-pulse" />
              ))}
            </div>
          )}
          {hasNextPage && !isFetchingNextPage && (
            <div className="mt-10 flex justify-center">
              <button
                onClick={() => fetchNextPage()}
                className="inline-flex items-center gap-2 rounded border border-hair px-5 py-2 text-[13px] text-ink-soft transition-colors duration-200 hover:border-ink hover:text-ink active:scale-[0.97]"
              >
                {t('action.loadMore')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
