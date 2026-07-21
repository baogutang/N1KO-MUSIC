/**
 * 歌手列表页
 */

import { useState } from 'react'
import { ArtistCard } from '@/components/music/ArtistCard'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { MagnifyingGlass } from '@phosphor-icons/react'
import { useArtists } from '@/hooks/useServerQueries'

export default function ArtistsPage() {
  const { data: artists, isLoading } = useArtists()
  const [filter, setFilter] = useState('')

  const filtered = artists?.filter(a =>
    a.name.toLowerCase().includes(filter.toLowerCase())
  ) ?? []

  return (
    <div className="flex flex-col h-full">
      <ScrollArea className="flex-1">
        <div className="px-8 pt-8 pb-10 max-w-[1320px] mx-auto animate-fade-in">
          <div className="mb-6">
            <h1 className="text-3xl font-bold tracking-tight text-foreground">歌手</h1>
            {!isLoading && (
              <p className="text-sm text-muted-foreground mt-1.5">
                <span className="font-num">{filtered.length}</span> 位歌手
              </p>
            )}
          </div>

          <div className="relative max-w-sm mb-8">
            <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="筛选歌手..."
              value={filter}
              onChange={e => setFilter(e.target.value)}
              className="pl-9 h-9 rounded-md"
            />
          </div>

          {isLoading ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-x-5 gap-y-6">
              {Array.from({ length: 15 }).map((_, i) => (
                <div key={i} className="space-y-3">
                  <div className="aspect-square rounded-full bg-accent animate-pulse" />
                  <div className="h-3 bg-accent rounded-md animate-pulse mx-auto w-2/3" />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-x-5 gap-y-6 [&>*]:min-w-0">
              {filtered.map(artist => (
                <ArtistCard key={artist.id} artist={artist} />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
