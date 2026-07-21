/**
 * 搜索页
 * 实时搜索歌曲、专辑、歌手
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { MagnifyingGlass, X } from '@phosphor-icons/react'
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

  const { data: results, isLoading, isFetching } = useSearch(debouncedQuery)

  const handleClear = useCallback(() => setQuery(''), [])

  const hasResults = results && (
    results.songs.length > 0 ||
    results.albums.length > 0 ||
    results.artists.length > 0
  )

  // UI 必须以 debouncedQuery 为准展示结果：
  // 清空输入后 keepPreviousData 仍会保留上次结果，query 刚变化时结果也还是旧查询的
  const showResults = query.trim().length > 0 && debouncedQuery.trim().length > 0

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 flex flex-col min-h-0">
        {/* 搜索框 */}
        <div className="px-8 py-5 border-b border-border">
          <div className="relative max-w-xl mx-auto lg:mx-0">
            <MagnifyingGlass size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="搜索歌曲、专辑、歌手..."
              className="pl-10 pr-10 h-11 text-base rounded-md"
              autoFocus
            />
            {query && (
              <button
                onClick={handleClear}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors active:scale-[0.94]"
                aria-label="清空搜索"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="px-8 pb-10 max-w-[1320px] mx-auto divide-y divide-border">
            {/* 无查询时展示提示 */}
            {!query && (
              <div className="text-center py-20">
                <MagnifyingGlass size={44} className="text-muted-foreground/30 mx-auto mb-4" />
                <p className="text-muted-foreground">输入关键词开始搜索</p>
                <p className="text-xs text-muted-foreground/50 mt-1.5">
                  支持歌曲名、专辑名、歌手名
                </p>
              </div>
            )}

            {/* 加载中 */}
            {isLoading && (
              <div className="text-center py-10">
                <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
              </div>
            )}

            {/* 无结果（等待防抖或请求进行中时不提前展示） */}
            {showResults && !isLoading && !isFetching && !hasResults && (
              <div className="text-center py-20">
                <p className="text-muted-foreground">未找到「{query}」相关内容</p>
              </div>
            )}

            {/* 歌手 */}
            {showResults && results?.artists && results.artists.length > 0 && (
              <section className="py-8">
                <h2 className="text-lg font-bold tracking-tight text-foreground mb-5">
                  歌手 <span className="font-num text-sm font-normal text-muted-foreground">({results.artists.length})</span>
                </h2>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-5 [&>*]:min-w-0">
                  {results.artists.map(artist => (
                    <ArtistCard key={artist.id} artist={artist} />
                  ))}
                </div>
              </section>
            )}

            {/* 专辑 */}
            {showResults && results?.albums && results.albums.length > 0 && (
              <section className="py-8">
                <h2 className="text-lg font-bold tracking-tight text-foreground mb-5">
                  专辑 <span className="font-num text-sm font-normal text-muted-foreground">({results.albums.length})</span>
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-x-5 gap-y-6 [&>*]:min-w-0">
                  {results.albums.map(album => (
                    <AlbumCard key={album.id} album={album} />
                  ))}
                </div>
              </section>
            )}

            {/* 歌曲 */}
            {showResults && results?.songs && results.songs.length > 0 && (
              <section className="py-8">
                <h2 className="text-lg font-bold tracking-tight text-foreground mb-5">
                  歌曲 <span className="font-num text-sm font-normal text-muted-foreground">({results.songs.length})</span>
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
