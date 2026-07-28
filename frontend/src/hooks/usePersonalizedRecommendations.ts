import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getAdapter, hasAdapter } from '@/api'
import { useServerStore } from '@/store/serverStore'
import { readListeningEvents } from '@/services/listeningHistory'
import {
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
  events: ListeningEvent[]
): Promise<Song[]> {
  const seeds = deriveRecommendationSeeds(profile, events)
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
  const [batch, setBatch] = useState(0)
  const [historyRevision, setHistoryRevision] = useState(0)

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
  const seed = `${serverId ?? 'none'}:${recommendationDayKey()}:${batch}`
  const cacheKey = `${RECOMMENDATION_CACHE_PREFIX}${seed}:${size}`

  const query = useQuery({
    queryKey: [serverId ?? 'no-server', 'personalized-recommendations', size, seed],
    queryFn: async (): Promise<Song[]> => {
      if (!serverId || !hasAdapter()) return []
      const cached = readCachedRecommendations(cacheKey)
      if (cached?.length) return cached.slice(0, size)
      const adapter = getAdapter()
      const [randomResult, starredResult, directedResult] = await Promise.allSettled([
        // 随机候选保留下来作为探索通道，让画像之外的曲目仍有机会出现
        adapter.getRandomSongs(Math.max(120, size * 5)),
        adapter.getStarred(),
        fetchDirectedCandidates(adapter, profile, events),
      ])
      const randomSongs = randomResult.status === 'fulfilled' ? randomResult.value : []
      const starredSongs = starredResult.status === 'fulfilled' ? starredResult.value.songs : []
      const directedSongs = directedResult.status === 'fulfilled' ? directedResult.value : []
      const historySongs = events.slice(0, 150).map(event => event.song)
      const candidates = [...directedSongs, ...randomSongs, ...starredSongs, ...historySongs]
        .map(song => ({ ...song, serverId }))
      const recommendations = recommendSongs(candidates, events, size, seed, Date.now(), profile)
      cacheRecommendations(cacheKey, recommendations)
      return recommendations
    },
    enabled: !!serverId && hasAdapter(),
    staleTime: 10 * 60 * 1000,
  })

  const refresh = useCallback(() => setBatch(value => value + 1), [])

  return {
    ...query,
    refresh,
    profile,
    events,
  }
}
