/** 推荐硬约束：三条入口（现算 / 缓存 / 平台每日推荐）共用同一道过滤 */

import { describe, expect, it } from 'vitest'
import { applyRecommendationConstraints } from './recommendationFilters'
import type { Song } from '@/api/types'

const song = (over: Partial<Song>): Song => ({
  id: 's', title: 't', artist: 'A', album: '', duration: 100, serverId: 'nas', ...over,
})

describe('applyRecommendationConstraints', () => {
  it('屏蔽的歌手与流派被滤掉（大小写与空白不影响判定）', () => {
    const out = applyRecommendationConstraints(
      [song({ id: '1', artist: ' Muted ' }), song({ id: '2', artist: 'Keep' }), song({ id: '3', genre: 'Noise' })],
      { mutedArtists: new Set(['muted']), mutedGenres: new Set(['noise']) },
    )
    expect(out.map(s => s.id)).toEqual(['2'])
  })

  it('账号确知没有会员时滤掉会员曲；未知权限一律保留', () => {
    const songs = [
      song({ id: 'vip-known', vip: true, serverId: 'netease' }),
      song({ id: 'vip-unknown', vip: true, serverId: 'qq' }),
      song({ id: 'free', serverId: 'netease' }),
    ]
    const out = applyRecommendationConstraints(songs, { accountVip: { netease: false } })
    // qq 的权益还没问到（undefined）→ 宁可多推，不凭猜测扣掉
    expect(out.map(s => s.id)).toEqual(['vip-unknown', 'free'])
  })

  it('有会员的账号不滤会员曲', () => {
    const out = applyRecommendationConstraints(
      [song({ id: 'v', vip: true, serverId: 'netease' })],
      { accountVip: { netease: true } },
    )
    expect(out.map(s => s.id)).toEqual(['v'])
  })

  it('ext.vip 与顶层 vip 同等对待，顺序保持不变', () => {
    const out = applyRecommendationConstraints(
      [song({ id: 'a' }), song({ id: 'b', ext: { vip: true } }), song({ id: 'c' })],
      { accountVip: { nas: false } },
    )
    expect(out.map(s => s.id)).toEqual(['a', 'c'])
  })
})

describe('屏蔽键原样透传（复审 A2：预归一把分隔符抹掉）', () => {
  // 这条用例走完整的 applyRecommendationConstraints：原先单测把归一后的
  // 条目直接喂 artistBlockedBy，抓不到「先 normalizeSet 再比」这层破坏。
  it('屏蔽「A」，候选 artist 为 "A / B" 经 applyRecommendationConstraints 被滤掉', () => {
    const candidate = { id: 'x', title: 'T', artist: 'A / B', serverId: 'srv' } as Song
    const out = applyRecommendationConstraints([candidate, { ...candidate, id: 'y', artist: 'C' }], {
      mutedArtists: new Set(['A']),
    })
    expect(out.map(s => s.id)).toEqual(['y'])
  })

  it('屏蔽整串「A / B」（原样、带分隔符）：挡住同名合作曲，不连坐 A 独唱', () => {
    const duo = { id: 'duo', title: 'T', artist: 'A / B', serverId: 'srv' } as Song
    const solo = { id: 'solo', title: 'T', artist: 'A', serverId: 'srv' } as Song
    const out = applyRecommendationConstraints([duo, solo], { mutedArtists: new Set(['A / B']) })
    expect(out.map(s => s.id)).toEqual(['solo'])
  })

  it('已归一持久化的新形态屏蔽键（"A/B" 被抹成 "ab"）仍命中同名合作曲', () => {
    const duo = { id: 'duo', title: 'T', artist: 'A / B', serverId: 'srv' } as Song
    const out = applyRecommendationConstraints([duo], { mutedArtists: new Set(['ab']) })
    expect(out).toEqual([])
  })
})
