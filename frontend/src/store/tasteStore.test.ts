/**
 * 复审 A3 回归：画像键形态换代（lower → normalizeText）后，
 * 已持久化的旧屏蔽键必须被迁移——否则界面显示「未屏蔽」且永远无法解除。
 */
import { describe, expect, it } from 'vitest'
import { migrateTasteKeys } from '@/store/tasteStore'

describe('migrateTasteKeys（A3：旧屏蔽键重归一）', () => {
  it('lower 形态（含空格/分隔符）迁移为 normalizeText 形态', () => {
    const out = migrateTasteKeys({
      state: {
        mutedArtists: ['Artist A', 'A / B', 'a & b'],
        mutedGenres: ['r&b', 'C-Pop'],
      },
    })
    // 空格与标点全部剥掉；同一歌手两种写法合并成一个键
    expect(out.mutedArtists).toEqual(['artista', 'ab'])
    expect(out.mutedGenres).toEqual(['rb', 'cpop'])
  })

  it('迁移后的键与画像行的键同形：includes 能命中，toggle 能解除', () => {
    const { mutedArtists } = migrateTasteKeys({ state: { mutedArtists: ['Artist A'] } })
    const profileRowKey = 'artista' // recommendationEngine 现在产出的形态
    expect(mutedArtists.includes(profileRowKey)).toBe(true)

    // toggle（store 的实现）按 includes 删——形态一致才删得掉
    const toggled = mutedArtists.includes(profileRowKey)
      ? mutedArtists.filter(k => k !== profileRowKey)
      : [...mutedArtists, profileRowKey]
    expect(toggled).toEqual([])
  })

  it('已是新形态 / 空键 / 缺字段都安全', () => {
    expect(migrateTasteKeys({ state: { mutedArtists: ['artista'], mutedGenres: [] } }))
      .toEqual({ mutedArtists: ['artista'], mutedGenres: [] })
    expect(migrateTasteKeys({ state: { mutedArtists: ['  ', '！！！'] } }))
      .toEqual({ mutedArtists: [], mutedGenres: [] })
    expect(migrateTasteKeys(undefined)).toEqual({ mutedArtists: [], mutedGenres: [] })
  })
})
