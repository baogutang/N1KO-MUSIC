/**
 * 搜索页 —— 杂志化检索（DESIGN v2 §4.4/§4.5）
 * 大号无框搜索框（下缘 1px hair，focus 变 accent 2px）＋ 分区结果：
 * 歌手文字索引 / 专辑封面墙 / 歌曲编号列表；空态为衬线一句 + ink-faint 说明
 */

import { Fragment, useState, useCallback, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { MagnifyingGlass, X } from '@phosphor-icons/react'
import { AlbumCard } from '@/components/music/AlbumCard'
import { SongList } from '@/components/music/SongList'
import { useSearch } from '@/hooks/useServerQueries'
import { spaceCJK } from '@/utils/cjkTypography'
import { EmptyState } from '@/components/common/EmptyState'

export default function SearchPage() {
  const navigate = useNavigate()
  /**
   * `?q=` 是这一页的入口参数：命令面板、深链接（n1ko://search?q=…）、
   * 以及用户直接分享出去的一条搜索链接，都从这里进来。
   * 只作为**初值**读一次——之后输入框自己说了算，不然每敲一个字都要改地址栏。
   */
  const [params] = useSearchParams()
  const [query, setQuery] = useState(() => params.get('q') ?? '')
  const [debouncedQuery, setDebouncedQuery] = useState(() => params.get('q') ?? '')
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  // 带着新的 q 再次进入本页（组件没卸载，比如从深链接跳过来）时同步一次
  const urlQuery = params.get('q') ?? ''
  useEffect(() => {
    if (urlQuery) setQuery(urlQuery)
  }, [urlQuery])

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
    <div className="animate-fade-in">
      {/* ============ 大搜索框 ============ */}
      <div className="pt-12 pb-12 border-b border-hair">
        <h1 className="font-serif text-[34px] font-bold tracking-[-0.01em] text-foreground">
          搜索
          <span className="ml-4 align-[4px] font-sans text-[11px] font-normal tracking-[0.3em] text-ink-faint">
            SEARCH
          </span>
        </h1>
        <div className="group relative mt-9">
          <MagnifyingGlass
            size={20}
            className="absolute left-0 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none"
          />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="搜索歌曲、专辑、歌手…"
            autoFocus
            aria-label="搜索"
            className="w-full h-16 bg-transparent pl-9 pr-10 font-serif text-[22px] text-foreground placeholder:italic placeholder:text-ink-faint/70 border-b border-hair focus:outline-none transition-colors duration-200"
          />
          {/* focus 时下缘 accent 2px（DESIGN §4.4，group-focus-within 监听外层容器） */}
          <span
            aria-hidden
            className="absolute inset-x-0 bottom-0 h-[2px] origin-left scale-x-0 bg-primary transition-transform duration-300 group-focus-within:scale-x-100"
          />
          {query && (
            <button
              onClick={handleClear}
              className="absolute right-0 top-1/2 -translate-y-1/2 w-8 h-8 grid place-items-center rounded-full text-ink-faint hover:text-primary transition-colors active:scale-[0.94]"
              aria-label="清空搜索"
            >
              <X size={15} />
            </button>
          )}
        </div>
      </div>

      {/* 空态：衬线一句 + ink-faint 说明（DESIGN §4.5） */}
      {!query && (
        <EmptyState
          title="想找什么，直接输入。"
          description="支持歌曲名、专辑名、歌手名，输入即搜。"
        />
      )}

      {/* 加载骨架（hair-soft 行闪烁，不用 spinner） */}
      {showResults && isLoading && <SongRowsSkeleton rows={6} />}

      {/* 无结果（等待防抖或请求进行中时不提前展示） */}
      {showResults && !isLoading && !isFetching && !hasResults && (
        <EmptyState
          title={`没有找到与「${query}」相关的内容。`}
          description="换个关键词，或检查拼写后再试。"
        />
      )}

      {/* ============ 歌手 · 文字索引 ============ */}
      {showResults && results?.artists && results.artists.length > 0 && (
        <section aria-labelledby="search-artists">
          <div className="section-head">
            <h2 id="search-artists">
              歌手<small>ARTISTS</small>
            </h2>
            <span className="num text-[11.5px] tracking-[0.12em] text-ink-faint">
              {results.artists.length} 位
            </span>
          </div>
          <p className="font-serif text-[19px] lg:text-[22px] font-semibold leading-[2.1]">
            {results.artists.map((artist, i) => (
              <Fragment key={artist.id}>
                {i > 0 && (
                  <span aria-hidden className="mx-2 align-middle text-[0.7em] font-normal text-ink-faint">
                    ·
                  </span>
                )}
                <button
                  onClick={() => navigate(`/artists/${artist.id}`)}
                  className="border-b border-transparent hover:text-primary hover:border-primary transition-colors duration-200"
                >
                  {spaceCJK(artist.name)}
                  {artist.albumCount !== undefined && (
                    <span className="num ml-1.5 align-middle text-[11px] font-normal text-ink-faint">
                      {artist.albumCount}
                    </span>
                  )}
                </button>
              </Fragment>
            ))}
          </p>
        </section>
      )}

      {/* ============ 专辑 · 封面墙 ============ */}
      {showResults && results?.albums && results.albums.length > 0 && (
        <section aria-labelledby="search-albums">
          <div className="section-head">
            <h2 id="search-albums">
              专辑<small>ALBUMS</small>
            </h2>
            <span className="num text-[11.5px] tracking-[0.12em] text-ink-faint">
              {results.albums.length} 张
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-x-5 gap-y-7 [&>*]:min-w-0">
            {results.albums.map(album => (
              <AlbumCard key={album.id} album={album} />
            ))}
          </div>
        </section>
      )}

      {/* ============ 歌曲 · 编号列表 ============ */}
      {showResults && results?.songs && results.songs.length > 0 && (
        <section aria-labelledby="search-songs">
          <div className="section-head">
            <h2 id="search-songs">
              歌曲<small>SONGS</small>
            </h2>
            <span className="num text-[11.5px] tracking-[0.12em] text-ink-faint">
              {results.songs.length} 首
            </span>
          </div>
          <SongList songs={results.songs} showCover showAlbum showIndex />
        </section>
      )}
    </div>
  )
}

/** 搜索结果加载骨架：hair-soft 行闪烁（DESIGN §4.5） */
function SongRowsSkeleton({ rows }: { rows: number }) {
  return (
    <div className="border-t border-hair">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-3 py-3 border-b border-hair-soft">
          <span className="w-8 h-3 rounded-sm bg-hair-soft/70 animate-pulse" />
          <span className="w-10 h-10 rounded-sm bg-hair-soft/70 animate-pulse" />
          <span className="flex-1 h-4 rounded-sm bg-hair-soft/70 animate-pulse" />
          <span className="hidden lg:block flex-1 h-3.5 rounded-sm bg-hair-soft/70 animate-pulse" />
          <span className="w-12 h-3.5 rounded-sm bg-hair-soft/70 animate-pulse" />
        </div>
      ))}
    </div>
  )
}
