/**
 * 搜索页 —— 杂志化检索（DESIGN v2 §4.4/§4.5）＋ 多源聚合（PLAN §4.5）
 *
 * 大号无框搜索框（下缘 1px hair，focus 变 accent 2px）＋ 分区结果：
 * 歌手文字索引 / 专辑封面墙 / 歌曲编号列表；空态为衬线一句 + ink-faint 说明
 *
 * 多源（≥2 个已连接音源）时结果区有两种视图：
 * - 「全部」：match.ts 三级同曲合并成一条带来源徽标（默认视图，聚合是产品主张）
 * - 「分组」：按音源顺序（主库在前）各源一组，单源失败只塌缩成该组的错误行
 */

import { Fragment, useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { MagnifyingGlass, X } from '@phosphor-icons/react'
import { AlbumCard } from '@/components/music/AlbumCard'
import { SongList } from '@/components/music/SongList'
import { SourceBadge } from '@/components/sources/SourceBadge'
import { useSearch } from '@/hooks/useServerQueries'
import {
  useConnectedSources,
  usePlaybackPriorityOrder,
  useSourceCapabilities,
  useSourceSearch,
} from '@/hooks/useSourceQueries'
import { mergeSongs, normalizeText } from '@/plugins/match'
import type { Album, Artist, Song } from '@/api/types'
import { spaceCJK } from '@/utils/cjkTypography'
import { EmptyState } from '@/components/common/EmptyState'
import { useT } from '@/i18n'

type SearchView = 'all' | 'grouped'

export default function SearchPage() {
  const { t } = useT()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  /**
   * `?q=` 是这一页的入口参数：命令面板、深链接（n1ko://search?q=…）、
   * 以及用户直接分享出去的一条搜索链接，都从这里进来。
   * 只作为**初值**读一次——之后输入框自己说了算，不然每敲一个字都要改地址栏。
   */
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState(() => params.get('q') ?? '')
  const [debouncedQuery, setDebouncedQuery] = useState(() => params.get('q') ?? '')
  const timerRef = useRef<ReturnType<typeof setTimeout>>()
  /** 多源时的结果视图；单源不受影响 */
  const [view, setView] = useState<SearchView>('all')

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

  /**
   * 把定稿的查询写回地址栏，否则点进一条结果再返回，搜索框是空的、
   * 结果也没了——而「搜到一首歌，点进去看看，退回来再看下一首」正是
   * 搜索页最主要的用法，每次都要重打一遍。
   *
   * 三个细节：
   * - 写的是 debouncedQuery 而不是 query：每敲一个字推一条历史，
   *   返回键就得按十几次才能离开这一页。
   * - `replace: true`：搜索词的变化是**修正当前位置**，不是新去处。
   * - 只在真的不同时才写：否则和上面那个 urlQuery→setQuery 的同步互相触发。
   */
  useEffect(() => {
    const current = params.get('q') ?? ''
    const next = debouncedQuery.trim()
    if (next === current) return
    /**
     * 打字打到一半时不要回写。
     *
     * 输入「the beatles」，打完 `the ` 那一刻 debounce 触发，trim 后写进
     * URL 的是 `the`；上面那个 urlQuery→setQuery 的同步随即把输入框也改成
     * `the`——**光标后面那个空格被吞掉了**，用户接着打就成了 `thebeatles`。
     *
     * 只在 trim 不改变内容时回写；正在输入尾随空格的那一瞬间跳过，
     * 等下一次 debounce（用户打完下一个字）再写。
     */
    if (next !== debouncedQuery) return
    const updated = new URLSearchParams(params)
    if (next) updated.set('q', next)
    else updated.delete('q')
    setParams(updated, { replace: true })
    // params 变化由本 effect 自己引起，不应作为依赖重新进入
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery])

  // ── 数据：单源走旧链路（行为零变化），多源叠加聚合链路 ─────────────
  // 两个 hook 的 query key 同为 [serverId, 'search', q]（未选库时），
  // React Query 会去重成同一条请求，同时调用没有双倍流量。
  const sources = useConnectedSources()
  const multi = sources.length > 1
  // 多源模式下聚合分组才是数据源；单源 hook 关掉（否则设了曲库范围时
  // 两套查询键不同，主库同一请求会打两遍）
  const single = useSearch(debouncedQuery, { enabled: !multi })
  const [page, setPage] = useState(1)
  const groups = useSourceSearch(debouncedQuery, page)
  const caps = useSourceCapabilities()
  const priorityOrder = usePlaybackPriorityOrder()
  // 用户在「全部」视图手动换过来源的行：mergedIndex → 替换后的曲目；
  // 换查询词就作废（新结果集的下标对不上）
  const [swaps, setSwaps] = useState<Record<number, Song>>({})
  useEffect(() => { setSwaps({}); setPage(1); setAcc({}); setAccMeta({ artists: [], albums: [] }) }, [debouncedQuery])

  // 各源结果累积（跨页保留、按 id 去重）：page>1 到达时并入已有结果
  const [acc, setAcc] = useState<Record<string, Song[]>>({})
  useEffect(() => {
    setAcc(prev => {
      let changed = false
      const next = { ...prev }
      for (const g of groups) {
        if (g.status !== 'success' || !g.data) continue
        if (page === 1) {
          // 第一页直接覆盖（重试/风控解除后旧数据不残留）
          if ((next[g.serverId] ?? []).length !== g.data.songs.length
            || g.data.songs.some((s, i) => next[g.serverId]?.[i]?.id !== s.id)) {
            next[g.serverId] = g.data.songs
            changed = true
          }
        } else {
          const known = new Set((next[g.serverId] ?? []).map(s => s.id))
          const fresh = g.data.songs.filter(s => !known.has(s.id))
          if (fresh.length) {
            next[g.serverId] = [...(next[g.serverId] ?? []), ...fresh]
            changed = true
          }
        }
      }
      return changed ? next : prev
    })
  }, [groups, page])

  /** 「全部」视图：成功组先合并（渐进渲染不等最慢源），失败组只计入错误行 */
  const merged = useMemo(() => {
    const entries = Object.entries(acc)
    if (!entries.length) return null
    const order = priorityOrder.map(s => s.serverId)
    return mergeSongs(
      entries.map(([serverId, songs]) => ({ serverId, songs })),
      order
    )
  }, [acc, priorityOrder])

  /** 歌手 / 专辑跨源去重（归一名相等只留优先序在前的那个）。
   *  数据源是第 1 页结果的累积状态：翻页后 groups 只剩当页数据 */
  const [accMeta, setAccMeta] = useState<{ artists: Artist[]; albums: Album[] }>({ artists: [], albums: [] })
  useEffect(() => {
    if (page !== 1) return
    setAccMeta(prev => {
      let changed = false
      const artists = [...prev.artists]
      const albums = [...prev.albums]
      for (const g of groups) {
        if (g.status !== 'success') continue
        for (const a of g.data?.artists ?? []) {
          if (!artists.some(x => x.serverId === a.serverId && x.id === a.id)) { artists.push(a); changed = true }
        }
        for (const al of g.data?.albums ?? []) {
          if (!albums.some(x => x.serverId === al.serverId && x.id === al.id)) { albums.push(al); changed = true }
        }
      }
      return changed ? { artists, albums } : prev
    })
  }, [groups, page])

  const mergedArtists = useMemo(() => {
    const seen = new Set<string>()
    return accMeta.artists
      .filter(a => caps[a.serverId]?.artist)
      .filter(a => {
        const key = normalizeText(a.name)
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
  }, [accMeta.artists, caps])

  const mergedAlbums = useMemo(() => {
    const seen = new Set<string>()
    return accMeta.albums
      .filter(al => caps[al.serverId]?.album)
      .filter(al => {
        const key = `${normalizeText(al.name)}|${normalizeText(al.artist)}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
  }, [accMeta.albums, caps])

  const multiSourceCount = merged?.filter(m => m.sources.length > 1).length ?? 0
  const fuzzyCount = merged?.filter(m => m.tier === 'fuzzy').length ?? 0
  const failedGroups = groups.filter(g => g.status === 'error')
  /** 还有源没到尾页（NAS 一次性全量、isEnd 恒真，不参与） */
  const moreAvailable = groups.some(g => g.status === 'success' && g.data && !g.data.isEnd)
  const loadingMore = page > 1 && groups.some(g => g.status === 'loading')

  const handleClear = useCallback(() => setQuery(''), [])

  const singleResults = single.data
  const hasResults = multi
    ? !!(merged?.length || mergedArtists.length || mergedAlbums.length)
    : singleResults && (
      singleResults.songs.length > 0 ||
      singleResults.albums.length > 0 ||
      singleResults.artists.length > 0
    )
  // 无可用源（eligible 空）时 every 对空数组为 true，会永久转骨架——排除掉
  const isLoading = multi ? groups.length > 0 && groups.every(g => g.status === 'loading') : single.isLoading
  const isFetching = multi ? groups.some(g => g.status === 'loading') : single.isFetching

  // UI 必须以 debouncedQuery 为准展示结果：
  // 清空输入后 keepPreviousData 仍会保留上次结果，query 刚变化时结果也还是旧查询的
  const showResults = query.trim().length > 0 && debouncedQuery.trim().length > 0

  return (
    <div className="animate-fade-in">
      {/* ============ 大搜索框 ============ */}
      <div className="pt-12 pb-12 border-b border-hair">
        <h1 className="font-serif text-[34px] font-bold tracking-[-0.01em] text-foreground">
          {t('nav.search')}
          <span className="latin-tag ml-4 align-[4px] font-sans text-[11px] font-normal tracking-[0.3em] text-ink-faint">
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
            placeholder={t('search.placeholder')}
            autoFocus
            aria-label={t('nav.search')}
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
              aria-label={t('search.clear')}
            >
              <X size={15} />
            </button>
          )}
        </div>

        {/* ============ 视图切换（多源才出现）：全部 / 按音源分组 ============ */}
        {multi && showResults && (
          <div className="mt-7 flex items-center gap-6" role="tablist" aria-label={t('search.viewSwitch')}>
            {([['all', t('search.viewAll')], ['grouped', t('search.viewGrouped')]] as Array<[SearchView, string]>).map(
              ([key, label]) => (
                <button
                  key={key}
                  role="tab"
                  aria-selected={view === key}
                  onClick={() => setView(key)}
                  className={
                    'pb-1 text-[13px] tracking-[0.08em] border-b transition-colors duration-200 ' +
                    (view === key
                      ? 'text-primary border-primary'
                      : 'text-ink-faint border-transparent hover:text-foreground')
                  }
                >
                  {label}
                </button>
              )
            )}
          </div>
        )}
      </div>

      {/* 空态：衬线一句 + ink-faint 说明（DESIGN §4.5） */}
      {!query && (
        <EmptyState
          title={t('empty.search.title')}
          description={t('empty.search.description')}
        />
      )}

      {/* 加载骨架（hair-soft 行闪烁，不用 spinner）；无可用源时不转圈 */}
      {showResults && isLoading && <SongRowsSkeleton rows={6} />}

      {/* 全部源都失败：与「无结果」分开——大空态会让人以为这首歌不存在 */}
      {showResults && multi && !isLoading && failedGroups.length === groups.length && groups.length > 0 && !hasResults && (
        <div className="mt-8">
          <EmptyState
            ruled
            title={t('search.allFailedTitle')}
            description={t('search.allFailedDesc')}
          />
          <div className="mt-2 space-y-1.5">
            {failedGroups.map(g => (
              <p key={g.serverId} className="flex items-center gap-2 text-[12px] text-ink-faint">
                <SourceBadge serverId={g.serverId} withName />
                <span className="truncate">{g.error?.slice(0, 120)}</span>
              </p>
            ))}
          </div>
          <div className="mt-4 text-center">
            <button className="more" onClick={() => void queryClient.invalidateQueries({ queryKey: ['search'] })}>
              {t('action.retry')}
            </button>
          </div>
        </div>
      )}

      {/* 无结果（等待防抖或请求进行中时不提前展示；全失败态已单独处理） */}
      {showResults && !isLoading && !isFetching && !hasResults
        && !(multi && failedGroups.length === groups.length && groups.length > 0) && (
        <EmptyState
          title={t('empty.searchNoResult.title', { query })}
          description={t('empty.searchNoResult.description')}
        />
      )}

      {showResults && multi && view === 'all' && (
        <>
          {/* 单源失败只挂一行说明，不挡其他源的结果 */}
          {failedGroups.map(g => (
            <p key={g.serverId} className="mt-6 flex items-center gap-2 text-[12px] text-ink-faint">
              <SourceBadge serverId={g.serverId} />
              {g.name}：{t('search.sourceError')}（{g.error?.slice(0, 120)}）
            </p>
          ))}

          {/* 同曲合并的信息行：几首跨源、几首待确认 */}
          {(multiSourceCount > 0 || fuzzyCount > 0) && (
            <p className="mt-6 num text-[11.5px] tracking-[0.12em] text-ink-faint">
              {multiSourceCount > 0 && t('search.mergedCount', { count: multiSourceCount })}
              {multiSourceCount > 0 && fuzzyCount > 0 && ' · '}
              {fuzzyCount > 0 && t('search.fuzzyCount', { count: fuzzyCount })}
            </p>
          )}

          {/* ============ 歌手 · 文字索引（跨源去重，非主源带徽标） ============ */}
          {mergedArtists.length > 0 && (
            <section aria-labelledby="search-artists">
              <div className="section-head">
                <h2 id="search-artists">
                  {t('nav.artists')}<small>ARTISTS</small>
                </h2>
                <span className="num text-[11.5px] tracking-[0.12em] text-ink-faint">
                  {t('search.artistCount', { count: mergedArtists.length })}
                </span>
              </div>
              <p className="font-serif text-[19px] lg:text-[22px] font-semibold leading-[2.1]">
                {mergedArtists.map((artist, i) => (
                  <Fragment key={`${artist.serverId}:${artist.id}`}>
                    {i > 0 && (
                      <span aria-hidden className="mx-2 align-middle text-[0.7em] font-normal text-ink-faint">
                        ·
                      </span>
                    )}
                    <button
                      onClick={() => navigate(`/artists/${artist.id}?src=${encodeURIComponent(artist.serverId)}`)}
                      className="border-b border-transparent hover:text-primary hover:border-primary transition-colors duration-200"
                    >
                      {spaceCJK(artist.name)}
                      {artist.albumCount !== undefined && (
                        <span className="num ml-1.5 align-middle text-[11px] font-normal text-ink-faint">
                          {artist.albumCount}
                        </span>
                      )}
                      <SourceBadge serverId={artist.serverId} className="ml-1.5 inline-block align-baseline" />
                    </button>
                  </Fragment>
                ))}
              </p>
            </section>
          )}

          {/* ============ 专辑 · 封面墙（跨源去重） ============ */}
          {mergedAlbums.length > 0 && (
            <section aria-labelledby="search-albums">
              <div className="section-head">
                <h2 id="search-albums">
                  {t('section.albums')}<small>ALBUMS</small>
                </h2>
                <span className="num text-[11.5px] tracking-[0.12em] text-ink-faint">
                  {t('search.albumCount', { count: mergedAlbums.length })}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-x-5 gap-y-7 [&>*]:min-w-0">
                {mergedAlbums.map(album => (
                  <AlbumCard key={`${album.serverId}:${album.id}`} album={album} />
                ))}
              </div>
            </section>
          )}

          {/* ============ 歌曲 · 编号列表（同曲合并，行内来源徽标，多源行可切换来源） ============ */}
          {merged && merged.length > 0 && (
            <section aria-labelledby="search-songs">
              <div className="section-head">
                <h2 id="search-songs">
                  {t('section.songs')}<small>SONGS</small>
                </h2>
                <span className="num text-[11.5px] tracking-[0.12em] text-ink-faint">
                  {t('song.trackCount', { count: merged.length })}
                </span>
              </div>
              <SongList
                songs={merged.map((m, i) => swaps[i] ?? m.song)}
                showCover
                showAlbum
                showIndex
                sourceBadge
                getAlternates={i => (merged[i].sources.length > 1 ? merged[i].sources : undefined)}
                onReplace={(i, song) => setSwaps(prev => ({ ...prev, [i]: song }))}
              />
              {/* 加载更多：插件源默认页长有限，全部视图不再静默截断在第一页 */}
              {moreAvailable && (
                <div className="mt-4 text-center">
                  <button
                    className="more"
                    disabled={loadingMore}
                    onClick={() => setPage(p => p + 1)}
                  >
                    {loadingMore ? t('search.loadingMore') : t('search.loadMore')}
                  </button>
                </div>
              )}
            </section>
          )}
        </>
      )}

      {showResults && multi && view === 'grouped' && (
        /* ============ 分组视图：每源一组，主库在前 ============ */
        groups.map(g => (
          <section key={g.serverId} aria-labelledby={`search-${g.serverId}`}>
            <div className="section-head">
              <h2 id={`search-${g.serverId}`} className="flex items-center gap-2.5">
                <SourceBadge serverId={g.serverId} withName />
                <small>{g.type === 'plugin' ? 'PLUGIN' : 'NAS'}</small>
              </h2>
              {g.status === 'success' && (
                <span className="num text-[11.5px] tracking-[0.12em] text-ink-faint">
                  {t('song.trackCount', { count: acc[g.serverId]?.length ?? g.data?.songs.length ?? 0 })}
                </span>
              )}
            </div>
            {g.status === 'loading' && <SongRowsSkeleton rows={3} />}
            {g.status === 'error' && (
              <p className="text-[13px] text-ink-faint py-3 border-t border-hair">
                {t('search.sourceError')}（{g.error?.slice(0, 120)}）
              </p>
            )}
            {g.status === 'success' && (acc[g.serverId]?.length ?? g.data?.songs.length ?? 0) > 0 && (
              <SongList songs={acc[g.serverId] ?? g.data!.songs} showCover showAlbum showIndex />
            )}
            {g.status === 'success' && (acc[g.serverId]?.length ?? g.data?.songs.length ?? 0) === 0 && (
              <p className="text-[13px] text-ink-faint py-3 border-t border-hair">
                {t('search.noResultInSource')}
              </p>
            )}
          </section>
        ))
      )}

      {showResults && !multi && (
        <>
          {/* ============ 歌手 · 文字索引（单源：原样保留） ============ */}
          {singleResults?.artists && singleResults.artists.length > 0 && (
            <section aria-labelledby="search-artists">
              <div className="section-head">
                <h2 id="search-artists">
                  {t('nav.artists')}<small>ARTISTS</small>
                </h2>
                <span className="num text-[11.5px] tracking-[0.12em] text-ink-faint">
                  {t('search.artistCount', { count: singleResults.artists.length })}
                </span>
              </div>
              <p className="font-serif text-[19px] lg:text-[22px] font-semibold leading-[2.1]">
                {singleResults.artists.map((artist, i) => (
                  <Fragment key={artist.id}>
                    {i > 0 && (
                      <span aria-hidden className="mx-2 align-middle text-[0.7em] font-normal text-ink-faint">
                        ·
                      </span>
                    )}
                    <button
                      onClick={() => navigate(`/artists/${artist.id}?src=${encodeURIComponent(artist.serverId)}`)}
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

          {/* ============ 专辑 · 封面墙（单源） ============ */}
          {singleResults?.albums && singleResults.albums.length > 0 && (
            <section aria-labelledby="search-albums">
              <div className="section-head">
                <h2 id="search-albums">
                  {t('section.albums')}<small>ALBUMS</small>
                </h2>
                <span className="num text-[11.5px] tracking-[0.12em] text-ink-faint">
                  {t('search.albumCount', { count: singleResults.albums.length })}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-x-5 gap-y-7 [&>*]:min-w-0">
                {singleResults.albums.map(album => (
                  <AlbumCard key={album.id} album={album} />
                ))}
              </div>
            </section>
          )}

          {/* ============ 歌曲 · 编号列表（单源） ============ */}
          {singleResults?.songs && singleResults.songs.length > 0 && (
            <section aria-labelledby="search-songs">
              <div className="section-head">
                <h2 id="search-songs">
                  {t('section.songs')}<small>SONGS</small>
                </h2>
                <span className="num text-[11.5px] tracking-[0.12em] text-ink-faint">
                  {t('song.trackCount', { count: singleResults.songs.length })}
                </span>
              </div>
              <SongList songs={singleResults.songs} showCover showAlbum showIndex />
            </section>
          )}
        </>
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
          <span className="w-8 h-3 rounded-sm bg-skeleton animate-pulse" />
          <span className="w-10 h-10 rounded-sm bg-skeleton animate-pulse" />
          <span className="flex-1 h-4 rounded-sm bg-skeleton animate-pulse" />
          <span className="hidden lg:block flex-1 h-3.5 rounded-sm bg-skeleton animate-pulse" />
          <span className="w-12 h-3.5 rounded-sm bg-skeleton animate-pulse" />
        </div>
      ))}
    </div>
  )
}
