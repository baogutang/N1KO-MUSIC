/**
 * 推荐画像的模块级缓存（阶段 3.9）。
 *
 * 首页两处（Home 的热门歌手排序 + MergedDailyRail 的本地推荐）各自
 * 从 ≤2 万条历史重建画像，每条 2 次 NFKC——node 模拟每次 ~11ms，
 * 而且每次回首页都重来。这里按（历史快照、源范围、引擎版本）缓存，
 * 两处与回访共用；快照引用没变就不重算（listeningHistory 的
 * readListeningEvents 在无写入时返回同一引用）。
 */

import type { ListeningEvent } from '@/services/listeningHistory'
import {
  buildRecommendationProfile,
  type RecommendationProfile,
} from '@/services/recommendationEngine'

let cache: {
  events: ListeningEvent[]
  profile: RecommendationProfile
} | null = null

export function cachedRecommendationProfile(events: ListeningEvent[]): RecommendationProfile {
  if (cache && cache.events === events) return cache.profile
  const profile = buildRecommendationProfile(events)
  cache = { events, profile }
  return profile
}

/** 仅供测试：重置 */
export function resetProfileCacheForTests(): void {
  cache = null
}
