/**
 * 搜索页 —— 舞台光版式（v6）＋ 多源聚合（PLAN §4.5）
 *
 * 大标题「搜索」＋ 大号胶囊搜索框（ui/Input，左侧放大镜，静止时也留一圈可见的描边）＋ 分区结果：
 * 最佳匹配（一张大卡）/ 歌手胶囊 / 专辑书架 / 歌曲列表；空态直接落在页面上
 *
 * 多源（≥2 个已连接音源）时结果区有两种视图：
 * - 「全部」：match.ts 三级同曲合并成一条带来源徽标（默认视图，聚合是产品主张）
 * - 「分组」：按音源顺序（主库在前）各源一组，单源失败只塌缩成该组的错误行
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { MagnifyingGlass, Play, X } from '@phosphor-icons/react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { AlbumCard } from '@/components/music/AlbumCard'
import { SongList } from '@/components/music/SongList'
import { CoverShelf } from '@/components/common/CoverCard'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'
import { SegmentedPill } from '@/components/settings/primitives'
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
import { findAdapterFor } from '@/api'
import { spaceCJK } from '@/utils/cjkTypography'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import { SongRowsSkeleton } from '@/components/common/SongRowsSkeleton'
import { useT } from '@/i18n'
import { detailPath } from '@/utils/detailPath'
import { playAlbum, playListFrom } from '@/utils/playActions'

type SearchView = 'all' | 'grouped'

/** 合并组的稳定标识：代表曲目的「来源 + id」，与结果顺序无关 */
function mergedKey(song: Song): string {
  return `${song.serverId}:${song.id}`
}

/** 分区失败文案的锚点表（i18n 静态引用检查靠字面量） */
const SECTION_LABEL_KEYS = {
  albums: 'search.section.albums',
  artists: 'search.section.artists',
  playlists: 'search.section.playlists',
} as const

/** 分区右侧的计数（说明级文字，数字等宽） */
function SectionCount({ children }: { children: React.ReactNode }) {
  return <span className="num text-[14px] text-ink-3">{children}</span>
}

/** 状态提示行（单源失败 / 分区没加载 / 还在路上）：一条安静的淡底提示，不抢结果的戏 */
const NOTICE_CLS =
  'flex max-w-full flex-wrap items-center gap-x-2 rounded-md bg-fill px-3.5 py-2 text-[13px] text-ink-2'

/**
 * 歌手：胶囊。名字之后依次是专辑数（说明级）与来源徽标（多源才有）。
 * 多源时 key 带来源前缀；单源沿用歌手 id。
 */
function ArtistPills({ artists, withSource }: { artists: Artist[]; withSource: boolean }) {
  const navigate = useNavigate()
  return (
    <div className="flex flex-wrap gap-2.5">
      {artists.map(artist => (
        <button
          key={withSource ? `${artist.serverId}:${artist.id}` : artist.id}
          onClick={() => navigate(detailPath('artists', artist.id, artist.serverId))}
          className="press-pop inline-flex min-h-11 max-w-full items-center gap-2 rounded-pill bg-fill px-4 text-[15px] font-semibold text-ink hover:bg-fill-2"
        >
          <span className="truncate">{spaceCJK(artist.name)}</span>
          {artist.albumCount !== undefined && (
            <span className="num flex-none text-[13px] font-normal text-ink-3">{artist.albumCount}</span>
          )}
          {withSource && <SourceBadge serverId={artist.serverId} className="flex-none" />}
        </button>
      ))}
    </div>
  )
}

/** 最佳匹配的三种形态：歌手 / 专辑 / 歌曲（歌曲带它在展示列表里的下标，起播用） */
type TopPick =
  | { kind: 'artist'; artist: Artist }
  | { kind: 'album'; album: Album }
  | { kind: 'song'; song: Song; index: number }

/**
 * 从已有的结果里挑最佳匹配（不另发请求、不编分数）：
 * 名字与搜索词完全一致的歌手 / 专辑优先；否则取排在最前的歌曲（多源时已按相关度混排）；
 * 歌曲都没有时退到第一位歌手 / 第一张专辑。
 */
function pickTopResult(query: string, artists: Artist[], albums: Album[], songs: Song[]): TopPick | null {
  const wanted = normalizeText(query)
  const artist = artists.find(a => normalizeText(a.name) === wanted)
  if (artist) return { kind: 'artist', artist }
  const album = albums.find(a => normalizeText(a.name) === wanted)
  if (album) return { kind: 'album', album }
  if (songs.length > 0) return { kind: 'song', song: songs[0], index: 0 }
  if (artists.length > 0) return { kind: 'artist', artist: artists[0] }
  if (albums.length > 0) return { kind: 'album', album: albums[0] }
  return null
}

/**
 * 最佳匹配大卡：整块是去详情页的链接，右侧一枚青柠播放键（歌手没有可直接播的东西，不放）。
 * 这是结果页唯一的青柠主操作；卡片里不再套卡片。
 */
function TopResultCard({ pick, songs, withSource }: { pick: TopPick; songs: Song[]; withSource: boolean }) {
  const { t } = useT()

  const view =
    pick.kind === 'artist'
      ? {
          href: detailPath('artists', pick.artist.id, pick.artist.serverId),
          serverId: pick.artist.serverId,
          title: pick.artist.name,
          typeLabel: t('search.type.artist'),
          meta: pick.artist.albumCount !== undefined
            ? [t('artist.albumCountShort', { count: pick.artist.albumCount })]
            : [],
          coverArt: pick.artist.coverArt,
          round: true,
          fallbackType: 'artist' as const,
          customCoverParams: { type: 'artist' as const, artist: pick.artist.name },
          onPlay: undefined as (() => void) | undefined,
        }
      : pick.kind === 'album'
        ? {
            href: detailPath('albums', pick.album.id, pick.album.serverId),
            serverId: pick.album.serverId,
            title: pick.album.name,
            typeLabel: t('search.type.album'),
            meta: [pick.album.artist, ...(pick.album.year ? [String(pick.album.year)] : [])],
            coverArt: pick.album.coverArt,
            round: false,
            fallbackType: 'album' as const,
            customCoverParams: { type: 'album' as const, artist: pick.album.artist, album: pick.album.name },
            onPlay: (() => { void playAlbum(pick.album) }) as (() => void) | undefined,
          }
        : {
            href: detailPath('songs', pick.song.id, pick.song.serverId),
            serverId: pick.song.serverId,
            title: pick.song.title,
            typeLabel: t('search.type.song'),
            meta: [pick.song.artist, ...(pick.song.album ? [pick.song.album] : [])],
            coverArt: pick.song.coverArt,
            round: false,
            fallbackType: 'music' as const,
            customCoverParams: {
              type: 'song' as const,
              title: pick.song.title,
              artist: pick.song.artist,
              album: pick.song.album,
              path: pick.song.path,
            },
            onPlay: (() => { playListFrom(songs, pick.index) }) as (() => void) | undefined,
          }

  const coverUrl = view.coverArt
    ? (findAdapterFor(view.serverId)?.getCoverUrl(view.coverArt, 400) ?? undefined)
    : undefined

  return (
    <div className="flex items-center gap-3 rounded-lg bg-surface p-4 shadow-sm transition-shadow duration-3 hover:shadow-md regular:gap-5 regular:p-5">
      <Link to={view.href} className="flex min-w-0 flex-1 items-center gap-4 rounded-md regular:gap-6">
        <div
          className={cn(
            'cover-frame h-24 w-24 flex-none shadow-sm regular:h-32 regular:w-32',
            view.round && 'rounded-full'
          )}
        >
          <ImageWithFallback
            src={coverUrl}
            alt=""
            fallbackType={view.fallbackType}
            className="h-full w-full object-cover"
            customCoverParams={view.customCoverParams}
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-[24px] font-bold leading-tight tracking-[-0.025em] text-ink regular:text-[32px]">
            {spaceCJK(view.title)}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] text-ink-3">
            <span className="font-semibold text-ink-2">{view.typeLabel}</span>
            {view.meta.map((part, i) => (
              <span key={i} className="min-w-0 truncate">{spaceCJK(part)}</span>
            ))}
            {withSource && <SourceBadge serverId={view.serverId} withName />}
          </div>
        </div>
      </Link>
      {view.onPlay && (
        <Button
          size="icon-lg"
          onClick={view.onPlay}
          aria-label={t('album.playNamed', { name: view.title })}
          className="flex-none"
        >
          <Play size={20} weight="fill" />
        </Button>
      )}
    </div>
  )
}

export default function SearchPage() {
  const { t } = useT()
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
  /* 页数与累积结果按 location.key 记（阶段 3.12）：返回列表保住已翻的页。
   * 复核 F4 补两条：①累积结果 acc / 首页歌手专辑 meta 一起存进 history.state，
   * 否则回来只恢复页数、看到的结果比离开时少；②重置 effect 跳过首跑，
   * 否则挂载当帧把恢复出来的页数冲回 1，恢复从未生效过。 */
  const locationKey = useLocation().key
  const savedRestore = window.history.state?.mspSearchRestore as {
    key?: string
    acc?: Record<string, Song[]>
    meta?: { artists: Artist[]; albums: Album[] }
  } | undefined
  const restoreMatches = savedRestore?.key === locationKey
  const [page, setPage] = useState(() => {
    const saved = window.history.state?.mspSearchPage as { key?: string; page?: number } | undefined
    return saved?.key === locationKey && saved.page ? saved.page : 1
  })
  /* 已到尾页的源（阶段 5 / F13）：加载更多不再对它们重发请求 */
  const [endedSources, setEndedSources] = useState<ReadonlySet<string>>(new Set())
  useEffect(() => {
    setEndedSources(new Set())
  }, [debouncedQuery])
  const groups = useSourceSearch(debouncedQuery, page, page > 1 ? endedSources : undefined)
  useEffect(() => {
    setEndedSources(prev => {
      let next: Set<string> | null = null
      for (const g of groups) {
        if (g.status === 'success' && g.data?.isEnd && !prev.has(g.serverId)) {
          next ??= new Set(prev)
          next.add(g.serverId)
        }
      }
      return next ?? prev
    })
  }, [groups])
  const caps = useSourceCapabilities()
  const priorityOrder = usePlaybackPriorityOrder()
  /**
   * 用户在「全部」视图手动换过来源的行：`serverId:id`（合并组的代表曲目）
   * → 替换后的曲目。
   *
   * 键不能用合并后的下标：结果按相关度混排，新一页到达、某个源迟到、
   * 甚至换一次视图都会让下标整体位移，于是「我给第 3 行换了来源」变成
   * 「第 3 行现在是另一首歌，而且它被换成了别人的版本」。
   */
  const [swaps, setSwaps] = useState<Record<string, Song>>({})
  /* 换词才清空（复核 F4）：挂载首跑不清——恢复出来的页数/累积结果
   * 正是靠「不清」才活过第一帧的。 */
  const queryChangedRef = useRef(false)
  useEffect(() => {
    if (!queryChangedRef.current) { queryChangedRef.current = true; return }
    setSwaps({}); setPage(1); setAcc({}); setAccMeta({ artists: [], albums: [] })
  }, [debouncedQuery])

  // 各源结果累积（跨页保留、按 id 去重）：page>1 到达时并入已有结果。
  // 初值取恢复载荷（复核 F4）：翻过的页在离开前已存进 history.state
  const [acc, setAcc] = useState<Record<string, Song[]>>(
    () => (restoreMatches && savedRestore?.acc) || {}
  )
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
    // 传入查询词 → 合并后按相关度混排（match.ts）。不传就是按源拼接，
    // 那时候第二个源的完全同名命中会被第一个源的一堆沾边结果压在后面
    return mergeSongs(
      entries.map(([serverId, songs]) => ({ serverId, songs })),
      order,
      debouncedQuery
    )
  }, [acc, priorityOrder, debouncedQuery])

  /** 歌手 / 专辑跨源去重（归一名相等只留优先序在前的那个）。
   *  数据源是第 1 页结果的累积状态：翻页后 groups 只剩当页数据 */
  const [accMeta, setAccMeta] = useState<{ artists: Artist[]; albums: Album[] }>(
    () => (restoreMatches && savedRestore?.meta) || { artists: [], albums: [] }
  )

  // 页数与累积结果写进 history.state（阶段 3.12 + 复核 F4）：后退回来时恢复。
  // acc / accMeta 后到（翻页后数据陆续并入），所以它们也在依赖里。
  useEffect(() => {
    try {
      window.history.replaceState({
        ...window.history.state,
        mspSearchPage: { key: locationKey, page },
        mspSearchRestore: { key: locationKey, acc, meta: accMeta },
      }, '')
    } catch { /* 无 history / 序列化超限时退化：只保住页数那一档 */ }
  }, [locationKey, page, acc, accMeta])
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

  /*
   * 跨源去重按**播放优先序**遍历（阶段 5 / F13）：同名条目留在优先的源上，
   * 原先按分组到达顺序，哪个源先回来哪个赢——用户手动排的优先序被无视。
   */
  const byPriority = useMemo(() => {
    const order = priorityOrder.map(s => s.serverId)
    const rank = (serverId: string) => {
      const i = order.indexOf(serverId)
      return i < 0 ? order.length : i
    }
    return <T extends { serverId: string }>(items: T[]): T[] =>
      [...items].sort((a, b) => rank(a.serverId) - rank(b.serverId))
  }, [priorityOrder])

  const mergedArtists = useMemo(() => {
    const seen = new Set<string>()
    return byPriority(accMeta.artists.filter(a => caps[a.serverId]?.artist))
      .filter(a => {
        const key = normalizeText(a.name)
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
  }, [accMeta.artists, caps, byPriority])

  const mergedAlbums = useMemo(() => {
    const seen = new Set<string>()
    return byPriority(accMeta.albums.filter(al => caps[al.serverId]?.album))
      .filter(al => {
        const key = `${normalizeText(al.name)}|${normalizeText(al.artist)}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
  }, [accMeta.albums, caps, byPriority])

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

  // 最佳匹配所依据的歌曲表：多源「全部」视图里就是屏幕上那份（含用户换过来源的行），起播下标才对得上
  const displayedMergedSongs = useMemo(
    () => merged?.map(m => swaps[mergedKey(m.song)] ?? m.song) ?? [],
    [merged, swaps]
  )
  const topPick = useMemo(() => {
    if (!showResults) return null
    const q = debouncedQuery.trim()
    return multi
      ? pickTopResult(q, mergedArtists, mergedAlbums, displayedMergedSongs)
      : pickTopResult(q, singleResults?.artists ?? [], singleResults?.albums ?? [], singleResults?.songs ?? [])
  }, [showResults, debouncedQuery, multi, mergedArtists, mergedAlbums, displayedMergedSongs, singleResults])
  const topSongs = multi ? displayedMergedSongs : (singleResults?.songs ?? [])

  return (
    <div>
      {/* ============ 大标题 + 大号搜索框 ============ */}
      <h1 className="font-display text-[34px] font-bold leading-[1.05] tracking-[-0.03em] text-ink regular:text-[44px]">
        {t('nav.search')}
      </h1>
      <div className="relative mt-5">
        <MagnifyingGlass
          size={20}
          weight="bold"
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-3"
        />
        <Input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t('search.placeholder')}
          autoFocus
          aria-label={t('nav.search')}
          className="h-12 rounded-pill border-transparent bg-ink/[0.05] pl-12 pr-12 text-[17px] ring-1 ring-inset ring-edge/60 hover:border-transparent hover:ring-edge regular:text-[17px]"
        />
        {query && (
          <button
            onClick={handleClear}
            className="absolute right-0.5 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-pill text-ink-3 transition-colors duration-2 hover:bg-ink/[0.06] hover:text-ink"
            aria-label={t('search.clear')}
          >
            <X size={16} weight="bold" />
          </button>
        )}
      </div>

      {/* ============ 视图切换（多源才出现）：全部 / 按音源分组 ============ */}
      {multi && showResults && (
        <SegmentedPill
          semantics="tabs"
          label={t('search.viewSwitch')}
          value={view}
          onChange={setView}
          options={[
            { value: 'all', label: t('search.viewAll') },
            { value: 'grouped', label: t('search.viewGrouped') },
          ]}
          className="mt-4"
        />
      )}

      {/* 空态：直接落在页面上的一句话 + 说明 */}
      {!query && (
        <div className="mt-8">
          <EmptyState mascot="maodou-wave"
            title={t('empty.search.title')}
            description={t('empty.search.description')}
          />
        </div>
      )}

      {/* 加载骨架（不用 spinner）；无可用源时不转圈 */}
      {showResults && isLoading && <div className="mt-8"><SongRowsSkeleton rows={6} /></div>}

      {/* 全部源都失败：与「无结果」分开——大空态会让人以为这首歌不存在 */}
      {showResults && multi && !isLoading && failedGroups.length === groups.length && groups.length > 0 && !hasResults && (
        <div className="mt-8">
          <EmptyState mascot="maodou-surprised"
            title={t('search.allFailedTitle')}
            description={t('search.allFailedDesc')}
            className="pb-6"
          />
          <div className="flex flex-col items-center gap-2">
            {failedGroups.map(g => (
              <p
                key={g.serverId}
                className="flex max-w-full items-center gap-2 rounded-pill bg-fill px-3.5 py-1.5 text-[13px] text-ink-2"
              >
                <SourceBadge serverId={g.serverId} withName />
                {/* 原始异常只给开发态：插件抛的是英文开发者串，正式界面上帮不了任何人 */}
                {import.meta.env.DEV && (
                  <span className="truncate text-[12px] opacity-70">{g.error?.slice(0, 120)}</span>
                )}
              </p>
            ))}
          </div>
          <div className="mt-5 text-center">
            {/* 聚合搜索的键是 [serverId, 'search', q, page]，
                用前缀 ['search'] 一个都匹配不上——这个按钮此前点了毫无反应 */}
            <Button
              variant="secondary"
              onClick={() =>
                void queryClient.invalidateQueries({
                  predicate: query => query.queryKey[1] === 'search',
                })
              }
            >
              {t('action.retry')}
            </Button>
          </div>
        </div>
      )}

      {/* 单源搜索失败 ≠ 没结果（阶段 2.1）：断网/凭据过期说「没找到 X」是在撒谎 */}
      {showResults && !multi && single.isError && (
        <ErrorState ruled={false} retry={() => { void single.refetch() }} />
      )}

      {/* 无结果（等待防抖或请求进行中时不提前展示；全失败态已单独处理） */}
      {showResults && !isLoading && !isFetching && !hasResults && !single.isError
        && !(multi && failedGroups.length === groups.length && groups.length > 0) && (
        <EmptyState mascot="maodou-surprised"
          title={t('empty.searchNoResult.title', { query })}
          description={t('empty.searchNoResult.description')}
        />
      )}

      {showResults && multi && view === 'all' && (
        <>
          {/* 单源失败 / 分区没加载 / 还在路上：每条一行淡底提示，不挡其他源的结果 */}
          <div className="mt-6 flex flex-col items-start gap-2 empty:hidden">
            {failedGroups.map(g => (
              <p key={g.serverId} className={NOTICE_CLS}>
                <SourceBadge serverId={g.serverId} />
                <span>{t('search.sourceErrorLine', { name: g.name, message: t('search.sourceError') })}</span>
                {import.meta.env.DEV && g.error ? <span>{`（${g.error.slice(0, 120)}）`}</span> : null}
              </p>
            ))}

            {/* 源活着、但专辑/歌手/歌单分区没加载出来（阶段 5 / F13）：
                歌曲结果照常，空分区不再无声——按错误码给一行说明 */}
            {groups.filter(g => g.status === 'success' && g.data?.sectionFailures?.length).map(g => {
              const failures = g.data!.sectionFailures!
              const sections = failures.map(f => t(SECTION_LABEL_KEYS[f.section])).join(t('common.listSeparator'))
              const authish = failures.some(f => f.code === 'unauthorized' || f.code === 'forbidden')
              return (
                <p key={`sec-${g.serverId}`} className={NOTICE_CLS}>
                  <SourceBadge serverId={g.serverId} />
                  <span>{t('search.sectionFailed', { source: g.name, sections })}</span>
                  {authish ? <span>{t('search.sectionFailedAuthHint')}</span> : null}
                  {import.meta.env.DEV ? <span>{`（${failures.map(f => f.code).join(',')}）`}</span> : null}
                </p>
              )
            })}

            {/* 还在路上的源留一行占位。
                「全部」是各源到一个合并一个的渐进列表，没有指示的话用户看到的
                只是一份「就这些了」的结果，而慢的那个源可能正好有他要的那首。
                全部都还没到时上面已经是骨架，这里不再重复。 */}
            {!isLoading && groups.filter(g => g.status === 'loading').map(g => (
              <p key={g.serverId} className={NOTICE_CLS}>
                <SourceBadge serverId={g.serverId} />
                <span className="animate-buffering">{t('search.sourcePendingLine', { name: g.name })}</span>
              </p>
            ))}
          </div>

          {/* 同曲合并的信息行：几首跨源、几首待确认 */}
          {(multiSourceCount > 0 || fuzzyCount > 0) && (
            <p className="num mt-4 flex flex-wrap gap-x-3 text-[13px] text-ink-3">
              {multiSourceCount > 0 && <span>{t('search.mergedCount', { count: multiSourceCount })}</span>}
              {fuzzyCount > 0 && <span>{t('search.fuzzyCount', { count: fuzzyCount })}</span>}
            </p>
          )}

          {/* ============ 最佳匹配 ============ */}
          {topPick && (
            <section aria-labelledby="search-top">
              <div className="section-head">
                <h2 id="search-top">{t('search.topResult')}</h2>
              </div>
              <TopResultCard pick={topPick} songs={topSongs} withSource />
            </section>
          )}

          {/* ============ 歌手（跨源去重，非主源带徽标） ============ */}
          {mergedArtists.length > 0 && (
            <section aria-labelledby="search-artists">
              <div className="section-head">
                <h2 id="search-artists">{t('nav.artists')}</h2>
                <SectionCount>{t('search.artistCount', { count: mergedArtists.length })}</SectionCount>
              </div>
              <ArtistPills artists={mergedArtists} withSource />
            </section>
          )}

          {/* ============ 专辑书架（跨源去重） ============ */}
          {mergedAlbums.length > 0 && (
            <section aria-labelledby="search-albums">
              <div className="section-head">
                <h2 id="search-albums">{t('section.albums')}</h2>
                <SectionCount>{t('search.albumCount', { count: mergedAlbums.length })}</SectionCount>
              </div>
              <CoverShelf>
                {mergedAlbums.map(album => (
                  <AlbumCard key={`${album.serverId}:${album.id}`} album={album} />
                ))}
              </CoverShelf>
            </section>
          )}

          {/* ============ 歌曲列表（同曲合并，行内来源徽标，多源行可切换来源） ============ */}
          {merged && merged.length > 0 && (
            <section aria-labelledby="search-songs">
              <div className="section-head">
                <h2 id="search-songs">{t('section.songs')}</h2>
                <SectionCount>{t('song.trackCount', { count: merged.length })}</SectionCount>
              </div>
              <SongList
                songs={displayedMergedSongs}
                showCover
                showAlbum
                showIndex
                sourceBadge
                getAlternates={i => (merged[i].sources.length > 1 ? merged[i].sources : undefined)}
                onReplace={(i, song) => setSwaps(prev => ({ ...prev, [mergedKey(merged[i].song)]: song }))}
              />
              {/* 加载更多：插件源默认页长有限，全部视图不再静默截断在第一页 */}
              {moreAvailable && (
                <div className="mt-6 text-center">
                  <Button
                    variant="secondary"
                    disabled={loadingMore}
                    onClick={() => setPage(p => p + 1)}
                  >
                    {loadingMore ? t('search.loadingMore') : t('search.loadMore')}
                  </Button>
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
                <SourceBadge
                  serverId={g.serverId}
                  withName
                  className="[&>span:last-child]:text-[19px] [&>span:last-child]:font-semibold [&>span:last-child]:text-ink"
                />
                {/* 类型是**状态/类型标记**：常驻的小胶囊，不放进 <small> */}
                <span className="flex-none rounded-pill bg-fill px-2 py-0.5 text-[11px] font-semibold text-ink-2">
                  {g.type === 'plugin' ? t('sources.typeLabel') : t('sources.typeLabelNas')}
                </span>
              </h2>
              {g.status === 'success' && (
                <SectionCount>
                  {t('song.trackCount', { count: acc[g.serverId]?.length ?? g.data?.songs.length ?? 0 })}
                </SectionCount>
              )}
            </div>
            {g.status === 'loading' && <SongRowsSkeleton rows={3} />}
            {g.status === 'error' && (
              <p className="rounded-md bg-fill px-4 py-3 text-[14px] text-ink-2">
                {t('search.sourceError')}
                {import.meta.env.DEV && g.error ? `（${g.error.slice(0, 120)}）` : ''}
              </p>
            )}
            {g.status === 'success' && (acc[g.serverId]?.length ?? g.data?.songs.length ?? 0) > 0 && (
              <SongList songs={acc[g.serverId] ?? g.data!.songs} showCover showAlbum showIndex />
            )}
            {g.status === 'success' && (acc[g.serverId]?.length ?? g.data?.songs.length ?? 0) === 0 && (
              <p className="rounded-md bg-fill px-4 py-3 text-[14px] text-ink-2">
                {t('search.noResultInSource')}
              </p>
            )}
          </section>
        ))
      )}

      {showResults && !multi && (
        <>
          {/* ============ 最佳匹配（单源） ============ */}
          {topPick && (
            <section aria-labelledby="search-top">
              <div className="section-head">
                <h2 id="search-top">{t('search.topResult')}</h2>
              </div>
              <TopResultCard pick={topPick} songs={topSongs} withSource={false} />
            </section>
          )}

          {/* ============ 歌手（单源） ============ */}
          {singleResults?.artists && singleResults.artists.length > 0 && (
            <section aria-labelledby="search-artists">
              <div className="section-head">
                <h2 id="search-artists">{t('nav.artists')}</h2>
                <SectionCount>{t('search.artistCount', { count: singleResults.artists.length })}</SectionCount>
              </div>
              <ArtistPills artists={singleResults.artists} withSource={false} />
            </section>
          )}

          {/* ============ 专辑书架（单源） ============ */}
          {singleResults?.albums && singleResults.albums.length > 0 && (
            <section aria-labelledby="search-albums">
              <div className="section-head">
                <h2 id="search-albums">{t('section.albums')}</h2>
                <SectionCount>{t('search.albumCount', { count: singleResults.albums.length })}</SectionCount>
              </div>
              <CoverShelf>
                {singleResults.albums.map(album => (
                  <AlbumCard key={album.id} album={album} />
                ))}
              </CoverShelf>
            </section>
          )}

          {/* ============ 歌曲列表（单源） ============ */}
          {singleResults?.songs && singleResults.songs.length > 0 && (
            <section aria-labelledby="search-songs">
              <div className="section-head">
                <h2 id="search-songs">{t('section.songs')}</h2>
                <SectionCount>{t('song.trackCount', { count: singleResults.songs.length })}</SectionCount>
              </div>
              <SongList songs={singleResults.songs} showCover showAlbum showIndex />
            </section>
          )}
        </>
      )}
    </div>
  )
}
