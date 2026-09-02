import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getAdapter, getAdapterFor, hasAdapter, hasAdapterFor } from '@/api'
import { useServerStore } from '@/store/serverStore'
import { useRecommendationCursorStore } from '@/store/recommendationCursorStore'
import { readMutedSets } from '@/store/tasteStore'
import { readListeningEvents } from '@/services/listeningHistory'
import {
  artistSeedCountFor,
  buildRecommendationProfile,
  deriveRecommendationSeeds,
  recommendSongs,
  type RecommendationProfile,
} from '@/services/recommendationEngine'
import type { ListeningEvent } from '@/services/listeningHistory'
import type { MusicServerAdapter } from '@/api/types'
import { RECOMMENDATION_CACHE_PREFIX } from '@/services/storageKeys'
import { pruneRecommendationCache, recommendationDayKey } from '@/services/storageMaintenance'
import type { Song } from '@/api/types'

/** 缓存最长保留一天，跨天后 dayKey 变化自然失效，此处只是兜底 */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

/**
 * 画像重算的最小间隔。播放中每 30 秒就会写一次收听历史，
 * 不节流的话每次都要全量解析历史并重建画像，而画像的细微变化对
 * 「歌手索引排序」毫无可见影响。
 */
const PROFILE_REFRESH_INTERVAL_MS = 60 * 1000

/** 每个定向来源单次拉取的曲目数 */
const SONGS_PER_SEED = 40

interface RecommendationCacheEntry {
  savedAt: number
  songs: Song[]
}

/**
 * 按画像向服务器定向拉取候选。
 *
 * 只用 getRandomSongs 的话，评分再精细也只是在随机曲目里重排序 —— 用户最偏好的
 * 歌手往往根本不在候选池内。这里额外按「偏好歌手 / 偏好流派 / 最近听完的歌」
 * 三个维度取样；相关接口是可选能力，不支持的服务器会返回空数组，自动退回随机候选。
 */
async function fetchDirectedCandidates(
  adapter: MusicServerAdapter,
  profile: RecommendationProfile,
  events: ListeningEvent[],
  size: number,
  batch: number
): Promise<Song[]> {
  // 种子数按目标条数反推，并让窗口随批次轮转——定向候选池本身要变，
  // 否则「换一批」的前几行永远是同一位偏好歌手。
  const seeds = deriveRecommendationSeeds(profile, events, {
    artists: artistSeedCountFor(size),
    offset: batch,
  })
  const requests: Array<Promise<Song[]>> = []

  if (adapter.getArtistSongs) {
    for (const artist of seeds.artists) {
      requests.push(adapter.getArtistSongs(artist, SONGS_PER_SEED))
    }
  }
  if (adapter.getGenreSongs) {
    for (const genre of seeds.genres) {
      requests.push(adapter.getGenreSongs(genre, SONGS_PER_SEED))
    }
  }
  if (adapter.getSimilarSongs) {
    for (const songId of seeds.songIds) {
      requests.push(adapter.getSimilarSongs(songId, SONGS_PER_SEED))
    }
  }
  if (!requests.length) return []

  const results = await Promise.allSettled(requests)
  return results.flatMap(result => (result.status === 'fulfilled' ? result.value : []))
}

function readHistorySnapshot(serverId: string | null, _revision: number) {
  return serverId ? readListeningEvents(serverId) : []
}

/**
 * 主库之外的 radio 能力音源适配器（PLAN §4.5 推荐候选跨源）。
 * 只收已连接、在册的源；随机 / 收藏两个探索通道够用即可。
 */
function collectForeignRadioAdapters(primaryServerId: string): MusicServerAdapter[] {
  const state = useServerStore.getState()
  return state.connectedServerIds
    .filter(id => id !== primaryServerId && hasAdapterFor(id))
    .map(id => getAdapterFor(id))
    .filter(a => a.getSourceCapabilities?.().radio || typeof a.getRandomSongs === 'function' || typeof a.getStarred === 'function')
}

function readCachedRecommendations(key: string): Song[] | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as RecommendationCacheEntry | Song[] | null
    // 旧版直接存裸数组且键名带 endedAt，不再复用，交给清理逻辑删除
    if (!parsed || Array.isArray(parsed) || !Array.isArray(parsed.songs)) return null
    if (Date.now() - (parsed.savedAt ?? 0) > CACHE_TTL_MS) return null
    return parsed.songs
  } catch {
    return null
  }
}

function cacheRecommendations(key: string, songs: Song[]) {
  const payload = JSON.stringify({ savedAt: Date.now(), songs } satisfies RecommendationCacheEntry)
  try {
    localStorage.setItem(key, payload)
  } catch {
    // 配额不足：先清掉过期批次再试一次，仍失败就放弃（推荐结果可重建）
    pruneRecommendationCache()
    try {
      localStorage.setItem(key, payload)
    } catch {
      return
    }
  }
  // 同一天内多次「换一批」也不会让键数量无限增长
  pruneRecommendationCache()
}

export function usePersonalizedRecommendations(size = 30) {
  const serverId = useServerStore(s => s.activeServerId)
  const [historyRevision, setHistoryRevision] = useState(0)

  // 批次游标存在全局持久 store 里：组件内 useState 活不过一次路由切换，
  // 而结果缓存 TTL 有 24 小时，两者寿命不一致会让「换一批」被静默回滚。
  const scope = `${serverId ?? 'none'}:${recommendationDayKey()}`
  const batch = useRecommendationCursorStore(s => s.cursors[scope] ?? 0)
  const advanceBatch = useRecommendationCursorStore(s => s.advance)
  const rememberShown = useRecommendationCursorStore(s => s.rememberShown)

  // 收听历史变化后节流重算画像：合并连续事件，最快每分钟一次
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let lastRefreshedAt = 0

    const scheduleRefresh = () => {
      if (timer !== null) return
      const wait = Math.max(0, PROFILE_REFRESH_INTERVAL_MS - (Date.now() - lastRefreshedAt))
      timer = setTimeout(() => {
        timer = null
        lastRefreshedAt = Date.now()
        setHistoryRevision(value => value + 1)
      }, wait)
    }

    const onHistory = (event: Event) => {
      const detail = (event as CustomEvent<{ serverId?: string }>).detail
      if (!detail?.serverId || detail.serverId === serverId) scheduleRefresh()
    }

    window.addEventListener('msp-history-updated', onHistory)
    return () => {
      window.removeEventListener('msp-history-updated', onHistory)
      if (timer !== null) clearTimeout(timer)
    }
  }, [serverId])

  const events = useMemo(
    () => readHistorySnapshot(serverId, historyRevision),
    [serverId, historyRevision]
  )
  const profile = useMemo(() => buildRecommendationProfile(events), [events])

  /**
   * seed 同时充当缓存作用域：只随「服务器 / 日期 / 换一批」变化。
   * 旧版把最近一条收听记录的 endedAt 写进了键名，导致播放中每 30 秒就
   * 产生一个新键且从不回收，几天即可撑满 localStorage 配额。
   */
  const seed = `${scope}:${batch}`
  const cacheKey = `${RECOMMENDATION_CACHE_PREFIX}${seed}:${size}`

  const query = useQuery({
    // historyRevision 刻意不进 queryKey。播放中每 30 秒就会写一次收听历史，
    // 节流后仍是每分钟一次；若它参与 key，每分钟都会重跑一整轮定向候选扇出
    // （十几个歌手/流派请求）。画像的细微变化不值这个代价——
    // 它会在下一次「换一批」或自然 refetch 时自然生效。
    queryKey: [serverId ?? 'no-server', 'personalized-recommendations', size, seed],
    queryFn: async (): Promise<Song[]> => {
      if (!serverId || !hasAdapter()) return []
      // 缓存键里已经含 batch，读它不会回放到别的批次，因此任何 batch 都可以
      // 用缓存做首屏秒开。只有「刚刚按下换一批」的那一次必须真算——
      // 否则按钮就只是在回放当天早些时候算好的结果。
      if (!justAdvancedRef.current) {
        const cached = readCachedRecommendations(cacheKey)
        if (cached?.length) return cached.slice(0, size)
      }
      justAdvancedRef.current = false
      const adapter = getAdapter()
      // 外源候选只走探索通道（随机 + 收藏）：定向种子（歌手 id / 歌曲 id）
      // 跨源不可迁移，强行按名字猜会打开一整层错配，留给阶段 3 联调
      const foreignAdapters = collectForeignRadioAdapters(serverId)
      const [randomResult, starredResult, directedResult, foreignResults] = await Promise.allSettled([
        // 随机候选保留下来作为探索通道，让画像之外的曲目仍有机会出现
        adapter.getRandomSongs(Math.max(120, size * 5)),
        adapter.getStarred(),
        fetchDirectedCandidates(adapter, profile, events, size, batch),
        Promise.all(foreignAdapters.map(async a => {
          const parts = await Promise.allSettled([
            a.getRandomSongs ? a.getRandomSongs(Math.max(40, size)) : Promise.resolve([] as Song[]),
            a.getStarred ? a.getStarred().then(r => r.songs) : Promise.resolve([] as Song[]),
          ])
          return parts.flatMap(p => (p.status === 'fulfilled' ? p.value : []))
        })),
      ])
      const randomSongs = randomResult.status === 'fulfilled' ? randomResult.value : []
      const starredSongs = starredResult.status === 'fulfilled' ? starredResult.value.songs : []
      const directedSongs = directedResult.status === 'fulfilled' ? directedResult.value : []
      const foreignSongs = foreignResults.status === 'fulfilled' ? foreignResults.value.flat() : []
      const historySongs = events.slice(0, 150).map(event => event.song)
      // 候选自带来源（mapper 已填 serverId），这里只兜底补缺，不再整体覆盖——
      // 多源候选一旦盖成主库 id，播放和上报就全打错适配器
      const candidates = [...directedSongs, ...randomSongs, ...starredSongs, ...foreignSongs, ...historySongs]
        .map(song => (song.serverId ? song : { ...song, serverId: serverId! }))
      // 排除集合只取「更早的批次」。若把当前批次也算进去，queryFn 一旦重跑
      // （StrictMode、refetch）就会把用户正看着的这一批整批排掉。
      const exclude = batch > 0
        ? new Set(useRecommendationCursorStore.getState().getShownBefore(scope, batch))
        : undefined
      const recommendations = recommendSongs(
        candidates, events, size, seed, Date.now(), profile, exclude, readMutedSets()
      )
      cacheRecommendations(cacheKey, recommendations)
      rememberShown(scope, batch, recommendations.map(song => `${song.serverId ?? ''}:${song.id}`))
      return recommendations
    },
    enabled: !!serverId && hasAdapter(),
    staleTime: 10 * 60 * 1000,
    // 「换一批」会换掉 queryKey，默认行为是直接回到 pending 且 data 变 undefined，
    // 于是整个推荐区块（连同「换一批」按钮自己）在加载期间被卸载再整块闪回。
    // 保留上一批数据，只用 isFetching 表达加载中。
    //
    // 但 placeholderData 是 observer 级而非 key 级的：切换服务器后它会把上一台
    // 服务器的推荐顶上来，点下去还会去新服务器请求不存在的 id。必须限定同一服务器。
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey?.[0] === (serverId ?? 'no-server') ? previous : undefined,
  })

  /** 标记「这一次是用户主动换一批」，用于跳过缓存强制真算 */
  const justAdvancedRef = useRef(false)
  const refresh = useCallback(() => {
    justAdvancedRef.current = true
    advanceBatch(scope)
  }, [advanceBatch, scope])

  return {
    ...query,
    refresh,
    profile,
    events,
  }
}
