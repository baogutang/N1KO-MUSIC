import type { Artist, Song } from '@/api/types'
import type { ListeningEvent } from '@/services/listeningHistory'
import { isQualifiedListeningEvent } from '@/services/listeningHistory'

export interface RecommendationProfile {
  artistAffinity: Map<string, number>
  genreAffinity: Map<string, number>
  decadeAffinity: Map<number, number>
  songAffinity: Map<string, number>
  lastPlayedAt: Map<string, number>
  skipCounts: Map<string, number>
  positiveEventCount: number
}

interface ScoredSong {
  song: Song
  score: number
}

const DAY_MS = 24 * 60 * 60 * 1000

function normalized(value?: string): string {
  return (value ?? '').trim().toLocaleLowerCase()
}

function songKey(song: Song): string {
  return `${song.serverId ?? ''}:${song.id}`
}

function addWeight<K>(map: Map<K, number>, key: K, weight: number) {
  map.set(key, (map.get(key) ?? 0) + weight)
}

function normalizeMap<K>(map: Map<K, number>) {
  const positiveMax = Math.max(0, ...Array.from(map.values()))
  if (positiveMax <= 0) return
  for (const [key, value] of map) map.set(key, value / positiveMax)
}

export function buildRecommendationProfile(
  events: ListeningEvent[],
  now = Date.now()
): RecommendationProfile {
  const profile: RecommendationProfile = {
    artistAffinity: new Map(),
    genreAffinity: new Map(),
    decadeAffinity: new Map(),
    songAffinity: new Map(),
    lastPlayedAt: new Map(),
    skipCounts: new Map(),
    positiveEventCount: 0,
  }

  for (const event of events) {
    const ageDays = Math.max(0, (now - event.endedAt) / DAY_MS)
    const recency = Math.exp(-ageDays / 90)
    const qualified = isQualifiedListeningEvent(event)
    const outcomeWeight = event.outcome === 'completed'
      ? 2
      : event.outcome === 'qualified'
        ? 1.2
        : event.outcome === 'abandoned'
          ? 0.15
          : -1.25
    const explicitBoost = event.song.starred ? 1.5 : 0
    const weight = recency * (outcomeWeight + explicitBoost)
    const key = songKey(event.song)

    if (qualified) profile.positiveEventCount++
    addWeight(profile.songAffinity, key, weight)
    if (event.outcome === 'skipped') addWeight(profile.skipCounts, key, 1)
    profile.lastPlayedAt.set(key, Math.max(profile.lastPlayedAt.get(key) ?? 0, event.endedAt))

    const artist = normalized(event.song.artist)
    const genre = normalized(event.song.genre)
    if (artist) addWeight(profile.artistAffinity, artist, weight)
    if (genre) addWeight(profile.genreAffinity, genre, weight)
    if (event.song.year) addWeight(profile.decadeAffinity, Math.floor(event.song.year / 10) * 10, weight * 0.6)
  }

  normalizeMap(profile.artistAffinity)
  normalizeMap(profile.genreAffinity)
  normalizeMap(profile.decadeAffinity)
  normalizeMap(profile.songAffinity)
  return profile
}

function hashToUnit(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) / 0xffffffff
}

function similarity(a: Song, b: Song): number {
  if (a.id === b.id && a.serverId === b.serverId) return 1
  let result = 0
  if (normalized(a.artist) && normalized(a.artist) === normalized(b.artist)) result += 0.55
  if (normalized(a.genre) && normalized(a.genre) === normalized(b.genre)) result += 0.25
  if (a.albumId && a.albumId === b.albumId) result += 0.2
  return result
}

function scoreSong(
  song: Song,
  profile: RecommendationProfile,
  seed: string,
  now: number
): number {
  const key = songKey(song)
  const artistScore = profile.artistAffinity.get(normalized(song.artist)) ?? 0
  const genreScore = profile.genreAffinity.get(normalized(song.genre)) ?? 0
  const decadeScore = song.year
    ? profile.decadeAffinity.get(Math.floor(song.year / 10) * 10) ?? 0
    : 0
  const songScore = Math.max(0, profile.songAffinity.get(key) ?? 0)
  const lastPlayed = profile.lastPlayedAt.get(key)
  const ageDays = lastPlayed ? (now - lastPlayed) / DAY_MS : Infinity
  const novelty = lastPlayed ? Math.min(1, ageDays / 45) : 1
  const recentPenalty = ageDays < 1 ? 0.9 : ageDays < 3 ? 0.55 : ageDays < 7 ? 0.25 : 0
  const skipPenalty = Math.min(0.8, (profile.skipCounts.get(key) ?? 0) * 0.2)
  const serverPopularity = Math.min(1, Math.log1p(song.playCount ?? 0) / 6)
  const exploration = hashToUnit(`${seed}:${key}`)

  // 少于 5 条有效行为时以探索和服务端已有信号为主；数据积累后逐步转向个人画像。
  const coldStart = profile.positiveEventCount < 5
  if (coldStart) {
    return exploration * 0.5 + novelty * 0.25 + serverPopularity * 0.15 + (song.starred ? 0.1 : 0)
  }

  return (
    artistScore * 0.34 +
    genreScore * 0.24 +
    decadeScore * 0.08 +
    songScore * 0.08 +
    novelty * 0.12 +
    serverPopularity * 0.06 +
    exploration * 0.08 +
    (song.starred ? 0.08 : 0) -
    recentPenalty -
    skipPenalty
  )
}

export function recommendSongs(
  candidates: Song[],
  events: ListeningEvent[],
  size: number,
  seed: string,
  now = Date.now()
): Song[] {
  const deduped = new Map<string, Song>()
  for (const song of candidates) {
    if (!song?.id) continue
    deduped.set(songKey(song), song)
  }

  const profile = buildRecommendationProfile(events, now)
  const remaining: ScoredSong[] = Array.from(deduped.values()).map(song => ({
    song,
    score: scoreSong(song, profile, seed, now),
  }))
  const selected: ScoredSong[] = []
  const artistCounts = new Map<string, number>()
  const albumCounts = new Map<string, number>()

  while (remaining.length && selected.length < size) {
    let bestIndex = -1
    let bestAdjustedScore = -Infinity
    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i]
      const artist = normalized(candidate.song.artist)
      const album = candidate.song.albumId || normalized(candidate.song.album)
      if (artist && (artistCounts.get(artist) ?? 0) >= 2) continue
      if (album && (albumCounts.get(album) ?? 0) >= 2) continue
      const similarityPenalty = selected.length
        ? Math.max(...selected.map(item => similarity(candidate.song, item.song))) * 0.24
        : 0
      const adjusted = candidate.score - similarityPenalty
      if (adjusted > bestAdjustedScore) {
        bestAdjustedScore = adjusted
        bestIndex = i
      }
    }
    if (bestIndex < 0) break
    const [best] = remaining.splice(bestIndex, 1)
    selected.push(best)
    const artist = normalized(best.song.artist)
    const album = best.song.albumId || normalized(best.song.album)
    if (artist) artistCounts.set(artist, (artistCounts.get(artist) ?? 0) + 1)
    if (album) albumCounts.set(album, (albumCounts.get(album) ?? 0) + 1)
  }

  // 小曲库或元数据高度重复时放宽多样性上限，保证返回请求数量。
  if (selected.length < size) {
    remaining.sort((a, b) => b.score - a.score)
    selected.push(...remaining.slice(0, size - selected.length))
  }
  return selected.map(item => item.song)
}

export function rankArtistsByAffinity(
  artists: Artist[],
  profile: RecommendationProfile
): Artist[] {
  return [...artists].sort((a, b) => {
    const affinityDiff =
      (profile.artistAffinity.get(normalized(b.name)) ?? 0) -
      (profile.artistAffinity.get(normalized(a.name)) ?? 0)
    if (affinityDiff !== 0) return affinityDiff
    return (b.albumCount ?? 0) - (a.albumCount ?? 0)
  })
}
