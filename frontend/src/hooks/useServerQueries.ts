/**
 * TanStack Query hooks - 音乐数据层
 *
 * 封装所有与音乐服务器的数据交互，
 * 提供缓存、加载状态、错误处理
 */

import { useEffect } from 'react'
import {
  useQuery,
  useMutation,
  useInfiniteQuery,
  useQueryClient,
  keepPreviousData,
  type QueryClient,
} from '@tanstack/react-query'
import { getAdapter } from '@/api'
import { useSettingsStore } from '@/store/settingsStore'
import { useLyricCacheStore } from '@/store/o3icCacheStore'
import { parseLrc } from '@/hooks/useLyrics'
import type { ListParams, Lyrics } from '@/api/types'

// ===================================================
// Query Keys - 统一管理缓存键
// ===================================================
export const queryKeys = {
  songs: (params?: ListParams) => ['songs', params] as const,
  randomSongs: (size?: number) => ['songs', 'random', size] as const,
  search: (query: string) => ['search', query] as const,
  albums: (params?: ListParams) => ['albums', params] as const,
  albumDetail: (id: string) => ['albums', id] as const,
  recentAlbums: (size?: number) => ['albums', 'recent', size] as const,
  artists: () => ['artists'] as const,
  artistDetail: (id: string) => ['artists', id] as const,
  playlists: () => ['playlists'] as const,
  playlistDetail: (id: string) => ['playlists', id] as const,
  starred: () => ['starred'] as const,
  genres: () => ['genres'] as const,
  o3ics: (songId: string) => ['o3ics', songId] as const,
}

/**
 * 自定义封面 query 缓存移除时回收 blob URL，避免长期会话内内存累积。
 * 通过 WeakSet 保证每个 QueryClient 只绑定一次监听。
 */
const customCoverRevokeBoundClients = new WeakSet<QueryClient>()
function bindCustomCoverRevokeOnQueryRemoved(queryClient: QueryClient) {
  if (customCoverRevokeBoundClients.has(queryClient)) return
  customCoverRevokeBoundClients.add(queryClient)
  queryClient.getQueryCache().subscribe(event => {
    if (event.type !== 'removed') return
    const key0 = Array.isArray(event.query.queryKey) ? event.query.queryKey[0] : undefined
    if (key0 !== 'custom-cover') return
    const data = event.query.state.data
    if (typeof data === 'string' && data.startsWith('blob:')) {
      URL.revokeObjectURL(data)
    }
  })
}

// ===================================================
// 歌曲相关 Hooks
// ===================================================

/** 获取随机歌曲（首页推荐使用）*/
export function useRandomSongs(size = 50) {
  return useQuery({
    queryKey: queryKeys.randomSongs(size),
    queryFn: () => getAdapter().getRandomSongs(size),
    staleTime: 5 * 60 * 1000, // 5 分钟
  })
}

/** 获取所有歌曲（音乐库歌曲列表）*/
export function useSongs(params: ListParams = {}) {
  return useQuery({
    queryKey: ['songs', 'all', params] as const,
    queryFn: () => getAdapter().getSongs(params),
    staleTime: 5 * 60 * 1000,
  })
}

/** 搜索 */
export function useSearch(query: string) {
  return useQuery({
    queryKey: queryKeys.search(query),
    queryFn: () => getAdapter().searchAll(query),
    enabled: query.trim().length >= 1,
    staleTime: 2 * 60 * 1000,
    placeholderData: keepPreviousData,
  })
}

/** 获取歌词（优先本地缓存 > 远程歌词 > 服务器歌词）*/
export function useLyricsQuery(
  songId: string,
  title?: string,
  artist?: string,
  album?: string,
  path?: string,
  duration?: number,
  enabled = true
) {
  const { o3icsRemoteTemplate: lyricsRemoteTemplate, apiAuthToken, apiPreferServer } = useSettingsStore()
  const { getLyrics: getCachedLyrics } = useLyricCacheStore()

  const hasRemoteTemplate = !!lyricsRemoteTemplate

  // 1. 优先检查本地缓存（注意：不能提前 return，需保持 hooks 调用顺序稳定）
  const cachedLyrics = getCachedLyrics(songId)
  const cachedLines = cachedLyrics ? parseLrc(cachedLyrics) : null
  const cachedLyricsData = cachedLines
    ? ({ songId, lines: cachedLines, synced: cachedLines.some(l => l.time > 0) } as Lyrics | null)
    : null

  // 2. 没有本地缓存，继续使用服务器和远程歌词
  const fetchEnabled = enabled && !!songId && !cachedLyricsData

  // 服务器歌词（有配置时始终并行请求）
  const serverQuery = useQuery({
    queryKey: queryKeys.o3ics(songId),
    queryFn: () => getAdapter().getLyrics(songId, title, artist),
    enabled: fetchEnabled,
    staleTime: 30 * 60 * 1000,
  })

  // 按文档格式组装自定义歌词接口 URL
  const buildRemoteUrl = () => {
    if (!lyricsRemoteTemplate) return ''
    const url = new URL(lyricsRemoteTemplate)
    if (title)    url.searchParams.set('title', title)
    if (artist)   url.searchParams.set('artist', artist)
    if (album)    url.searchParams.set('album', album)
    if (path)     url.searchParams.set('path', path)
    if (duration) url.searchParams.set('duration', String(Math.round(duration)))
    url.searchParams.set('offset', '0')
    url.searchParams.set('limit', '10')
    return url.toString()
  }

  let remoteUrl = ''
  try { if (hasRemoteTemplate) remoteUrl = buildRemoteUrl() } catch { /* invalid URL */ }

  // 远程歌词（配置了模板就请求，不需要单独开关）
  const remoteQuery = useQuery({
    queryKey: ['o3ics-remote', songId, remoteUrl],
    queryFn: async (): Promise<Lyrics | null> => {
      if (!remoteUrl) return null
      const headers: Record<string, string> = {}
      if (apiAuthToken) headers['Authorization'] = apiAuthToken
      const res = await fetch(remoteUrl, { headers })
      if (!res.ok) return null
      const contentType = res.headers.get('content-type') ?? ''
      const text = await res.text()
      // content-type 为 application/json 时解析为列表格式
      if (contentType.includes('application/json')) {
        try {
          const json = JSON.parse(text)
          const list = Array.isArray(json) ? json : [json]
          if (!list.length) return null
          const item = list[0]
          const lrcText: string =
            item?.lyrics || item?.o3ics || item?.lrc || item?.o3ic || item?.content || item?.text || ''
          if (!lrcText) return null
          const lines = parseLrc(lrcText)
          return { songId, lines, synced: lines.some(l => l.time > 0) }
        } catch { /* fallthrough */ }
      }
      const lines = parseLrc(text)
      if (!lines.length) return null
      return { songId, lines, synced: lines.some(l => l.time > 0) }
    },
    enabled: fetchEnabled && hasRemoteTemplate && !!remoteUrl,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  })

  if (cachedLyricsData) {
    return {
      ...serverQuery,
      data: cachedLyricsData,
      error: null,
      status: 'success',
      fetchStatus: 'idle',
      isPending: false,
      isLoading: false,
      isFetching: false,
      isSuccess: true,
    }
  }

  // 没有配置自定义模板，只用服务器歌词
  if (!hasRemoteTemplate) {
    return serverQuery
  }

  // apiPreferServer=true：服务器有内容就用服务器，否则用自定义
  // apiPreferServer=false：自定义有内容就用自定义，否则用服务器
  if (apiPreferServer) {
    const serverHasData = serverQuery.data && serverQuery.data.lines.length > 0
    const data = serverHasData ? serverQuery.data : remoteQuery.data
    return { ...serverQuery, data }
  } else {
    const remoteHasData = remoteQuery.data && (remoteQuery.data as Lyrics).lines.length > 0
    const data = remoteHasData ? remoteQuery.data : serverQuery.data
    return { ...remoteQuery, data }
  }
}

// ===================================================
// 自定义封面 API
// ===================================================

/** 封面类型 */
export type CoverQueryType = 'song' | 'album' | 'artist'

interface CustomCoverParams {
  type: CoverQueryType
  title?: string
  artist?: string
  album?: string
  path?: string
}

/**
 * 根据文档规则组装封面 API URL：
 * - song: title + artist + album (+ path)
 * - album: artist + album（不传 title）
 * - artist: 只传 artist
 */
function buildCoverUrl(base: string, params: CustomCoverParams): string {
  const url = new URL(base)
  if (params.type === 'song') {
    if (params.title)  url.searchParams.set('title', params.title)
    if (params.artist) url.searchParams.set('artist', params.artist)
    if (params.album)  url.searchParams.set('album', params.album)
    if (params.path)   url.searchParams.set('path', params.path)
  } else if (params.type === 'album') {
    if (params.artist) url.searchParams.set('artist', params.artist)
    if (params.album)  url.searchParams.set('album', params.album)
  } else {
    // artist: 只传 artist
    if (params.artist) url.searchParams.set('artist', params.artist)
  }
  return url.toString()
}

/**
 * 请求自定义封面 API，返回 ObjectURL。
 * - 使用 URL.createObjectURL(blob) 替代 base64 DataURL：零转换开销，无 localStorage 5MB 限制
 * - TanStack Query staleTime=Infinity 保证同一 key 在会话内只请求一次
 * - gcTime=24h 确保导航离开再返回时仍可从内存缓存命中
 */
export function useCustomCoverUrl(params: CustomCoverParams | null) {
  const queryClient = useQueryClient()
  const { coverRemoteTemplate, apiAuthToken, coverLoadAlbum, coverLoadArtist } = useSettingsStore()

  useEffect(() => {
    bindCustomCoverRevokeOnQueryRemoved(queryClient)
  }, [queryClient])

  // 根据类型和开关判断是否应该请求
  const typeAllowed = !params ? false : (
    params.type === 'song' ||
    (params.type === 'album' && coverLoadAlbum) ||
    (params.type === 'artist' && coverLoadArtist)
  )
  const enabled = !!params && !!coverRemoteTemplate && typeAllowed

  let remoteUrl = ''
  try {
    if (enabled && params) {
      remoteUrl = buildCoverUrl(coverRemoteTemplate, params)
    }
  } catch { /* invalid URL */ }

  return useQuery({
    queryKey: ['custom-cover', remoteUrl],
    queryFn: async (): Promise<string | null> => {
      if (!remoteUrl) return null
      const headers: Record<string, string> = {}
      if (apiAuthToken) headers['Authorization'] = apiAuthToken
      const res = await fetch(remoteUrl, { headers })
      if (!res.ok) return null
      const blob = await res.blob()
      if (!blob.size) return null
      // ObjectURL 零开销、无 5MB 限制，生命周期与页面一致
      return URL.createObjectURL(blob)
    },
    enabled: enabled && !!remoteUrl,
    staleTime: Infinity,
    gcTime: 1000 * 60 * 60 * 24, // 24h — 会话期间基本不会过期
    retry: 1,
  })
}

// ===================================================
// 专辑相关 Hooks
// ===================================================

/** 获取专辑列表（支持分页）*/
export function useAlbums(params: ListParams = {}) {
  return useQuery({
    queryKey: queryKeys.albums(params),
    queryFn: () => getAdapter().getAlbums(params),
    staleTime: 5 * 60 * 1000,
  })
}

/** 无限滚动加载专辑 */
export function useAlbumsInfinite(size = 50, type = 'newest') {
  return useInfiniteQuery({
    queryKey: ['albums', 'infinite', type],
    queryFn: ({ pageParam = 0 }) =>
      getAdapter().getAlbums({ size, offset: pageParam as number, type }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, p) => sum + p.items.length, 0)
      if (lastPage.items.length < size) return undefined
      return loaded
    },
  })
}

/** 获取专辑详情 */
export function useAlbumDetail(albumId: string) {
  return useQuery({
    queryKey: queryKeys.albumDetail(albumId),
    queryFn: () => getAdapter().getAlbumDetail(albumId),
    enabled: !!albumId,
    staleTime: 10 * 60 * 1000,
  })
}

/** 获取最近专辑（首页推荐）*/
export function useRecentAlbums(size = 20) {
  return useQuery({
    queryKey: queryKeys.recentAlbums(size),
    queryFn: () => getAdapter().getRecentAlbums(size),
    staleTime: 5 * 60 * 1000,
  })
}

// ===================================================
// 歌手相关 Hooks
// ===================================================

/** 获取所有歌手 */
export function useArtists() {
  return useQuery({
    queryKey: queryKeys.artists(),
    queryFn: () => getAdapter().getArtists(),
    staleTime: 10 * 60 * 1000,
  })
}

/** 获取歌手详情 */
export function useArtistDetail(artistId: string) {
  return useQuery({
    queryKey: queryKeys.artistDetail(artistId),
    queryFn: () => getAdapter().getArtistDetail(artistId),
    enabled: !!artistId,
    staleTime: 10 * 60 * 1000,
  })
}

// ===================================================
// 歌单相关 Hooks
// ===================================================

/** 获取歌单列表 */
export function usePlaylists() {
  return useQuery({
    queryKey: queryKeys.playlists(),
    queryFn: () => getAdapter().getPlaylists(),
    staleTime: 3 * 60 * 1000,
  })
}

/** 获取歌单详情 */
export function usePlaylistDetail(playlistId: string) {
  return useQuery({
    queryKey: queryKeys.playlistDetail(playlistId),
    queryFn: () => getAdapter().getPlaylistDetail(playlistId),
    enabled: !!playlistId,
    staleTime: 3 * 60 * 1000,
  })
}

/** 创建歌单 */
export function useCreatePlaylist() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ name, songIds }: { name: string; songIds?: string[] }) =>
      getAdapter().createPlaylist(name, songIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.playlists() })
    },
  })
}

/** 删除歌单 */
export function useDeletePlaylist() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (playlistId: string) => getAdapter().deletePlaylist(playlistId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.playlists() })
    },
  })
}

/** 向歌单添加歌曲 */
export function useAddToPlaylist() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ playlistId, songIds }: { playlistId: string; songIds: string[] }) =>
      getAdapter().addSongsToPlaylist(playlistId, songIds),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.playlistDetail(variables.playlistId) })
    },
  })
}

// ===================================================
// 收藏相关 Hooks
// ===================================================

/** 获取收藏内容 */
export function useStarred() {
  return useQuery({
    queryKey: queryKeys.starred(),
    queryFn: () => getAdapter().getStarred(),
    staleTime: 3 * 60 * 1000,
  })
}

/** 收藏/取消收藏 */
export function useToggleStar() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      type,
      isStarred,
    }: {
      id: string
      type: 'song' | 'album' | 'artist'
      isStarred: boolean
    }) => {
      const adapter = getAdapter()
      return isStarred ? adapter.unstar(id, type) : adapter.star(id, type)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.starred() })
    },
  })
}

// ===================================================
// 流派
// ===================================================

export function useGenres() {
  return useQuery({
    queryKey: queryKeys.genres(),
    queryFn: () => getAdapter().getGenres(),
    staleTime: 30 * 60 * 1000,
  })
}
