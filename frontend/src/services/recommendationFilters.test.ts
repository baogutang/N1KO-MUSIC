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
