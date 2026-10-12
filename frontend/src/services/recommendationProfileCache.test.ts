/** 阶段 3.9：同一份历史快照只建一次画像 */
import { describe, expect, it, beforeEach } from 'vitest'
import { cachedRecommendationProfile, resetProfileCacheForTests } from '@/services/recommendationProfileCache'
import type { ListeningEvent } from '@/services/listeningHistory'

const events: ListeningEvent[] = [{
  version: 2, eventId: 'e1', serverId: 'srv',
  song: { id: 's1', title: 'T', artist: 'A', album: 'AL', duration: 200, serverId: 'srv' },
  startedAt: 0, endedAt: 1000, listenedSeconds: 200, completionRate: 1, outcome: 'completed',
}]

describe('cachedRecommendationProfile（3.9）', () => {
  beforeEach(resetProfileCacheForTests)

  it('同一引用返回同一个 profile 对象（不重算）', () => {
    const a = cachedRecommendationProfile(events)
    const b = cachedRecommendationProfile(events)
    expect(a).toBe(b)
  })

  it('新快照（写入后）才重建', () => {
    const a = cachedRecommendationProfile(events)
    const updated: ListeningEvent[] = [...events, {
      version: 2, eventId: 'e2', serverId: 'srv',
      song: { id: 's2', title: 'T2', artist: 'B', album: 'AL', duration: 200, serverId: 'srv' },
      startedAt: 0, endedAt: 2000, listenedSeconds: 200, completionRate: 1, outcome: 'completed',
    }]
    const b = cachedRecommendationProfile(updated)
    expect(b).not.toBe(a)
    // B 歌手进了画像
    expect(b.artistAffinity.has('b')).toBe(true)
  })
})

describe('cachedRecommendationProfile 的键（复核 F15）', () => {
  beforeEach(resetProfileCacheForTests)

  it('scope 过滤出的新数组 + 同一底层快照：命中缓存，不重算', () => {
    const snapshot: ListeningEvent[] = [...events]
    const filteredA = snapshot.filter(e => e.serverId === 'srv')
    const filteredB = snapshot.filter(e => e.serverId === 'srv') // 新数组，同一快照
    const a = cachedRecommendationProfile(filteredA, { snapshot, scope: 'nas,wy' })
    const b = cachedRecommendationProfile(filteredB, { snapshot, scope: 'nas,wy' })
    // 旧实现按 events 引用比对，这里永远 miss；新键命中
    expect(a).toBe(b)
  })

  it('同快照不同 scope：不串味（各建各的）', () => {
    const snapshot: ListeningEvent[] = [...events]
    const a = cachedRecommendationProfile(snapshot, { snapshot, scope: 'nas' })
    const b = cachedRecommendationProfile(snapshot, { snapshot, scope: 'wy' })
    expect(a).not.toBe(b)
  })
})
