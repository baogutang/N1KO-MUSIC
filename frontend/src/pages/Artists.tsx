/**
 * 歌手列表页 —— 文字索引大列表（DESIGN v2 §3，demo 歌手索引范式）
 * 衬线歌手名行 + 发丝线分隔 + mono 收录数，hover 整行右移；
 * 顶部衬线标题 + mono 总数 + 发丝线下缘过滤输入框
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MagnifyingGlass } from '@phosphor-icons/react'
import { useArtists } from '@/hooks/useServerQueries'

export default function ArtistsPage() {
  const navigate = useNavigate()
  const { data: artists, isLoading } = useArtists()
  const [filter, setFilter] = useState('')

  const filtered = artists?.filter(a =>
    a.name.toLowerCase().includes(filter.toLowerCase())
  ) ?? []

  return (
    <div className="pt-9 animate-fade-in">
      <div className="mb-6">
        <h1 className="font-serif text-3xl font-bold tracking-tight text-ink">歌手</h1>
        {!isLoading && (
          <p className="text-sm text-ink-soft mt-1.5">
            共 <span className="num">{filtered.length}</span> 位
          </p>
        )}
      </div>

      {/* 过滤：发丝线下缘输入框，focus 下缘变 accent（DESIGN §4.4） */}
      <div className="relative max-w-sm mb-8">
        <MagnifyingGlass size={15} className="absolute left-0 top-1/2 -translate-y-1/2 text-ink-faint" />
        <input
          placeholder="筛选歌手…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="w-full border-b border-hair bg-transparent py-2 pl-6 pr-2 text-sm text-ink placeholder:text-ink-faint transition-colors duration-200 focus:border-primary focus:outline-none focus-visible:outline-none"
        />
      </div>

      {isLoading ? (
        <div className="border-t border-hair divide-y divide-hair-soft">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="flex items-baseline justify-between gap-4 px-2 py-4">
              <div className="h-4 w-48 rounded-sm bg-hair-soft animate-pulse" />
              <div className="h-3 w-14 rounded-sm bg-hair-soft animate-pulse" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="border-t border-hair pt-10">
          <p className="font-serif text-lg text-ink-soft">没有名字相符的歌手。</p>
          <p className="text-sm text-ink-faint mt-1.5">换个关键词试试。</p>
        </div>
      ) : (
        <div className="border-t border-hair divide-y divide-hair-soft">
          {filtered.map(artist => (
            <button
              key={artist.id}
              onClick={() => navigate(`/artists/${artist.id}`)}
              className="group flex w-full items-baseline justify-between gap-4 px-2 py-3.5 text-left transition-all duration-200 hover:translate-x-1.5 hover:bg-paper-deep"
            >
              <span className="min-w-0 truncate font-serif text-lg font-semibold text-ink transition-colors duration-200 group-hover:text-primary md:text-xl">
                {artist.name}
              </span>
              {artist.albumCount != null && (
                <span className="num flex-shrink-0 text-xs text-ink-faint">
                  收录 {artist.albumCount} 张
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
