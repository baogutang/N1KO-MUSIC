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
