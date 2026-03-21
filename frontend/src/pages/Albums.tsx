/**
 * 专辑列表页
 */

import { AlbumCard } from '@/components/music/AlbumCard'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useAlbumsInfinite } from '@/hooks/useServerQueries'
import { Loader2 } from 'lucide-react'

export default function AlbumsPage() {
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useAlbumsInfinite(50)

  const albums = data?.pages.flatMap(p => p.items) ?? []

  return (
    <div className="flex flex-col h-full">
      <ScrollArea className="flex-1">
        <div className="p-6 max-w-7xl mx-auto">
          {isLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {Array.from({ length: 24 }).map((_, i) => (
                <div key={i} className="aspect-square rounded-xl bg-card animate-pulse" />
              ))}
            </div>
          ) : (
            <>
              <p className="text-sm text-muted-foreground mb-4">{albums.length} 张专辑</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                {albums.map(album => (
                  <AlbumCard key={album.id} album={album} />
                ))}
              </div>
              {hasNextPage && (
                <div className="flex justify-center mt-8">
                  <button
                    onClick={() => fetchNextPage()}
                    disabled={isFetchingNextPage}
                    className="px-6 py-2 rounded-full bg-secondary text-foreground text-sm hover:bg-accent transition-colors disabled:opacity-50 flex items-center gap-2"
                  >
                    {isFetchingNextPage && <Loader2 className="w-4 h-4 animate-spin" />}
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
