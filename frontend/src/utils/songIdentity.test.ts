/**
 * 阶段 4.1 回归：曲目身份归一化的唯一真源。
 *
 * 覆盖任务书点名的全部对照用例：全半角、大小写、空白、版本词保留（F08）、
 * 合作者拆分、跨源去重键、屏蔽的集合语义，以及 syntheticSongId 的冻结。
 */
import { describe, expect, it } from 'vitest'
import {
  artistBlockedBy,
  artistKey,
  artistSet,
  normalizeText,
  songKey,
  titleKey,
} from '@/utils/songIdentity'
import { syntheticSongId } from '@/services/historyImport'

describe('normalizeText / titleKey', () => {
  it('全角→半角、大小写、空白与标点都不影响同一性', () => {
    expect(titleKey('Ｈｅｌｌｏ Ｗｏｒｌｄ')).toBe(titleKey('hello world'))
    expect(titleKey('晴天！')).toBe(titleKey('晴天'))
    expect(titleKey('A-B_C')).toBe(titleKey('abc'))
  })

  it('版本词保留在 key 里（F08：Live 版不再被当重复）', () => {
    const base = titleKey(' song ')
    for (const suffix of ['Live', 'Remix', 'Remaster', '伴奏', 'Intro', 'Outro']) {
      expect(titleKey(`song (${suffix})`)).not.toBe(base)
    }
    // 同一版本词的两种写法仍是同一首
    expect(titleKey('Song (Live)')).toBe(titleKey('song ［live］'))
  })

  it('null / undefined 安全（缺元数据的歌不炸）', () => {
    expect(normalizeText(undefined)).toBe('')
    expect(normalizeText(null)).toBe('')
    expect(titleKey(undefined)).toBe('')
  })
})

describe('artistKey / artistSet', () => {
  it('按 / 、 & feat. ft. with 拆成集合', () => {
    expect([...artistSet('A / B')].sort()).toEqual(['a', 'b'])
    expect([...artistSet('A、B')].sort()).toEqual(['a', 'b'])
    expect([...artistSet('A & B')].sort()).toEqual(['a', 'b'])
    expect([...artistSet('A feat. B')].sort()).toEqual(['a', 'b'])
    expect([...artistSet('A ft. B')].sort()).toEqual(['a', 'b'])
    expect([...artistSet('A with B')].sort()).toEqual(['a', 'b'])
    // 三个合作者混用分隔符
    expect([...artistSet('A / B、C & D')].sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('整串 key 剥分隔符：「A / B」与「A/B」相同，与「AB」也相同（同形态即同串）', () => {
    expect(artistKey('A / B')).toBe(artistKey('A/B'))
    expect(artistKey('Artist 名')).toBe(artistKey('artist　名')) // 全角空格
  })
})

describe('songKey', () => {
  it('合作者顺序无关：「A / B」与「B feat. A」是同一首', () => {
    expect(songKey({ title: 'T', artist: 'A / B' })).toBe(songKey({ title: 'T', artist: 'B feat. A' }))
  })

  it('Live 版与录音室版不同 key（去重不再吃掉 Live）', () => {
    expect(songKey({ title: 'T (Live)', artist: 'A' })).not.toBe(songKey({ title: 'T', artist: 'A' }))
  })

  it('标题差一个字就不是同一首；全半角/大小写差异是同一首', () => {
    expect(songKey({ title: 'T1', artist: 'A' })).not.toBe(songKey({ title: 'T2', artist: 'A' }))
    expect(songKey({ title: 'Ｔ１', artist: 'Ａ' })).toBe(songKey({ title: 't1', artist: 'a' }))
  })
})

describe('artistBlockedBy（屏蔽的集合语义）', () => {
  it('屏蔽「A」挡住「A / B」与「A feat. B」', () => {
    const muted = ['A']
    expect(artistBlockedBy('A / B', muted)).toBe(true)
    expect(artistBlockedBy('A feat. B', muted)).toBe(true)
    expect(artistBlockedBy('B / C', muted)).toBe(false)
  })

  it('屏蔽「A / B」（某次合作）不连坐 A 的独唱，但挡住这次合作本身', () => {
    const muted = ['A / B']
    expect(artistBlockedBy('A', muted)).toBe(false)
    expect(artistBlockedBy('A / B', muted)).toBe(true)
    expect(artistBlockedBy('B / A', muted)).toBe(true) // 顺序换了还是那次合作
  })

  it('旧形态的持久化屏蔽键（lower、保留空格）同样命中', () => {
    const legacy = ['artist a'] // trim+lower 的老键
    expect(artistBlockedBy('Artist A', legacy)).toBe(true)
    expect(artistBlockedBy('Artist A / Someone', legacy)).toBe(true)
  })

  it('空名单与空串歌手', () => {
    expect(artistBlockedBy('A', [])).toBe(false)
    expect(artistBlockedBy('', ['a'])).toBe(false)
  })
})

describe('syntheticSongId 冻结', () => {
  it('输出与旧算法逐字面量一致（持久化 id，改了会断掉已有统计聚合）', () => {
    // 由 2026-09-22 的实现算出并钉死（复审 B16：此前只比自等性，算法换了测试照样绿）：
    expect(syntheticSongId('Artist A', 'Song One')).toBe('import:1qgsyqy')
    expect(syntheticSongId('X', 'Y')).toBe('import:1i9us94')
    expect(syntheticSongId('周杰伦', '晴天')).toBe('import:1qf2wg8')
    expect(syntheticSongId('Artist A', 'Song One')).toBe(syntheticSongId('artist a', 'song one'))
    // 同输入必同输出（聚合性）
    expect(syntheticSongId('X', 'Y')).toBe(syntheticSongId('X', 'Y'))
    // 不同输入不同 id
    expect(syntheticSongId('X', 'Y')).not.toBe(syntheticSongId('X', 'Z'))
  })
})

describe('全角分隔符与括号 feat（复审 B8：先 NFKC 再拆）', () => {
  it('全角 ＆ ， ／ 都能拆', () => {
    expect([...artistSet('A＆B')].sort()).toEqual(['a', 'b'])
    expect([...artistSet('A，B')].sort()).toEqual(['a', 'b'])
    expect([...artistSet('A／B')].sort()).toEqual(['a', 'b'])
  })

  it('括号形态的 feat：A (feat. B) 与全角 A（feat.B）都拆', () => {
    expect([...artistSet('A (feat. B)')].sort()).toEqual(['a', 'b'])
    expect([...artistSet('A（feat.B）')].sort()).toEqual(['a', 'b'])
    expect([...artistSet('A (ft. B)')].sort()).toEqual(['a', 'b'])
  })

  it('with 仍按词拆：Within Temptation 不被误拆', () => {
    expect([...artistSet('Within Temptation')]).toEqual(['withintemptation'])
    expect([...artistSet('A with B')].sort()).toEqual(['a', 'b'])
  })
})

describe('词边界与无点形态（复审 D6）', () => {
  it('无点形态 A feat B / A ft B 也拆', () => {
    expect([...artistSet('A feat B')].sort()).toEqual(['a', 'b'])
    expect([...artistSet('A ft B')].sort()).toEqual(['a', 'b'])
  })

  it('(with B) 括号形态拆得开', () => {
    expect([...artistSet('A (with B)')].sort()).toEqual(['a', 'b'])
    expect([...artistSet('A（with B）')].sort()).toEqual(['a', 'b'])
  })

  it('词边界不误伤：feature / featuring / Without You 不是分隔符', () => {
    expect([...artistSet('The Featuring Project')]).toEqual(['thefeaturingproject'])
    expect([...artistSet('DJ Feature')]).toEqual(['djfeature'])
  })
})
