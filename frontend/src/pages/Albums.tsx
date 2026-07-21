/**
 * 专辑列表页
 */

import { AlbumCard } from '@/components/music/AlbumCard'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useAlbumsInfinite } from '@/hooks/useServerQueries'
import { CircleNotch } from '@phosphor-icons/react'

export default function AlbumsPage() {
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useAlbumsInfinite(50)

  const albums = data?.pages.flatMap(p => p.items) ?? []

  return (
    <div className="flex flex-col h-full">
      <ScrollArea className="flex-1">
        <div className="px-8 pt-8 pb-10 max-w-[1320px] mx-auto animate-fade-in">
          <div className="mb-7">
            <h1 className="text-3xl font-bold tracking-tight text-foreground">专辑</h1>
            {!isLoading && (
              <p className="text-sm text-muted-foreground mt-1.5">
                <span className="font-num">{albums.length}</span> 张专辑{hasNextPage ? '+' : ''}
              </p>
            )}
          </div>
          {isLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-x-5 gap-y-6">
              {Array.from({ length: 20 }).map((_, i) => (
                <div key={i} className="aspect-square rounded-lg bg-accent animate-pulse" />
              ))}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-x-5 gap-y-6 [&>*]:min-w-0">
                {albums.map(album => (
                  <AlbumCard key={album.id} album={album} />
                ))}
              </div>
              {hasNextPage && (
                <div className="flex justify-center mt-8">
                  <button
                    onClick={() => fetchNextPage()}
                    disabled={isFetchingNextPage}
                    className="inline-flex items-center gap-2 h-10 px-6 rounded-full border border-border text-sm text-foreground hover:border-primary hover:text-primary transition-colors active:scale-[0.97] disabled:opacity-50"
                  >
                    {isFetchingNextPage && <CircleNotch size={16} className="animate-spin" />}
                    加载更多
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
