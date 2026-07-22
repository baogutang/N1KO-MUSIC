import { describe, expect, it } from 'vitest'
import type { Song } from '@/api/types'
import {
  buildRecommendationProfile,
  recommendSongs,
} from '@/services/recommendationEngine'
import {
  deriveListeningOutcome,
  type ListeningEvent,
} from '@/services/listeningHistory'

const NOW = new Date('2026-07-22T12:00:00+08:00').getTime()

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
