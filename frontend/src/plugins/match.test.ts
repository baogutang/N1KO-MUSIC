/**
 * 同曲匹配三级规则单测（PLAN §2.10，阶段 2.2 / 阶段 5 共用）
 */

import { describe, expect, it } from 'vitest'
import type { Song } from '@/api/types'
import { artistSet, bestMatchFor, mergeSongs, normalizeText, relevanceRank } from './match'

function song(partial: Partial<Song> & { id: string; serverId: string }): Song {
  return {
    title: 't',
    artist: 'a',
    album: '',
    duration: 200,
    ...partial,
  }
}

describe('normalizeText / artistSet', () => {
  it('全角半角、大小写、标点空白都归一', () => {
    expect(normalizeText('Ｓｕｍｍｅｒ ｏｆ ＇69!')).toBe(normalizeText("summer of '69"))
    expect(normalizeText('夜の最前列（Live）')).toBe(normalizeText('夜の最前列live'))
  })

  it('歌手串拆分 & / 、 / feat. / with', () => {
  expect(artistSet('A & B、C feat. D with E')).toEqual(
      new Set(['a', 'b', 'c', 'd', 'e'])
    )
  })
})

describe('mergeSongs 三级匹配', () => {
  const nas = 'nas'
  const wy = 'wy'

  it('exact：同名同歌手时长差 1 秒 → 合并，代表按来源优先序', () => {
    const merged = mergeSongs(
      [
        { serverId: wy, songs: [song({ id: 'w1', serverId: wy, title: 'Summer', artist: 'A', duration: 200 })] },
        { serverId: nas, songs: [song({ id: 'n1', serverId: nas, title: 'summer!', artist: 'A', duration: 201 })] },
      ],
      [nas, wy] // NAS 优先
    )
    expect(merged).toHaveLength(1)
    expect(merged[0].tier).toBe('exact')
    expect(merged[0].sources).toHaveLength(2)
    expect(merged[0].song.id).toBe('n1') // NAS 代表
  })

  it('isrc：ISRC 相同直接命中（标题不同也算同曲）', () => {
    const merged = mergeSongs([
      { serverId: nas, songs: [song({ id: 'n1', serverId: nas, title: '曲名A', ext: { isrc: ['JPU900123456'] } })] },
      { serverId: wy, songs: [song({ id: 'w1', serverId: wy, title: '完全不同的标题', ext: { isrc: ['jpu900123456'] } })] },
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0].tier).toBe('isrc')
  })

  it('fuzzy：feat. 版本 → 合并但标记需确认', () => {
    const merged = mergeSongs([
      { serverId: nas, songs: [song({ id: 'n1', serverId: nas, title: 'Night Drive', artist: 'A', duration: 200 })] },
      { serverId: wy, songs: [song({ id: 'w1', serverId: wy, title: 'Night Drive', artist: 'A feat. B', duration: 240 })] },
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0].tier).toBe('fuzzy')
  })

  it('不合并：同标题但歌手无交集 / 时长差远且歌手集合不同', () => {
    const merged = mergeSongs([
      { serverId: nas, songs: [song({ id: 'n1', serverId: nas, title: 'Hello', artist: 'A' })] },
      { serverId: wy, songs: [song({ id: 'w1', serverId: wy, title: 'Hello', artist: 'B' })] },
    ])
    expect(merged).toHaveLength(2)
    expect(merged.every(m => m.tier === 'single')).toBe(true)
  })

  it('同标题同歌手但时长差 > 2 秒 → fuzzy（Live 版要人工确认）', () => {
    const merged = mergeSongs([
      { serverId: nas, songs: [song({ id: 'n1', serverId: nas, title: 'X', artist: 'A', duration: 200 })] },
      { serverId: wy, songs: [song({ id: 'w1', serverId: wy, title: 'X', artist: 'A', duration: 260 })] },
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0].tier).toBe('fuzzy')
  })

  it('时长缺席（0）不阻断匹配', () => {
    const merged = mergeSongs([
      { serverId: nas, songs: [song({ id: 'n1', serverId: nas, title: 'X', artist: 'A', duration: 0 })] },
      { serverId: wy, songs: [song({ id: 'w1', serverId: wy, title: 'X', artist: 'A', duration: 210 })] },
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0].tier).toBe('exact')
  })

  it('输出顺序稳定：按来源优先序里首次出现的位置', () => {
    const merged = mergeSongs(
      [
        { serverId: wy, songs: [song({ id: 'w-only', serverId: wy, title: 'OnlyInWy' }), song({ id: 'w-both', serverId: wy, title: 'Both' })] },
        { serverId: nas, songs: [song({ id: 'n-first', serverId: nas, title: 'FromNas' }), song({ id: 'n-both', serverId: nas, title: 'Both' })] },
      ],
      [nas, wy]
    )
    expect(merged.map(m => m.song.id)).toEqual(['n-first', 'n-both', 'w-only'])
  })

  it('同源重复曲目不互相合并（id 不同内容相同仍会合并——跨源才是目标，但同源也允许合并归并重复）', () => {
    const merged = mergeSongs([
      { serverId: nas, songs: [
        song({ id: 'n1', serverId: nas, title: 'Dup', artist: 'A' }),
        song({ id: 'n2', serverId: nas, title: 'Dup', artist: 'A' }),
      ] },
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0].sources).toHaveLength(2)
  })
})

describe('relevanceRank（搜索相关度档位）', () => {
  it('标题精确 > 前缀 > 包含 > 歌手/专辑沾边 > 其他', () => {
    const q = 'summer'
    expect(relevanceRank(song({ id: '1', serverId: 'a', title: 'Summer' }), q)).toBe(0)
    expect(relevanceRank(song({ id: '2', serverId: 'a', title: 'Summer Rain' }), q)).toBe(1)
    expect(relevanceRank(song({ id: '3', serverId: 'a', title: 'Endless Summer' }), q)).toBe(2)
    expect(relevanceRank(song({ id: '4', serverId: 'a', title: 'X', artist: 'Summer Kids' }), q)).toBe(3)
    expect(relevanceRank(song({ id: '5', serverId: 'a', title: 'X', artist: 'Y', album: 'Summer Days' }), q)).toBe(3)
    expect(relevanceRank(song({ id: '6', serverId: 'a', title: 'X', artist: 'Y' }), q)).toBe(4)
  })

  it('归一化后比较：全角、大小写、标点都不算数', () => {
    expect(relevanceRank(song({ id: '1', serverId: 'a', title: 'Ｓｕｍｍｅｒ！' }), 'summer')).toBe(0)
  })

  it('空查询一律同分，不参与排序', () => {
    expect(relevanceRank(song({ id: '1', serverId: 'a', title: '随便' }), '   ')).toBe(0)
  })
})

describe('mergeSongs 相关度混排（传 query 时）', () => {
  const nas = 'nas'
  const wy = 'wy'

  it('第二个源里的精确命中排到第一个源的沾边结果之前', () => {
    const merged = mergeSongs(
      [
        { serverId: nas, songs: [
          song({ id: 'n1', serverId: nas, title: 'Endless Summer', artist: 'A' }),
          song({ id: 'n2', serverId: nas, title: 'Summer Rain', artist: 'B' }),
        ] },
        { serverId: wy, songs: [song({ id: 'w1', serverId: wy, title: 'Summer', artist: 'C' })] },
      ],
      [nas, wy],
      'summer'
    )
    expect(merged.map(m => m.song.id)).toEqual(['w1', 'n2', 'n1'])
  })

  it('同分仍按来源优先级、再按源内次序——排序必须稳定', () => {
    const merged = mergeSongs(
      [
        { serverId: wy, songs: [song({ id: 'w1', serverId: wy, title: 'Summer Rain', artist: 'B' })] },
        { serverId: nas, songs: [
          song({ id: 'n1', serverId: nas, title: 'Summer Song', artist: 'A' }),
          song({ id: 'n2', serverId: nas, title: 'Summer Night', artist: 'C' }),
        ] },
      ],
      [nas, wy],
      'summer'
    )
    expect(merged.map(m => m.song.id)).toEqual(['n1', 'n2', 'w1'])
  })

  it('不传 query 时顺序与从前完全一致（按源拼接）', () => {
    const groups = [
      { serverId: wy, songs: [song({ id: 'w1', serverId: wy, title: 'Summer' })] },
      { serverId: nas, songs: [song({ id: 'n1', serverId: nas, title: 'Endless Summer' })] },
    ]
    expect(mergeSongs(groups, [nas, wy]).map(m => m.song.id)).toEqual(['n1', 'w1'])
  })

  it('合并组按组内最相关的那条算分（ISRC 档标题可以完全不同）', () => {
    const merged = mergeSongs(
      [
        { serverId: nas, songs: [
          song({ id: 'n-far', serverId: nas, title: '完全无关但歌手叫 Summer', artist: 'Summer' }),
          song({ id: 'n-isrc', serverId: nas, title: '中文译名', ext: { isrc: ['JPU900123456'] } }),
        ] },
        { serverId: wy, songs: [song({ id: 'w-isrc', serverId: wy, title: 'Summer', ext: { isrc: ['jpu900123456'] } })] },
      ],
      [nas, wy],
      'summer'
    )
    // 代表是 NAS 那条（标题是中文译名），但同组里网易云那条标题精确命中 → 整组排第一
    expect(merged[0].song.id).toBe('n-isrc')
    expect(merged[0].tier).toBe('isrc')
  })
})

describe('bestMatchFor（阶段 5 导入配对）', () => {
  const target = song({ id: 'x', serverId: 'wy', title: 'Summer', artist: 'A', duration: 200 })

  it('精确命中返回 exact', () => {
    const hit = bestMatchFor(target, [
      song({ id: 'c1', serverId: 'nas', title: 'Summer', artist: 'A', duration: 199 }),
    ])
    expect(hit?.tier).toBe('exact')
  })

  it('只有模糊命中返回 fuzzy，没有命中返回 null', () => {
    expect(bestMatchFor(target, [
      song({ id: 'c1', serverId: 'nas', title: 'Summer', artist: 'A feat. C', duration: 240 }),
    ])?.tier).toBe('fuzzy')
    expect(bestMatchFor(target, [
      song({ id: 'c2', serverId: 'nas', title: 'Winter', artist: 'A' }),
    ])).toBeNull()
  })
})
