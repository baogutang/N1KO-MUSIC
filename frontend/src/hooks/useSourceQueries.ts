/**
 * 多源聚合查询（PLAN §4.5）。
 *
 * 原则：每个已连接音源一条 React Query（key 以 serverId 开头），
 * useQueries 并发；合并层把单源失败降级成**该分组**的错误态，
 * 不拖垮整页，也不等最慢的源（分组渐进渲染）。
 *
 * 查询键沿用 useServerQueries 的形状约定 [serverId, family, ...]，
 * 但不做 libraryScope 拼接——聚合视图永远跨全库。
 */

import { useMemo } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { getAdapterFor, hasAdapterFor } from '@/api'
import type { Album, Artist, Playlist, SearchResult, ServerConfig, Song, SourceCapabilities } from '@/api/types'
import { useServerStore } from '@/store/serverStore'
import { useSettingsStore } from '@/store/settingsStore'

// ===================================================
// 音源引用与顺序（纯函数，测试直接覆盖）
// ===================================================

export interface SourceRef {
  serverId: string
  name: string
  type: ServerConfig['type']
  /** 插件音源指向的插件 id（徽标取 manifest color 用） */
  pluginId?: string
}

/**
 * 连接中的音源引用，主库在前，其余按连接先后。
 * 只返回已连接（connectedIds）且适配器在册的源。
 */
export function collectSourceRefs(
  servers: ServerConfig[],
  connectedIds: string[],
  activeServerId: string | null
): SourceRef[] {
  const connected = connectedIds
    .map(id => servers.find(s => s.id === id))
    .filter((s): s is ServerConfig => !!s)
    .map(s => ({
      serverId: s.id,
      name: s.name,
      type: s.type,
      ...(s.pluginId ? { pluginId: s.pluginId } : {}),
    }))
  const primary = connected.find(s => s.serverId === activeServerId)
  if (!primary) return connected
  return [primary, ...connected.filter(s => s.serverId !== activeServerId)]
}

/** 默认播放优先顺序（PLAN §2.10）：NAS（非插件）在前，插件在后，主库各自排首 */
export function defaultPriorityOrder(refs: SourceRef[]): SourceRef[] {
  const nas = refs.filter(r => r.type !== 'plugin')
  const plugins = refs.filter(r => r.type === 'plugin')
  return [...nas, ...plugins]
}

/**
 * 用户配置的优先序（settingsStore.playbackPriority）应用到当前已连接源。
 * 存储为空 → 自动序（defaultPriorityOrder）；不在名单里的源排在名单之后。
 * 纯函数，测试直接覆盖。
 */
export function resolveSourceOrder(refs: SourceRef[], stored: string[]): SourceRef[] {
  if (!stored.length) return defaultPriorityOrder(refs)
  const rank = new Map(stored.map((id, i) => [id, i]))
  return [...refs].sort(
    (a, b) => (rank.get(a.serverId) ?? stored.length) - (rank.get(b.serverId) ?? stored.length)
  )
}

/** 播放优先序（match.ts 的代表曲目选择用它） */
export function usePlaybackPriorityOrder(): SourceRef[] {
  const sources = useConnectedSources()
  const stored = useSettingsStore(s => s.playbackPriority)
  return useMemo(() => resolveSourceOrder(sources, stored), [sources, stored])
}

// ===================================================
// 能力快照（同步推断；探测型能力不进聚合范围）
// ===================================================

/** 适配器 → 聚合关心的能力子集；与 useServerCapabilities 同一套推断规则 */
function capabilitiesOf(serverId: string): SourceCapabilities {
  const a = hasAdapterFor(serverId) ? getAdapterFor(serverId) : null
  if (!a) {
    return {
      search: false, album: false, artist: false, lyrics: false,
      userPlaylists: false, favorites: false, playlistWrite: false,
      topLists: false, recommendSheets: false, recommendSongs: false,
      importSheet: false, libraryBrowse: false, radio: false,
    }
  }
  const declared = a.getSourceCapabilities?.()
  return {
    search: declared?.search ?? typeof a.searchAll === 'function',
    album: declared?.album ?? typeof a.getAlbumDetail === 'function',
    artist: declared?.artist ?? typeof a.getArtistDetail === 'function',
    lyrics: declared?.lyrics ?? typeof a.getLyrics === 'function',
    userPlaylists: declared?.userPlaylists ?? typeof a.getPlaylists === 'function',
    favorites: declared?.favorites ?? typeof a.getStarred === 'function',
    playlistWrite: declared?.playlistWrite ?? typeof a.createPlaylist === 'function',
    topLists: declared?.topLists ?? typeof a.getTopLists === 'function',
    recommendSheets: declared?.recommendSheets ?? typeof a.getRecommendSheets === 'function',
    recommendSongs: declared?.recommendSongs ?? typeof a.getRecommendSongs === 'function',
    importSheet: declared?.importSheet ?? false,
    libraryBrowse: declared?.libraryBrowse ?? true,
    radio: declared?.radio
      ?? (typeof a.getSimilarSongs === 'function' || typeof a.getArtistSongs === 'function'),
  }
}

/** 各已连接音源的能力快照；适配器不在册的源全部 false */
export function useSourceCapabilities(): Record<string, SourceCapabilities> {
  const sources = useConnectedSources()
  return useMemo(() => {
    const map: Record<string, SourceCapabilities> = {}
    for (const s of sources) map[s.serverId] = capabilitiesOf(s.serverId)
    return map
  }, [sources])
}

// ===================================================
// Hooks
// ===================================================

/** 已连接音源（主库在前）；空数组时上层按单源模式处理 */
export function useConnectedSources(): SourceRef[] {
  const servers = useServerStore(s => s.servers)
  const connectedIds = useServerStore(s => s.connectedServerIds)
  const activeServerId = useServerStore(s => s.activeServerId)
  return useMemo(
    () => collectSourceRefs(servers, connectedIds, activeServerId),
    [servers, connectedIds, activeServerId]
  )
}

/** 单个分组的状态形状（「全部」合并与分组视图共用） */
export interface SourceQueryGroup<T> extends SourceRef {
  status: 'loading' | 'success' | 'error'
  data?: T
  error?: string
}

/** 把 useQueries 的结果按源 zip 回分组形状（纯函数，测试覆盖） */
export function zipQueryResults<T>(
  sources: SourceRef[],
  results: Array<{ data?: T; error?: unknown; isPending?: boolean; isSuccess?: boolean }>
): SourceQueryGroup<T>[] {
  return sources.map((source, i) => {
    const r = results[i]
    if (!r || (r.isPending ?? !r.isSuccess)) return { ...source, status: 'loading' as const }
    if (r.isSuccess) return { ...source, status: 'success' as const, data: r.data }
    return {
      ...source,
      status: 'error' as const,
      error: r.error instanceof Error ? r.error.message : String(r.error ?? 'unknown'),
    }
  })
}

/** 聚合搜索：对每个声明 search 的音源并发一条 query（PLAN 2.2） */
export function useSourceSearch(query: string): SourceQueryGroup<SearchResult>[] {
  const sources = useConnectedSources()
  const caps = useSourceCapabilities()
  const eligible = useMemo(
    () => sources.filter(s => caps[s.serverId]?.search && hasAdapterFor(s.serverId)),
    [sources, caps]
  )
  const results = useQueries({
    queries: eligible.map(s => ({
      queryKey: [s.serverId, 'search', query] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) => getAdapterFor(s.serverId).searchAll(query, signal),
      enabled: query.trim().length >= 1,
      staleTime: 2 * 60 * 1000,
    })),
  })
  // 不做 memo：results 每个查询状态翻转都是新引用，zip 只是小组数 map，
  // 记忆化反而会把「loading → success」的翻转吞掉
  return zipQueryResults<SearchResult>(eligible, results)
}

// ===================================================
// 2.3 首页区块：各源歌单 / 榜单 / 推荐歌单
// ===================================================

/** 聚合歌单列表（每源一条 query；声明 userPlaylists 的源才参与） */
export function useSourcePlaylists(): SourceQueryGroup<Playlist[]>[] {
  const sources = useConnectedSources()
  const caps = useSourceCapabilities()
  const eligible = useMemo(
    () => sources.filter(s => caps[s.serverId]?.userPlaylists && hasAdapterFor(s.serverId)),
    [sources, caps]
  )
  const results = useQueries({
    queries: eligible.map(s => ({
      queryKey: [s.serverId, 'playlists'] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) => getAdapterFor(s.serverId).getPlaylists(signal),
      staleTime: 3 * 60 * 1000,
    })),
  })
  return zipQueryResults<Playlist[]>(eligible, results)
}

/** 榜单分组（getTopLists 的返回形状） */
export interface TopListGroups {
  groups: Array<{ title: string; items: Playlist[] }>
}

/** 各源榜单（声明 topLists 的源） */
export function useSourceTopLists(): SourceQueryGroup<TopListGroups>[] {
  const sources = useConnectedSources()
  const caps = useSourceCapabilities()
  const eligible = useMemo(
    () => sources.filter(s => caps[s.serverId]?.topLists && hasAdapterFor(s.serverId)),
    [sources, caps]
  )
  const results = useQueries({
    queries: eligible.map(s => ({
      queryKey: [s.serverId, 'toplists'] as const,
      queryFn: async () => {
        const groups = await getAdapterFor(s.serverId).getTopLists!()
        return { groups }
      },
      staleTime: 10 * 60 * 1000,
    })),
  })
  return zipQueryResults<TopListGroups>(eligible, results)
}

/** 各源推荐歌单第一页（声明 recommendSheets 的源） */
export function useSourceRecommendSheets(): SourceQueryGroup<Playlist[]>[] {
  const sources = useConnectedSources()
  const caps = useSourceCapabilities()
  const eligible = useMemo(
    () => sources.filter(s => caps[s.serverId]?.recommendSheets && hasAdapterFor(s.serverId)),
    [sources, caps]
  )
  const results = useQueries({
    queries: eligible.map(s => ({
      queryKey: [s.serverId, 'recommend-sheets', 0] as const,
      queryFn: async () => {
        const page = await getAdapterFor(s.serverId).getRecommendSheets!(0)
        return page.items
      },
      staleTime: 10 * 60 * 1000,
    })),
  })
  return zipQueryResults<Playlist[]>(eligible, results)
}

// ===================================================
// 今日推荐合并（多源每日推荐交错去重）
// ===================================================

/** 跨源去重 key：小写、去空白、去括号后缀（Live/重制版等标记保留主体） */
function recommendDedupKey(song: Song): string {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '').replace(/[（(].*?[)）]/g, '')
  return `${norm(song.title)}|${norm(song.artist)}`
}

/**
 * 各源每日推荐合并成一张列表（纯函数，测试覆盖）：
 * 按源顺序轮转交错（排前面的源先出第一首，谁也不刷屏），
 * 同名曲（标题+歌手归一后相等）只保留先出现的那条，上限 limit。
 */
export function interleaveRecommendations(
  groups: Array<{ songs: Song[] }>,
  limit: number
): Song[] {
  const queues = groups.map(g => [...g.songs])
  const seen = new Set<string>()
  const out: Song[] = []
  let progressed = true
  while (out.length < limit && progressed) {
    progressed = false
    for (const queue of queues) {
      if (out.length >= limit) break
      while (queue.length) {
        const song = queue.shift()!
        const key = recommendDedupKey(song)
        if (seen.has(key)) continue
        seen.add(key)
        out.push(song)
        progressed = true
        break
      }
    }
  }
  return out
}

/** 各源每日推荐（声明 recommendSongs 且已登录的源；未登录的插件一般返回空） */
export function useSourceRecommendSongs(): SourceQueryGroup<Song[]>[] {
  const sources = useConnectedSources()
  const caps = useSourceCapabilities()
  const eligible = useMemo(
    () => sources.filter(s => caps[s.serverId]?.recommendSongs && hasAdapterFor(s.serverId)),
    [sources, caps]
  )
  const results = useQueries({
    queries: eligible.map(s => ({
      queryKey: [s.serverId, 'recommend-songs'] as const,
      queryFn: async () => (await getAdapterFor(s.serverId).getRecommendSongs!()) ?? [],
      // 未登录 / 风控失败的源不该反复打：只重试一次
      retry: 1,
      staleTime: 10 * 60 * 1000,
    })),
  })
  return zipQueryResults<Song[]>(eligible, results)
}

/** 榜单详情（TopListDetail 页用；key 按来源分域） */
export function useTopListDetail(serverId: string, topListId: string) {
  return useQuery({
    queryKey: [serverId, 'toplists', 'detail', topListId] as const,
    queryFn: async () => {
      const page = await getAdapterFor(serverId).getTopListDetail!(topListId, 0)
      return page.songs
    },
    enabled: !!serverId && !!topListId && hasAdapterFor(serverId),
    staleTime: 10 * 60 * 1000,
  })
}

// ===================================================
// 2.4 浏览页：libraryBrowse 过滤与收藏分节
// ===================================================

export interface BrowseSourceInfo {
  /** 参与浏览的全部源（libraryBrowse），主库在前 */
  available: SourceRef[]
  /** 实际浏览的源：?src= 指定 > 主库（若可浏览）> 第一个可浏览源 */
  current: SourceRef | null
}

/**
 * 专辑/歌手浏览页的源选择（PLAN 2.4：浏览页只列 libraryBrowse 的音源）。
 * `srcParam` 是地址栏 ?src= 的值（encodeURIComponent 过的原始串，调用方先解码）。
 */
export function useBrowseSource(srcParam?: string): BrowseSourceInfo {
  const sources = useConnectedSources()
  const caps = useSourceCapabilities()
  return useMemo(() => {
    const available = sources.filter(s => caps[s.serverId]?.libraryBrowse)
    const requested = srcParam ? available.find(s => s.serverId === srcParam) : undefined
    const current = requested ?? available[0] ?? null
    return { available, current }
  }, [sources, caps, srcParam])
}

/** 各源收藏（收藏页分节；声明 favorites 的源） */
export function useSourceStarred(): SourceQueryGroup<{ songs: Song[]; albums: Album[]; artists: Artist[] }>[] {
  const sources = useConnectedSources()
  const caps = useSourceCapabilities()
  const eligible = useMemo(
    () => sources.filter(s => caps[s.serverId]?.favorites && hasAdapterFor(s.serverId)),
    [sources, caps]
  )
  const results = useQueries({
    queries: eligible.map(s => ({
      queryKey: [s.serverId, 'starred'] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) => getAdapterFor(s.serverId).getStarred(signal),
      staleTime: 3 * 60 * 1000,
    })),
  })
  return zipQueryResults(eligible, results)
}
