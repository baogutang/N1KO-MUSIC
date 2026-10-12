/**
 * 推荐画像的模块级缓存（阶段 3.9；复核 F15 修键）。
 *
 * 首页两处（Home 的热门歌手排序 + MergedDailyRail 的本地推荐）各自
 * 从 ≤2 万条历史重建画像，每条 2 次 NFKC——node 模拟每次 ~11ms，
 * 而且每次回首页都重来。这里按（历史快照、源范围、引擎版本）缓存。
 *
 * 键是**底层快照引用 + scope 字符串**（复核 F15）：带 scope 的
 * readListeningEvents 每次 filter 出新数组，旧实现按返回值引用比对，
 * 多源场景下缓存从未命中过。
 */

import type { ListeningEvent } from '@/services/listeningHistory'
import {
  buildRecommendationProfile,
  type RecommendationProfile,
} from '@/services/recommendationEngine'

let cache: {
  snapshot: ListeningEvent[]
  scope: string
  profile: RecommendationProfile
} | null = null

/**
 * @param events 参与画像的事件（可能是 filter 出的新数组）
 * @param key 缓存键：底层快照引用 + scope 字符串；缺省退回（events 自身引用，''）
 */
export function cachedRecommendationProfile(
  events: ListeningEvent[],
  key: { snapshot: ListeningEvent[]; scope: string } = { snapshot: events, scope: '' },
): RecommendationProfile {
  if (cache && cache.snapshot === key.snapshot && cache.scope === key.scope) return cache.profile
  const profile = buildRecommendationProfile(events)
  cache = { snapshot: key.snapshot, scope: key.scope, profile }
  return profile
}

/** 仅供测试：重置 */
export function resetProfileCacheForTests(): void {
  cache = null
}
