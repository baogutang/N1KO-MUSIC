import { describe, expect, it } from 'vitest'
import type { Album, Song } from '@/api/types'
import {
  buildRecommendationProfile,
  deriveRecommendationSeeds,
  pickFeaturedAlbum,
  recommendSongs,
  skipSeverity,
} from '@/services/recommendationEngine'
import {
  deriveListeningOutcome,
  type ListeningEvent,
} from '@/services/listeningHistory'

/**
 * 本期封面按「本地」日历天轮换，固定时刻必须用本地时间构造，
 * 否则断言会依赖运行机器的时区。
 */
const NOW = new Date(2026, 6, 22, 12, 0, 0, 0).getTime()

function song(id: string, artist: string, genre: string, album = id): Song {
  return {
    id,
    serverId: 'server-a',
    title: `Song ${id}`,
    artist,
    album,
    albumId: album,
    genre,
    year: 2020,
    duration: 200,
  }
}

function event(
  target: Song,
  outcome: ListeningEvent['outcome'],
  listenedSeconds: number,
  ageDays = 1
): ListeningEvent {
  const endedAt = NOW - ageDays * 24 * 60 * 60 * 1000
  return {
    version: 2,
    eventId: `${target.id}-${outcome}-${ageDays}`,
    serverId: 'server-a',
    song: target,
    startedAt: endedAt - listenedSeconds * 1000,
    endedAt,
    listenedSeconds,
    completionRate: listenedSeconds / target.duration,
    outcome,
  }
}

describe('listening outcome', () => {
  it('distinguishes skipped, qualified and completed sessions', () => {
    expect(deriveListeningOutcome(8, 200)).toBe('skipped')
    expect(deriveListeningOutcome(70, 200)).toBe('abandoned')
    expect(deriveListeningOutcome(110, 200)).toBe('qualified')
    expect(deriveListeningOutcome(190, 200)).toBe('completed')
  })
})

describe('recommendation profile', () => {
  it('learns positive affinity and keeps skip feedback negative', () => {
    const favorite = song('fav', 'Artist A', 'Jazz')
    const skipped = song('skip', 'Artist B', 'Metal')
    const profile = buildRecommendationProfile([
      event(favorite, 'completed', 200),
      event(favorite, 'completed', 200, 2),
      event(skipped, 'skipped', 5),
    ], NOW)

    expect(profile.artistAffinity.get('artist a')).toBeGreaterThan(0)
    expect(profile.artistAffinity.get('artist b')).toBeLessThan(0)
    // 跳过计数 = recency × 跳过强度。刚发生（recency≈1）、听了 5 秒就切，
    // 强度约 1.88，所以这里不是 1 而是接近 1.88。
    expect(profile.skipCounts.get('server-a:skip')).toBeCloseTo(skipSeverity(5), 1)
  })

  it('跳过计数随时间衰减，陈年跳过不再永久压制曲目', () => {
    const skipped = song('skip', 'Artist B', 'Metal')
    const fresh = buildRecommendationProfile([event(skipped, 'skipped', 5)], NOW)
    const stale = buildRecommendationProfile([event(skipped, 'skipped', 5, 400)], NOW)

    const freshCount = fresh.skipCounts.get('server-a:skip') ?? 0
    const staleCount = stale.skipCounts.get('server-a:skip') ?? 0
    expect(freshCount).toBeGreaterThan(0.9)
    // 一年多以前跳过的，惩罚必须显著低于近期跳过
    expect(staleCount).toBeLessThan(0.05)
    expect(staleCount).toBeLessThan(freshCount)
  })

  it('负向亲和度被归一化到 [-1, 0]，不会溢出量程压死整个年代', () => {
    const disliked = song('a', 'Artist B', 'Metal')
    const other = song('b', 'Artist B', 'Metal')
    const liked = song('c', 'Artist A', 'Jazz')
    const profile = buildRecommendationProfile([
      event(liked, 'completed', 200),
      ...Array.from({ length: 12 }, (_, i) =>
        event(i % 2 ? disliked : other, 'skipped', 4, i * 0.1)
      ),
    ], NOW)

    for (const map of [profile.artistAffinity, profile.genreAffinity, profile.decadeAffinity]) {
      for (const value of map.values()) {
        expect(value).toBeGreaterThanOrEqual(-1)
        expect(value).toBeLessThanOrEqual(1)
      }
    }
    expect(profile.artistAffinity.get('artist b')).toBeLessThan(0)
  })
})

describe('recommendSongs', () => {
  it('enforces artist and album diversity when enough alternatives exist', () => {
    const seedSong = song('seed', 'Artist A', 'Jazz', 'seed-album')
    const events = Array.from({ length: 6 }, (_, index) =>
      event(seedSong, 'completed', 200, index + 1)
    )
    const candidates = [
      song('a1', 'Artist A', 'Jazz', 'album-a1'),
      song('a2', 'Artist A', 'Jazz', 'album-a2'),
      song('a3', 'Artist A', 'Jazz', 'album-a3'),
      song('b1', 'Artist B', 'Jazz', 'album-b1'),
      song('c1', 'Artist C', 'Jazz', 'album-c1'),
      song('d1', 'Artist D', 'Rock', 'album-d1'),
    ]

    const result = recommendSongs(candidates, events, 5, 'daily-seed', NOW)
    const artistACount = result.filter(item => item.artist === 'Artist A').length

    expect(result).toHaveLength(5)
    expect(artistACount).toBeLessThanOrEqual(2)
    expect(new Set(result.map(item => item.id)).size).toBe(5)
  })

  it('returns stable ordering for the same daily seed', () => {
    const candidates = Array.from({ length: 12 }, (_, index) =>
      song(String(index), `Artist ${index}`, index % 2 ? 'Jazz' : 'Rock')
    )
    const first = recommendSongs(candidates, [], 8, '2026-07-22', NOW)
    const second = recommendSongs(candidates, [], 8, '2026-07-22', NOW)
    expect(second.map(item => item.id)).toEqual(first.map(item => item.id))
  })
})

describe('最近听过只降权、不排除', () => {
  /** 20 首与画像完全无关的陌生曲目，用来和高契合度曲目竞争名额 */
  function strangers(count = 20): Song[] {
    return Array.from({ length: count }, (_, i) =>
      song(`x${i}`, `Stranger ${i}`, 'Noise', `album-x${i}`)
    )
  }

  it('高契合度且昨天刚听过的歌仍会出现在推荐里', () => {
    const favorite = song('fav', 'Artist A', 'Jazz', 'album-fav')
    // 8 次完整收听：画像已离开冷启动，且 12 小时前刚听过
    const events = Array.from({ length: 8 }, (_, i) =>
      event(favorite, 'completed', 200, 0.5 + i)
    )

    const result = recommendSongs([favorite, ...strangers()], events, 5, 'seed', NOW)
    expect(result.map(item => item.id)).toContain('fav')
  })

  it('反复跳过的歌仍然会被压到推荐之外', () => {
    const disliked = song('nope', 'Artist B', 'Metal', 'album-nope')
    const favorite = song('fav', 'Artist A', 'Jazz', 'album-fav')
    const events = [
      ...Array.from({ length: 5 }, (_, i) => event(favorite, 'completed', 200, i + 1)),
      ...Array.from({ length: 4 }, (_, i) => event(disliked, 'skipped', 4, i + 1)),
    ]

    const result = recommendSongs([favorite, disliked, ...strangers()], events, 5, 'seed', NOW)
    expect(result.map(item => item.id)).not.toContain('nope')
  })
})

describe('deriveRecommendationSeeds', () => {
  it('按偏好强度取出歌手、流派与种子歌曲，并带上 artistId', () => {
    const loved = { ...song('loved', 'Artist A', 'Jazz'), artistId: 'artist-a-id' }
    const liked = song('liked', 'Artist B', 'Rock')
    const events = [
      ...Array.from({ length: 5 }, (_, i) => event(loved, 'completed', 200, i + 1)),
      event(liked, 'qualified', 120, 1),
    ]
    const profile = buildRecommendationProfile(events, NOW)
    const seeds = deriveRecommendationSeeds(profile, events, { artists: 2, genres: 2, songs: 2 })

    expect(seeds.artists[0]).toEqual({ id: 'artist-a-id', name: 'Artist A' })
    expect(seeds.artists.map(item => item.name)).toContain('Artist B')
    // 必须返回原始大小写：getSongsByGenre 大小写敏感，
    // 拿归一化后的 'jazz' 去请求会静默返回空
    expect(seeds.genres[0]).toBe('Jazz')
    expect(seeds.songIds).toContain('loved')
  })

  it('跳过的歌不会成为拉取候选的种子', () => {
    const skipped = song('skipped', 'Artist C', 'Metal')
    const events = [event(skipped, 'skipped', 3, 1)]
    const profile = buildRecommendationProfile(events, NOW)
    const seeds = deriveRecommendationSeeds(profile, events)

    expect(seeds.songIds).toEqual([])
    expect(seeds.artists).toEqual([])
  })

  it('冷启动无历史时返回空种子，调用方据此回退到随机候选', () => {
    const profile = buildRecommendationProfile([], NOW)
    expect(deriveRecommendationSeeds(profile, [])).toEqual({
      artists: [],
      genres: [],
      songIds: [],
    })
  })
})

describe('大候选池', () => {
  it('候选扩大到 600 首时仍能返回满额且保持多样性', () => {
    const candidates = Array.from({ length: 600 }, (_, i) =>
      song(`s${i}`, `Artist ${i % 40}`, i % 3 ? 'Jazz' : 'Rock', `album-${i % 60}`)
    )
    const started = performance.now()
    const result = recommendSongs(candidates, [], 30, 'seed', NOW)
    const elapsed = performance.now() - started

    expect(result).toHaveLength(30)
    expect(new Set(result.map(item => item.id)).size).toBe(30)
    // 增量维护相似度后应远快于此，留足 CI 抖动余量
    expect(elapsed).toBeLessThan(500)
  })
})

/** coverArt 传 null 表示无封面（传 undefined 会命中默认值） */
function album(id: string, songCount: number, coverArt: string | null = `cover-${id}`): Album {
  return {
    id,
    name: `Album ${id}`,
    artist: `Artist ${id}`,
    songCount,
    coverArt: coverArt ?? undefined,
  }
}

const DAY = 24 * 60 * 60 * 1000

describe('pickFeaturedAlbum', () => {
  it('同一天内结果稳定', () => {
    const albums = Array.from({ length: 8 }, (_, i) => album(String(i), 10))
    const morning = new Date(2026, 6, 28, 8, 0, 0, 0).getTime()
    const evening = new Date(2026, 6, 28, 23, 0, 0, 0).getTime()
    expect(pickFeaturedAlbum(albums, evening)?.id).toBe(pickFeaturedAlbum(albums, morning)?.id)
  })

  it('跨天自动换一张，不再长期停在同一张', () => {
    const albums = Array.from({ length: 8 }, (_, i) => album(String(i), 10))
    const picked = new Set(
      Array.from({ length: 8 }, (_, i) => pickFeaturedAlbum(albums, NOW + i * DAY)?.id)
    )
    expect(picked.size).toBe(8)
  })

  it('跳过单曲合辑，优先选正规专辑', () => {
    const albums = [album('single', 1), album('duo', 2), album('full', 12)]
    for (let day = 0; day < 5; day++) {
      expect(pickFeaturedAlbum(albums, NOW + day * DAY)?.id).toBe('full')
    }
  })

  it('跳过没有封面的专辑', () => {
    const albums = [album('nocover', 12, null), album('withcover', 12)]
    for (let day = 0; day < 5; day++) {
      expect(pickFeaturedAlbum(albums, NOW + day * DAY)?.id).toBe('withcover')
    }
  })

  it('全是单曲合辑时退化为可选项而不是空封面', () => {
    const albums = [album('a', 1), album('b', 1)]
    expect(pickFeaturedAlbum(albums, NOW)).not.toBeNull()
  })

  it('无专辑时返回 null', () => {
    expect(pickFeaturedAlbum([], NOW)).toBeNull()
  })
})

describe('「换一批」的取样与排除', () => {
  /** 构造一个偏好 12 位歌手的画像，权重依次递减 */
  function wideProfile() {
    const events: ListeningEvent[] = []
    for (let i = 0; i < 12; i++) {
      const s = song(`s${i}`, `Artist ${String.fromCharCode(65 + i)}`, `Genre${i % 6}`)
      // 排名越靠前的歌手事件越多，权重越高
      for (let n = 0; n <= 12 - i; n++) {
        events.push({ ...event(s, 'completed', 200, 1 + n * 0.01), eventId: `${i}-${n}` })
      }
    }
    return { profile: buildRecommendationProfile(events, NOW), events }
  }

  it('默认取到足够多的歌手种子，而不是只有 3 位', () => {
    const { profile, events } = wideProfile()
    const seeds = deriveRecommendationSeeds(profile, events)
    // 每位歌手最多贡献 2 首，30 首推荐至少需要 8 位歌手打底
    expect(seeds.artists.length).toBeGreaterThanOrEqual(8)
  })

  it('offset 让种子窗口滑动，换一批换的是候选池本身', () => {
    const { profile, events } = wideProfile()
    const first = deriveRecommendationSeeds(profile, events, { artists: 4, offset: 0 })
    const second = deriveRecommendationSeeds(profile, events, { artists: 4, offset: 1 })

    const a = first.artists.map(x => x.name)
    const b = second.artists.map(x => x.name)
    expect(a).not.toEqual(b)
    // 不同批次至少换掉一半歌手
    expect(b.filter(name => a.includes(name)).length).toBeLessThanOrEqual(2)
  })

  it('offset 为 0 时与不传 offset 等价', () => {
    const { profile, events } = wideProfile()
    const a = deriveRecommendationSeeds(profile, events, { artists: 5 })
    const b = deriveRecommendationSeeds(profile, events, { artists: 5, offset: 0 })
    expect(a.artists.map(x => x.name)).toEqual(b.artists.map(x => x.name))
  })

  it('候选池充足时排除上一批已展示的曲目', () => {
    const pool = Array.from({ length: 60 }, (_, i) =>
      song(`p${i}`, `Artist ${i % 20}`, `Genre${i % 5}`, `album${i % 20}`)
    )
    const first = recommendSongs(pool, [], 10, 'seed:0', NOW)
    const shownKeys = new Set(first.map(s => `server-a:${s.id}`))

    const second = recommendSongs(pool, [], 10, 'seed:1', NOW, undefined, shownKeys)

    expect(second).toHaveLength(10)
    for (const s of second) expect(shownKeys.has(`server-a:${s.id}`)).toBe(false)
  })

  it('候选池不足时不因排除而返回不满，宁可重复也要给够', () => {
    const pool = Array.from({ length: 12 }, (_, i) =>
      song(`t${i}`, `Artist ${i}`, 'Genre', `album${i}`)
    )
    const first = recommendSongs(pool, [], 10, 'seed:0', NOW)
    const shownKeys = new Set(first.map(s => `server-a:${s.id}`))

    const second = recommendSongs(pool, [], 10, 'seed:1', NOW, undefined, shownKeys)
    expect(second).toHaveLength(10)
  })
})

describe('skip severity', () => {
  it('秒跳是最强的拒绝信号', () => {
    expect(skipSeverity(1)).toBe(2)
    expect(skipSeverity(3)).toBe(2)
  })

  it('随收听时长单调回落', () => {
    expect(skipSeverity(5)).toBeGreaterThan(skipSeverity(10))
    expect(skipSeverity(10)).toBeGreaterThan(skipSeverity(18))
  })

  it('听够一段再切就回到普通权重，不再加码', () => {
    expect(skipSeverity(20)).toBe(1)
    expect(skipSeverity(120)).toBe(1)
  })

  it('秒跳的惩罚重于晚跳', () => {
    const target = song('x', 'Artist X', 'rock')
    const instant = buildRecommendationProfile(
      [event(target, 'skipped', 1)], NOW
    ).skipCounts.get('server-a:x')!
    const late = buildRecommendationProfile(
      [event(target, 'skipped', 19)], NOW
    ).skipCounts.get('server-a:x')!
    expect(instant).toBeGreaterThan(late)
    expect(instant / late).toBeCloseTo(2 / skipSeverity(19), 5)
  })

  it('同一首秒跳两次，排名低于只晚跳两次的另一首', () => {
    const hated = song('hated', 'Artist A', 'rock')
    const meh = song('meh', 'Artist A', 'rock')
    const events = [
      event(hated, 'skipped', 1, 1),
      event(hated, 'skipped', 2, 2),
      event(meh, 'skipped', 19, 1),
      event(meh, 'skipped', 19, 2),
      // 补足画像，避免走冷启动分支
      ...Array.from({ length: 6 }, (_, i) =>
        event(song(`liked${i}`, 'Artist A', 'rock'), 'completed', 195, i + 1)),
    ]
    const ranked = recommendSongs([hated, meh], events, 2, 'seed', NOW)
    expect(ranked[ranked.length - 1].id).toBe('hated')
  })
})
