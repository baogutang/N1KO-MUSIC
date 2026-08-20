import type { Album, Artist, Song } from '@/api/types'
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
  /** 归一化歌手名 → 原始名与 artistId，用于按歌手向服务器定向拉取候选 */
  artistIdentity: Map<string, { name: string; id?: string }>
}

interface ScoredSong {
  song: Song
  score: number
  artistKey: string
  genreKey: string
  albumKey: string
  /** 与已选集合的最大相似度，逐轮增量维护 */
  maxSimilarity: number
}

const DAY_MS = 24 * 60 * 60 * 1000

/** 同一歌手/专辑在一批推荐里的最多出现次数 */
const MAX_PER_ARTIST = 2
const MAX_PER_ALBUM = 2

/**
 * 定向候选的种子数量。
 *
 * 旧值是 3 位歌手 / 2 个流派，而 MAX_PER_ARTIST=2 又把每位歌手压到 2 首，
 * 于是 30 首推荐里最多 6 首来自偏好歌手，实测只有 4–5 首，其余全部来自
 * getRandomSongs 的探索通道——「为你推荐」实质是 85% 的随机。
 * 种子数按目标条数反推：30 首至少要 8 位歌手打底才填得满。
 */
const DEFAULT_ARTIST_SEEDS = 8
const DEFAULT_GENRE_SEEDS = 4
const DEFAULT_SONG_SEEDS = 4

/** 按目标条数推算需要多少位歌手种子（每位最多贡献 MAX_PER_ARTIST 首） */
export function artistSeedCountFor(size: number): number {
  return Math.max(DEFAULT_ARTIST_SEEDS, Math.ceil(size / MAX_PER_ARTIST))
}

/** 相似度惩罚系数，用于压制「整批推荐听起来都一样」 */
const SIMILARITY_PENALTY = 0.24

function normalized(value?: string): string {
  return (value ?? '').trim().toLocaleLowerCase()
}

function songKey(song: Song): string {
  return `${song.serverId ?? ''}:${song.id}`
}

function addWeight<K>(map: Map<K, number>, key: K, weight: number) {
  map.set(key, (map.get(key) ?? 0) + weight)
}

/**
 * 正负两侧各自归一化到 [-1, 1]。
 *
 * 旧实现只除以正侧最大值，负值因此完全无界——跳过几首同年代的歌之后
 * decadeAffinity 能到 -1.37，把那整个十年的曲目一起压死，
 * 而各项权重（0.34 / 0.24 / 0.08）都是按 [0,1] 量程设计的。
 */
function normalizeMap<K>(map: Map<K, number>) {
  let positiveMax = 0
  let negativeMin = 0
  for (const value of map.values()) {
    if (value > positiveMax) positiveMax = value
    if (value < negativeMin) negativeMin = value
  }
  if (positiveMax <= 0 && negativeMin >= 0) return
  for (const [key, value] of map) {
    if (value > 0) map.set(key, positiveMax > 0 ? value / positiveMax : 0)
    else if (value < 0) map.set(key, negativeMin < 0 ? -(value / negativeMin) : 0)
  }
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
    artistIdentity: new Map(),
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
    // 跳过计数同样按时间衰减：其他信号都乘了 recency，只有它硬加 1，
    // 于是一年前跳过 4 次的歌 skipPenalty 永远是 0.6 满额，再也出不来。
    if (event.outcome === 'skipped') addWeight(profile.skipCounts, key, recency)
    profile.lastPlayedAt.set(key, Math.max(profile.lastPlayedAt.get(key) ?? 0, event.endedAt))

    const artist = normalized(event.song.artist)
    const genre = normalized(event.song.genre)
    if (artist) {
      addWeight(profile.artistAffinity, artist, weight)
      // 记录一次原始名与 id，后续可直接用于向服务器请求该歌手的曲目
      const known = profile.artistIdentity.get(artist)
      if (!known || (!known.id && event.song.artistId)) {
        profile.artistIdentity.set(artist, {
          name: event.song.artist,
          id: event.song.artistId ?? known?.id,
        })
      }
    }
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

/**
 * 相似度基于预归一化后的键计算。
 * 原实现每次比较都重新 trim + toLocaleLowerCase，候选池扩大后成为热点。
 */
function similarity(a: ScoredSong, b: ScoredSong): number {
  if (a.song.id === b.song.id && a.song.serverId === b.song.serverId) return 1
  let result = 0
  if (a.artistKey && a.artistKey === b.artistKey) result += 0.55
  if (a.genreKey && a.genreKey === b.genreKey) result += 0.25
  if (a.song.albumId && a.song.albumId === b.song.albumId) result += 0.2
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
  // 最近听过只降权、不排除：正向项之和上限约 1.0，旧值 0.9 等于把听过的歌
  // 硬排除，导致最喜欢的歌永远不会再被推荐，与 songAffinity 项互相打架。
  const recentPenalty = ageDays < 1 ? 0.32 : ageDays < 3 ? 0.18 : ageDays < 7 ? 0.07 : 0
  // 单次跳过可能只是想换首歌，代价不宜过重；反复跳过才应显著压低。
  const skipPenalty = Math.min(0.6, (profile.skipCounts.get(key) ?? 0) * 0.15)
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
  now = Date.now(),
  prebuiltProfile?: RecommendationProfile,
  /** 本轮之前已经展示过的曲目 key，「换一批」不该把刚划走的歌再端上来 */
  exclude?: ReadonlySet<string>
): Song[] {
  const deduped = new Map<string, Song>()
  for (const song of candidates) {
    if (!song?.id) continue
    deduped.set(songKey(song), song)
  }

  // 池子够大时把已展示的硬排除；池子本就不够（小曲库、服务器没实现可选接口）
  // 时排除会导致返回不足，此时保留它们，靠打分自然下沉即可。
  if (exclude?.size) {
    const survivors = new Map<string, Song>()
    for (const [key, song] of deduped) {
      if (!exclude.has(key)) survivors.set(key, song)
    }
    if (survivors.size >= size) {
      deduped.clear()
      for (const [key, song] of survivors) deduped.set(key, song)
    }
  }

  // 调用方通常已经为其他用途构建过画像，避免在大历史上重复计算一遍
  const profile = prebuiltProfile ?? buildRecommendationProfile(events, now)
  const remaining: ScoredSong[] = Array.from(deduped.values()).map(song => ({
    song,
    score: scoreSong(song, profile, seed, now),
    artistKey: normalized(song.artist),
    genreKey: normalized(song.genre),
    albumKey: song.albumId || normalized(song.album),
    maxSimilarity: 0,
  }))
  const selected: ScoredSong[] = []
  const artistCounts = new Map<string, number>()
  const albumCounts = new Map<string, number>()

  while (remaining.length && selected.length < size) {
    let bestIndex = -1
    let bestAdjustedScore = -Infinity
    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i]
      if (candidate.artistKey && (artistCounts.get(candidate.artistKey) ?? 0) >= MAX_PER_ARTIST) continue
      if (candidate.albumKey && (albumCounts.get(candidate.albumKey) ?? 0) >= MAX_PER_ALBUM) continue
      const adjusted = candidate.score - candidate.maxSimilarity * SIMILARITY_PENALTY
      if (adjusted > bestAdjustedScore) {
        bestAdjustedScore = adjusted
        bestIndex = i
      }
    }
    if (bestIndex < 0) break

    const [best] = remaining.splice(bestIndex, 1)
    selected.push(best)
    if (best.artistKey) artistCounts.set(best.artistKey, (artistCounts.get(best.artistKey) ?? 0) + 1)
    if (best.albumKey) albumCounts.set(best.albumKey, (albumCounts.get(best.albumKey) ?? 0) + 1)

    // 增量维护「与已选集合的最大相似度」：等价于原先每轮重算 Math.max，
    // 但把整体复杂度从 O(候选 × 选中²) 降到 O(候选 × 选中)。
    for (const candidate of remaining) {
      const score = similarity(candidate, best)
      if (score > candidate.maxSimilarity) candidate.maxSimilarity = score
    }
  }

  // 小曲库或元数据高度重复时放宽多样性上限，保证返回请求数量。
  if (selected.length < size) {
    remaining.sort((a, b) => b.score - a.score)
    selected.push(...remaining.slice(0, size - selected.length))
  }
  return selected.map(item => item.song)
}

/** 用于向服务器定向拉取候选的画像种子 */
export interface RecommendationSeeds {
  artists: Array<{ id?: string; name: string }>
  genres: string[]
  songIds: string[]
}

function topKeys(map: Map<string, number>, limit: number): string[] {
  return Array.from(map.entries())
    .filter(([, weight]) => weight > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key]) => key)
}

/**
 * 取排名前 limit 个键，但窗口按 offset 向后滑动。
 *
 * 候选池不够长时回绕，保证每批都能取满；offset 为 0 时与 topKeys 完全等价。
 */
function rotatedTopKeys(map: Map<string, number>, limit: number, offset: number): string[] {
  const ranked = Array.from(map.entries())
    .filter(([, weight]) => weight > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => key)
  if (!ranked.length) return []
  if (ranked.length <= limit) return ranked
  const start = ((offset * limit) % ranked.length + ranked.length) % ranked.length
  const out: string[] = []
  for (let i = 0; i < limit; i++) out.push(ranked[(start + i) % ranked.length])
  return out
}

/**
 * 从画像里取出最值得据以拉取候选的歌手、流派与种子歌曲。
 *
 * 这一步是「随机重排」与「真正推荐」的分界：只对 150 首随机曲目重排序，
 * 用户最偏好的歌手大概率根本不在候选池里。
 */
export function deriveRecommendationSeeds(
  profile: RecommendationProfile,
  events: ListeningEvent[],
  limits: { artists?: number; genres?: number; songs?: number; offset?: number } = {}
): RecommendationSeeds {
  const {
    artists: artistLimit = DEFAULT_ARTIST_SEEDS,
    genres: genreLimit = DEFAULT_GENRE_SEEDS,
    songs: songLimit = DEFAULT_SONG_SEEDS,
    offset = 0,
  } = limits

  // offset 让「换一批」轮转种子窗口：只靠打分抖动换不出新的歌手，
  // 定向候选池本身必须变，否则每批的前几行永远是同一位歌手。
  const artistKeys = rotatedTopKeys(profile.artistAffinity, artistLimit, offset)
  const artists = artistKeys.map(key => {
    const identity = profile.artistIdentity.get(key)
    return { id: identity?.id, name: identity?.name ?? key }
  })

  // 种子歌曲取最近听完的曲目：既贴合当下口味，也最可能有可用的相似曲目
  const songIds: string[] = []
  const seen = new Set<string>()
  for (const event of events) {
    if (songIds.length >= songLimit) break
    if (event.outcome !== 'completed' && event.outcome !== 'qualified') continue
    if (seen.has(event.song.id)) continue
    seen.add(event.song.id)
    songIds.push(event.song.id)
  }

  return {
    artists,
    genres: rotatedTopKeys(profile.genreAffinity, genreLimit, offset),
    songIds,
  }
}

/** 「本期封面」的最小曲目数：单曲合辑放大成杂志封面观感上像是坏了 */
const FEATURED_MIN_SONGS = 3

/** 本地日历天序号，保证轮换在本地午夜切换而不是 UTC 午夜 */
function localDayIndex(now: number): number {
  const offsetMs = new Date(now).getTimezoneOffset() * 60_000
  return Math.floor((now - offsetMs) / DAY_MS)
}

/**
 * 首页「本期封面」选片。
 *
 * 此前直接取「最近添加」的第 0 项，因此只要音乐库没有新专辑入库就永远不变，
 * 与「本期」的语义不符。改为在最近入库的专辑里按本地日历天轮换，
 * 同一天内结果稳定，跨天自动换一张。
 */
export function pickFeaturedAlbum(albums: Album[], now = Date.now()): Album | null {
  if (!albums.length) return null

  const withCover = albums.filter(album => !!album.coverArt)
  const substantial = withCover.filter(album => (album.songCount ?? 0) >= FEATURED_MIN_SONGS)
  // 逐级放宽：有封面的正规专辑 → 有封面的任意专辑 → 全部
  const pool = substantial.length ? substantial : withCover.length ? withCover : albums

  return pool[localDayIndex(now) % pool.length] ?? null
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
