import { describe, expect, it } from 'vitest'
import type { Album, Song } from '@/api/types'
import {
  buildRecommendationProfile,
  deriveRecommendationSeeds,
  pickFeaturedAlbum,
  recommendSongs,
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
    expect(profile.skipCounts.get('server-a:skip')).toBe(1)
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
    expect(seeds.genres[0]).toBe('jazz')
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
