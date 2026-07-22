import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getAdapter, hasAdapter } from '@/api'
import { useServerStore } from '@/store/serverStore'
import { readListeningEvents } from '@/services/listeningHistory'
import {
  buildRecommendationProfile,
  recommendSongs,
} from '@/services/recommendationEngine'
import type { Song } from '@/api/types'

const RECOMMENDATION_CACHE_PREFIX = 'msp-recommendation:'

function dayKey(): string {
  const now = new Date()
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`
}

function readHistorySnapshot(serverId: string | null, _revision: number) {
  return serverId ? readListeningEvents(serverId) : []
}

function readCachedRecommendations(key: string): Song[] | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
    return Array.isArray(parsed) ? parsed as Song[] : null
  } catch {
    return null
  }
}

function cacheRecommendations(key: string, songs: Song[]) {
  try {
    localStorage.setItem(key, JSON.stringify(songs))
  } catch {
    // 推荐结果只是可重建缓存，配额不足时直接跳过。
  }
}

export function usePersonalizedRecommendations(size = 30) {
  const serverId = useServerStore(s => s.activeServerId)
  const [batch, setBatch] = useState(0)
  const [historyRevision, setHistoryRevision] = useState(0)

  useEffect(() => {
    const onHistory = (event: Event) => {
      const detail = (event as CustomEvent<{ serverId?: string }>).detail
      if (!detail?.serverId || detail.serverId === serverId) {
        setHistoryRevision(value => value + 1)
      }
    }
    window.addEventListener('msp-history-updated', onHistory)
    return () => window.removeEventListener('msp-history-updated', onHistory)
  }, [serverId])

  const events = useMemo(
    () => readHistorySnapshot(serverId, historyRevision),
    [serverId, historyRevision]
  )
  const profile = useMemo(() => buildRecommendationProfile(events), [events])
  const seed = `${serverId ?? 'none'}:${dayKey()}:${batch}`
  const profileVersion = events[0]
    ? `${events[0].eventId}:${events[0].endedAt}`
    : 'cold-start'
  const cacheKey = `${RECOMMENDATION_CACHE_PREFIX}${seed}:${profileVersion}:${size}`

  const query = useQuery({
    queryKey: [serverId ?? 'no-server', 'personalized-recommendations', size, seed, historyRevision],
    queryFn: async (): Promise<Song[]> => {
      if (!serverId || !hasAdapter()) return []
      const cached = readCachedRecommendations(cacheKey)
      if (cached?.length) return cached.slice(0, size)
      const adapter = getAdapter()
      const [randomResult, starredResult] = await Promise.allSettled([
        adapter.getRandomSongs(Math.max(120, size * 5)),
        adapter.getStarred(),
      ])
      const randomSongs = randomResult.status === 'fulfilled' ? randomResult.value : []
      const starredSongs = starredResult.status === 'fulfilled' ? starredResult.value.songs : []
      const historySongs = events.slice(0, 150).map(event => event.song)
      const candidates = [...randomSongs, ...starredSongs, ...historySongs]
        .map(song => ({ ...song, serverId }))
      const recommendations = recommendSongs(candidates, events, size, seed)
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
