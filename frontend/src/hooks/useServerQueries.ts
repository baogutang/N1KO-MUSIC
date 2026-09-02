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
import { getAdapter, getAdapterFor, hasAdapter, hasAdapterFor } from '@/api'
import { useSettingsStore } from '@/store/settingsStore'
import { useServerStore } from '@/store/serverStore'
import { useLibraryScopeStore } from '@/store/libraryScopeStore'
import { useLyricCacheStore } from '@/store/lyricCacheStore'
import { parseLrc } from '@/hooks/useLyrics'
import { mirrorFavorite } from '@/services/historySync'
import type { ListParams, Lyrics, Song } from '@/api/types'
import { t } from '@/i18n'

// ===================================================
// Query Keys - 统一管理缓存键
// ===================================================

/**
 * 所有服务器数据的缓存键均以当前激活服务器 id 作为前缀，
 * 避免切换服务器后命中上一个服务器的缓存（不同服务器的同名键/同 id 会互相污染）。
 */
const serverKey = () => {
  const id = useServerStore.getState().activeServerId ?? 'no-server'
  // 库范围参与缓存键：切库等于换一整套缓存，不会串到另一个库的内容
  const scope = useLibraryScopeStore.getState().getScope(useServerStore.getState().activeServerId)
  return scope ? `${id}@${scope}` : id
}

/** 当前选定的音乐库，未选时为 undefined（表示全部库） */
const currentFolderId = () =>
  useLibraryScopeStore.getState().getScope(useServerStore.getState().activeServerId)

export const queryKeys = {
  songs: (params?: ListParams) => [serverKey(), 'songs', params] as const,
  songDetail: (id: string) => [serverKey(), 'songs', 'detail', id] as const,
  randomSongs: (size?: number) => [serverKey(), 'songs', 'random', size] as const,
  search: (query: string) => [serverKey(), 'search', query] as const,
  albums: (params?: ListParams) => [serverKey(), 'albums', params] as const,
  albumDetail: (id: string) => [serverKey(), 'albums', id] as const,
  recentAlbums: (size?: number) => [serverKey(), 'albums', 'recent', size] as const,
  artists: () => [serverKey(), 'artists'] as const,
  artistDetail: (id: string) => [serverKey(), 'artists', id] as const,
  playlists: () => [serverKey(), 'playlists'] as const,
  playlistDetail: (id: string) => [serverKey(), 'playlists', id] as const,
  starred: () => [serverKey(), 'starred'] as const,
  genres: () => [serverKey(), 'genres'] as const,
  lyrics: (songId: string) => [serverKey(), 'lyrics', songId] as const,
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
    queryFn: ({ signal }) => getAdapter().getRandomSongs(size, currentFolderId(), signal),
    staleTime: 5 * 60 * 1000, // 5 分钟
  })
}

/** 获取所有歌曲（音乐库歌曲列表）*/
export function useSongs(params: ListParams = {}) {
  return useQuery({
    queryKey: [serverKey(), 'songs', 'all', params] as const,
    queryFn: ({ signal }) => getAdapter().getSongs({ musicFolderId: currentFolderId(), ...params, signal }),
    staleTime: 5 * 60 * 1000,
  })
}

/** 无限滚动加载歌曲（音乐库）*/
export function useSongsInfinite(size = 100) {
  return useInfiniteQuery({
    queryKey: [serverKey(), 'songs', 'infinite', size] as const,
    queryFn: ({ pageParam = 0, signal }) =>
      getAdapter().getSongs({ size, offset: pageParam as number, musicFolderId: currentFolderId(), signal }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, p) => sum + p.items.length, 0)
      if (lastPage.items.length < size) return undefined
      if (lastPage.total != null && loaded >= lastPage.total) return undefined
      return loaded
    },
  })
}

/** 获取单首歌曲详情 */
export function useSongDetail(songId: string, initialData?: Song) {
  return useQuery({
    queryKey: queryKeys.songDetail(songId),
    queryFn: () => getAdapter().getSong(songId),
    enabled: !!songId,
    initialData: initialData ?? undefined,
    staleTime: 10 * 60 * 1000,
  })
}

/** 搜索 */
export function useSearch(query: string) {
  return useQuery({
    queryKey: queryKeys.search(query),
    // TODO(sources): 聚合搜索——阶段 2 的 useSourceQueries 对所有声明 search 能力的音源并发，此处只覆盖主库
    queryFn: ({ signal }) => getAdapter().searchAll(query, signal),
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
  const { lyricsRemoteTemplate, apiAuthToken, lyricsUseRemote, lyricsPreferRemote } = useSettingsStore()
  const { getLyrics: getCachedLyrics } = useLyricCacheStore()

  const hasRemoteTemplate = lyricsUseRemote && !!lyricsRemoteTemplate

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
    queryKey: queryKeys.lyrics(songId),
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

  // 远程歌词（需要启用远程歌词源 + 配置模板）
  const remoteQuery = useQuery({
    queryKey: [serverKey(), 'lyrics-remote', songId, remoteUrl],
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
            item?.lyrics || item?.lyric || item?.lrc || item?.content || item?.text || ''
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

  // lyricsPreferRemote=true：远程有内容就用远程，否则用服务器
  // lyricsPreferRemote=false：服务器有内容就用服务器，否则用远程
  if (!lyricsPreferRemote) {
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
    queryFn: ({ signal }) => getAdapter().getAlbums({ ...params, signal }),
    staleTime: 5 * 60 * 1000,
  })
}

/** 无限滚动加载专辑（serverId 指定时按该源浏览——浏览页源切换用） */
export function useAlbumsInfinite(size = 50, type = 'newest', serverId?: string) {
  return useInfiniteQuery({
    // key 必须含 size：同一 type 不同 size 的两个书架否则会串缓存
    queryKey: [serverId ?? serverKey(), 'albums', 'infinite', type, size],
    // 适配器在 queryFn 里解析：插件源 rehydrate 时 activeServerId 先于沙箱就绪，
    // 渲染体里同步 getAdapter() 会把「还没连上」炸成整页错误
    queryFn: ({ pageParam = 0, signal }) =>
      (serverId ? getAdapterFor(serverId) : getAdapter())
        .getAlbums({ size, offset: pageParam as number, type, musicFolderId: serverId ? undefined : currentFolderId(), signal }),
    enabled: serverId ? hasAdapterFor(serverId) : hasAdapter(),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, p) => sum + p.items.length, 0)
      if (lastPage.items.length < size) return undefined
      return loaded
    },
  })
}

/**
 * 服务端已经算好的专辑书架。
 * getAlbumList2 有十种 type，此前只用了 newest 与 alphabeticalByName 两种。
 */
export function useAlbumShelf(type: AlbumShelfType, size = 12) {
  return useQuery({
    queryKey: [serverKey(), 'albums', 'shelf', type, size] as const,
    queryFn: ({ signal }) => getAdapter().getAlbums({ type, size, musicFolderId: currentFolderId(), signal }),
    staleTime: 10 * 60 * 1000,
  })
}

/** 触发服务器扫描并轮询进度 */
export function useLibraryScan() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const adapter = getAdapter()
      if (!adapter.startScan) throw new Error(t('error.scanUnsupported'))
      await adapter.startScan()
      // 轮询到扫描结束，最多等 5 分钟
      const deadline = Date.now() + 5 * 60_000
      let last: { scanning: boolean; count?: number } | null = null
      while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 2000))
        last = (await adapter.getScanStatus?.()) ?? null
        if (last && !last.scanning) break
      }
      return last
    },
    onSuccess: () => {
      // 扫描后库内容可能变了，让所有服务器数据失效
      queryClient.invalidateQueries({ queryKey: [serverKey()] })
    },
  })
}

/** 五星评分写回。userRating 早已映射并只读展示，此前只缺这一半。 */
export function useSetRating() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, rating, type = 'song' }: {
      id: string; rating: number; type?: 'song' | 'album'
    }) => {
      const adapter = getAdapter()
      if (!adapter.setRating) throw new Error(t('error.ratingUnsupported'))
      await adapter.setRating(id, rating, type)
    },
    onSuccess: (_data, variables) => {
      const sid = serverKey()
      queryClient.setQueriesData({ queryKey: [sid] }, (old: unknown) =>
        patchFieldInCache(old, variables.id, 'userRating', variables.rating)
      )
    },
  })
}

/** 获取专辑详情（serverId 指定时按该源解析——跨源 ?src= 导航用） */
export function useAlbumDetail(albumId: string, serverId?: string) {
  return useQuery({
    queryKey: [serverId ?? serverKey(), 'albums', albumId] as const,
    queryFn: ({ signal }) =>
      (serverId ? getAdapterFor(serverId) : getAdapter()).getAlbumDetail(albumId, signal),
    enabled: !!albumId && (serverId ? hasAdapterFor(serverId) : hasAdapter()),
    staleTime: 10 * 60 * 1000,
  })
}

/** 获取最近专辑（首页推荐）*/
export function useRecentAlbums(size = 20) {
  return useQuery({
    queryKey: queryKeys.recentAlbums(size),
    queryFn: ({ signal }) => getAdapter().getRecentAlbums(size, signal),
    staleTime: 5 * 60 * 1000,
  })
}

// ===================================================
// 歌手相关 Hooks
// ===================================================

/** 获取所有歌手（serverId 指定时按该源浏览——浏览页源切换用） */
export function useArtists(serverId?: string) {
  return useQuery({
    queryKey: [serverId ?? serverKey(), 'artists'] as const,
    queryFn: ({ signal }) =>
      (serverId ? getAdapterFor(serverId) : getAdapter())
        .getArtists(serverId ? undefined : currentFolderId(), signal),
    enabled: serverId ? hasAdapterFor(serverId) : hasAdapter(),
    staleTime: 10 * 60 * 1000,
  })
}

/** 获取歌手详情（serverId 指定时按该源解析——跨源 ?src= 导航用） */
export function useArtistDetail(artistId: string, serverId?: string) {
  return useQuery({
    queryKey: [serverId ?? serverKey(), 'artists', artistId] as const,
    queryFn: ({ signal }) =>
      (serverId ? getAdapterFor(serverId) : getAdapter()).getArtistDetail(artistId, signal),
    enabled: !!artistId && (serverId ? hasAdapterFor(serverId) : hasAdapter()),
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
    queryFn: ({ signal }) => getAdapter().getPlaylists(signal),
    staleTime: 3 * 60 * 1000,
  })
}

/**
 * 获取歌单详情。
 *
 * `serverId` 指定时按该音源解析（跨源导航 /playlists/:id?src=… 用），
 * 缺省按主库——单源时代的既有行为不变。缓存键同样按来源分域，
 * 不同源的「同 id 歌单」不会互相污染。
 */
export function usePlaylistDetail(playlistId: string, serverId?: string) {
  return useQuery({
    queryKey: [serverId ?? serverKey(), 'playlists', playlistId] as const,
    queryFn: ({ signal }) =>
      (serverId ? getAdapterFor(serverId) : getAdapter()).getPlaylistDetail(playlistId, signal),
    enabled: !!playlistId && (!serverId || hasAdapterFor(serverId)),
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

/**
 * 从歌单里移除曲目。
 *
 * Subsonic 的 updatePlaylist 用的是**下标**而不是歌曲 id——同一首歌在歌单里
 * 可以出现多次，用 id 删会分不清删哪一条。所以调用方必须传下标。
 *
 * 删除后要同时失效歌单详情与歌单列表：列表上显示着曲目数。
 */
export function useRemoveSongsFromPlaylist() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ playlistId, songIndexes, serverId }: {
      playlistId: string
      songIndexes: number[]
      /** 跨源歌单：条目所属音源；缺省主库 */
      serverId?: string
    }) =>
      (serverId ? getAdapterFor(serverId) : getAdapter()).removeSongsFromPlaylist(playlistId, songIndexes),
    onSuccess: (_data, { playlistId, serverId }) => {
      queryClient.invalidateQueries({ queryKey: [serverId ?? serverKey(), 'playlists', playlistId] })
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

/** 获取收藏内容（serverId 指定时按该源取——收藏页分节用） */
export function useStarred(serverId?: string) {
  return useQuery({
    queryKey: [serverId ?? serverKey(), 'starred'] as const,
    queryFn: ({ signal }) =>
      (serverId ? getAdapterFor(serverId) : getAdapter()).getStarred(signal),
    enabled: serverId ? hasAdapterFor(serverId) : hasAdapter(),
    staleTime: 3 * 60 * 1000,
  })
}

/** 收藏/取消收藏 */
export function useToggleStar() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      type,
      isStarred,
      song,
    }: {
      id: string
      type: 'song' | 'album' | 'artist'
      isStarred: boolean
      /** 传入歌曲对象时会把收藏状态一并镜像到同步服务（可选，缺省则只改音乐服务器）*/
      song?: Song
    }) => {
      const adapter = getAdapter()
      if (isStarred) await adapter.unstar(id, type)
      else await adapter.star(id, type)
      // 音乐服务器始终是收藏的权威来源，同步服务只做跨设备镜像，失败不影响本次操作
      if (type === 'song') void mirrorFavorite(id, !isStarred, song)
    },
    /**
     * 乐观更新走缓存，而不是靠调用方传进来的回滚闭包。
     *
     * 列表层现在只有一个共享的 mutation 实例，而 MutationObserver 的
     * 每次调用回调（mutate 的第二个参数）会被下一次调用覆盖：
     * 连着点两个收藏、第一个请求随后失败时，第一次的回滚永远不会执行，
     * 那一行会一直显示成已收藏。改成 mutation 级的 onMutate / onError
     * 就与观察者无关了，每一次调用各自回滚。
     */
    onMutate: (variables) => {
      const sid = serverKey()
      patchStarredInCache(queryClient, sid, variables.id, !variables.isStarred)
      return { sid, id: variables.id, previous: variables.isStarred }
    },
    onError: (_error, _variables, context) => {
      if (!context) return
      patchStarredInCache(queryClient, context.sid, context.id, context.previous)
    },
    onSuccess: (_data, variables) => {
      const sid = serverKey()
      // 收藏汇总页本身必须重取（条目会进出列表，不是就地改标记）
      queryClient.invalidateQueries({ queryKey: [sid, 'starred'] })
      // 其余家族标记为过期，但不立即重取：下次真正用到时才刷新
      for (const family of ['songs', 'albums', 'artists', 'search', 'playlists'] as const) {
        queryClient.invalidateQueries({ queryKey: [sid, family], refetchType: 'none' })
      }
      void variables
    },
  })
}

/** 就地改写缓存里某一条的任意字段，覆盖裸数组 / {items} / {songs} / {pages} 四种形状 */
function patchFieldInCache(data: unknown, id: string, field: string, value: unknown): unknown {
  const patchItem = (item: unknown): unknown => {
    if (!item || typeof item !== 'object') return item
    const record = item as Record<string, unknown>
    if (record.id !== id || record[field] === value) return item
    return { ...record, [field]: value }
  }
  if (Array.isArray(data)) return data.map(patchItem)
  if (!data || typeof data !== 'object') return data
  const obj = data as Record<string, unknown>
  if (Array.isArray(obj.pages)) {
    return { ...obj, pages: obj.pages.map(page => patchFieldInCache(page, id, field, value)) }
  }
  if (Array.isArray(obj.items)) return { ...obj, items: obj.items.map(patchItem) }
  if (Array.isArray(obj.songs)) return { ...obj, songs: obj.songs.map(patchItem) }
  if (obj.id === id) return patchItem(obj)
  return data
}

/** getAlbumList2 支持的排序维度，此前只用了其中两种 */
export type AlbumShelfType =
  | 'newest' | 'recent' | 'frequent' | 'highest' | 'starred'
  | 'random' | 'byYear' | 'alphabeticalByName' | 'alphabeticalByArtist'


/**
 * 就地把所有缓存里该 id 的 starred 标记改掉。
 *
 * 覆盖三种形状：裸数组、{ items } 分页结果、以及 infinite query 的 { pages }。
 */
function patchStarredInCache(
  queryClient: ReturnType<typeof useQueryClient>,
  sid: string,
  id: string,
  starred: boolean
) {
  const patchItem = (item: unknown): unknown => {
    if (!item || typeof item !== 'object') return item
    const record = item as { id?: string; starred?: boolean }
    if (record.id !== id || record.starred === starred) return item
    return { ...record, starred }
  }

  const patchAny = (data: unknown): unknown => {
    if (Array.isArray(data)) return data.map(patchItem)
    if (!data || typeof data !== 'object') return data
    const obj = data as Record<string, unknown>
    if (Array.isArray(obj.pages)) {
      return { ...obj, pages: obj.pages.map(page => patchAny(page)) }
    }
    if (Array.isArray(obj.items)) {
      return { ...obj, items: obj.items.map(patchItem) }
    }
    if (Array.isArray(obj.songs)) {
      return { ...obj, songs: obj.songs.map(patchItem) }
    }
    return data
  }

  queryClient.setQueriesData({ queryKey: [sid] }, (old: unknown) => patchAny(old))
}

// ===================================================
// 流派
// ===================================================

export function useGenres() {
  return useQuery({
    queryKey: queryKeys.genres(),
    queryFn: ({ signal }) => getAdapter().getGenres(signal),
    staleTime: 30 * 60 * 1000,
  })
}
