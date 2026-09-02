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
import { useQueries } from '@tanstack/react-query'
import { getAdapterFor, hasAdapterFor } from '@/api'
import type { SearchResult, ServerConfig, SourceCapabilities } from '@/api/types'
import { useServerStore } from '@/store/serverStore'

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
      topLists: false, recommendSheets: false, importSheet: false,
      libraryBrowse: false, radio: false,
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
