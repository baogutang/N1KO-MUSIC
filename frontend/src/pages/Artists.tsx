/**
 * 歌手列表页
 */

import { useState } from 'react'
import { ArtistCard } from '@/components/music/ArtistCard'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { Search } from 'lucide-react'
import { useArtists } from '@/hooks/useServerQueries'

export default function ArtistsPage() {
  const { data: artists, isLoading } = useArtists()
  const [filter, setFilter] = useState('')

  const filtered = artists?.filter(a =>
    a.name.toLowerCase().includes(filter.toLowerCase())
  ) ?? []

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 pt-4 pb-2 border-b border-border/50">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="筛选歌手..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-6 max-w-7xl mx-auto">
          {isLoading ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-4">
              {Array.from({ length: 24 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <div className="aspect-square rounded-full bg-card animate-pulse" />
                  <div className="h-3 bg-card rounded animate-pulse" />
                </div>
              ))}
            </div>
          ) : (
            <>
              <p className="text-sm text-muted-foreground mb-4">{filtered.length} 位歌手</p>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-4">
                {filtered.map(artist => (
                  <ArtistCard key={artist.id} artist={artist} />
                ))}
              </div>
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
