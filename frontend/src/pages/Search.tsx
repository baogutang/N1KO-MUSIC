/**
 * 搜索页
 * 实时搜索歌曲、专辑、歌手
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { AlbumCard } from '@/components/music/AlbumCard'
import { ArtistCard } from '@/components/music/ArtistCard'
import { SongList } from '@/components/music/SongList'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useSearch } from '@/hooks/useServerQueries'

export default function SearchPage() {
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  // 300ms debounce：减少打字过程中的无效请求
  useEffect(() => {
    timerRef.current = setTimeout(() => setDebouncedQuery(query), 300)
    return () => clearTimeout(timerRef.current)
  }, [query])

  const { data: results, isLoading } = useSearch(debouncedQuery)

  const handleClear = useCallback(() => setQuery(''), [])

  const hasResults = results && (
    results.songs.length > 0 ||
    results.albums.length > 0 ||
    results.artists.length > 0
  )

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 flex flex-col min-h-0">
        {/* 搜索框 */}
        <div className="px-6 py-4 border-b border-border/50">
          <div className="relative max-w-xl">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="搜索歌曲、专辑、歌手..."
              className="pl-10 pr-10 h-11 text-base"
              autoFocus
            />
            {query && (
              <button
                onClick={handleClear}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-6 space-y-8 max-w-7xl mx-auto">
            {/* 无查询时展示提示 */}
            {!query && (
              <div className="text-center py-16">
                <Search className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
                <p className="text-muted-foreground">输入关键词开始搜索</p>
                <p className="text-xs text-muted-foreground/50 mt-1">
                  支持歌曲名、专辑名、歌手名
                </p>
              </div>
            )}

            {/* 加载中 */}
            {isLoading && (
              <div className="text-center py-8">
                <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
              </div>
            )}

            {/* 无结果 */}
            {query && !isLoading && !hasResults && (
              <div className="text-center py-16">
                <p className="text-muted-foreground">未找到「{query}」相关内容</p>
              </div>
            )}

            {/* 歌手 */}
            {results?.artists && results.artists.length > 0 && (
              <section>
                <h2 className="text-base font-semibold text-foreground mb-4">
                  歌手 <span className="text-muted-foreground font-normal text-sm">({results.artists.length})</span>
                </h2>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-4">
                  {results.artists.map(artist => (
                    <ArtistCard key={artist.id} artist={artist} />
                  ))}
                </div>
              </section>
            )}

            {/* 专辑 */}
            {results?.albums && results.albums.length > 0 && (
              <section>
                <h2 className="text-base font-semibold text-foreground mb-4">
                  专辑 <span className="text-muted-foreground font-normal text-sm">({results.albums.length})</span>
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {results.albums.map(album => (
                    <AlbumCard key={album.id} album={album} />
                  ))}
                </div>
              </section>
            )}

            {/* 歌曲 */}
            {results?.songs && results.songs.length > 0 && (
              <section>
                <h2 className="text-base font-semibold text-foreground mb-4">
                  歌曲 <span className="text-muted-foreground font-normal text-sm">({results.songs.length})</span>
                </h2>
                <SongList songs={results.songs} showCover showAlbum showIndex />
              </section>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
