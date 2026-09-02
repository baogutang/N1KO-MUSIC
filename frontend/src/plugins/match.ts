/**
 * 同曲匹配（PLAN §2.10 三级规则，纯函数）。
 *
 * 1. ISRC 相同直接命中（唯一可靠的跨源曲目标识）；
 * 2. 标题归一相等 + 歌手集合相等 + 时长误差 ≤ 2 秒 → 精确；
 * 3. 标题归一相等 + 歌手集合有交集（feat. / 群星版等）→ 模糊，
 *    界面上要带「需确认」标（MergedSong.tier）。
 *
 * 阶段 5 的导入匹配复用这里的 mergeSongs / matchPairs。
 */

import type { Song } from '@/api/types'

/** 匹配结论：single = 只有一个来源，没参与匹配 */
export type MatchTier = 'single' | 'isrc' | 'exact' | 'fuzzy'

export interface MergedSong {
  /** 按来源优先序选出的代表曲目（播放、列表展示都用它） */
  song: Song
  /** 同一曲的全部来源版本（含代表；跨源时 ≥ 2） */
  sources: Song[]
  tier: MatchTier
}

/** 时长缺席（0 / undefined）不参与比较，视为通过 */
export const DURATION_TOLERANCE_SEC = 2

const ARTIST_SEPARATORS = /[&,;、/]|(?:\s+feat\.?\s+)|(?:\s+ft\.?\s+)|(?:\s+with\s+)/gi

/** 全角 → 半角、去空白与常见标点、小写。标题与歌手共用。 */
export function normalizeText(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    // 去所有标点与空白（含括号内容外的连接符）；中文标点在 NFKC 后仍是标点
    .replace(/[\p{P}\p{S}\p{Z}\s]+/gu, '')
}

/** 歌手串 → 归一化歌手集合（拆 & / 、 / feat. / with） */
export function artistSet(artist: string): Set<string> {
  const parts = artist.split(ARTIST_SEPARATORS).map(normalizeText).filter(Boolean)
  return new Set(parts)
}

function titleOf(song: Song): string {
  return normalizeText(song.title)
}

function hasDuration(a: Song, b: Song): boolean {
  return !!a.duration && !!b.duration
}

function durationClose(a: Song, b: Song, tolerance: number): boolean {
  if (!hasDuration(a, b)) return true
  return Math.abs(a.duration - b.duration) <= tolerance
}

function isrcOf(song: Song): string | undefined {
  const isrc = song.ext?.isrc?.[0]
  return isrc ? normalizeText(isrc) : undefined
}

/**
 * 把各来源的歌曲列表合并成 MergedSong 列表。
 *
 * `sourceOrder` 是来源优先序（serverId 数组，最前最优先）：决定代表曲目
 * 与合并组的稳定顺序；缺省按输入顺序。
 * 输出顺序：按代表曲目在（优先序）输入中的首次出现位置。
 */
export function mergeSongs(
  groups: Array<{ serverId: string; songs: Song[] }>,
  sourceOrder?: string[]
): MergedSong[] {
  const order = sourceOrder ?? groups.map(g => g.serverId)
  const rankOf = new Map(order.map((id, i) => [id, i]))
  const rank = (serverId: string) => rankOf.get(serverId) ?? order.length

  type Entry = { song: Song; srcRank: number; idx: number }
  const flat: Entry[] = []
  for (const g of groups) {
    g.songs.forEach((song, idx) => flat.push({ song, srcRank: rank(g.serverId), idx }))
  }
  flat.sort((a, b) => a.srcRank - b.srcRank || a.idx - b.idx)

  // 并查集式分组合并：isrc 命中、exact、fuzzy 依次归拢
  const buckets: Entry[][] = []
  const isrcBuckets = new Map<string, number>()

  const findBucket = (entry: Entry, match: (other: Entry) => MatchTier | null): number | null => {
    // 扫描全部桶取最优档（exact 优先于 fuzzy），同档取更早的桶，保证结果稳定
    let best: number | null = null
    let bestTier: MatchTier | null = null
    for (let i = 0; i < buckets.length; i++) {
      // 一个桶内只需和代表（第一个）比：桶内成员已经互相同曲
      const tier = match(buckets[i][0])
      if (tier === null) continue
      if (bestTier === null || tierRank(tier) < tierRank(bestTier)) {
        best = i
        bestTier = tier
      }
    }
    if (best !== null) buckets[best].push(entry)
    return best
  }

  for (const entry of flat) {
    const isrc = isrcOf(entry.song)
    if (isrc) {
      const existing = isrcBuckets.get(isrc)
      if (existing !== undefined) {
        buckets[existing].push(entry)
        continue
      }
    }
    const title = titleOf(entry.song)
    const artists = artistSet(entry.song.artist)

    const joined = findBucket(entry, other => {
      if (!titleOf(other.song) || titleOf(other.song) !== title) return null
      const otherArtists = artistSet(other.song.artist)
      const overlap = [...artists].some(a => otherArtists.has(a))
      if (!overlap) return null
      if (setsEqual(artists, otherArtists) && durationClose(entry.song, other.song, DURATION_TOLERANCE_SEC)) {
        return 'exact'
      }
      return 'fuzzy'
    })

    if (joined === null) {
      buckets.push([entry])
      if (isrc) isrcBuckets.set(isrc, buckets.length - 1)
    } else if (isrc && !isrcBuckets.has(isrc)) {
      isrcBuckets.set(isrc, joined)
    }
  }

  return buckets.map(entries => {
    const sources = entries.map(e => e.song)
    // 代表曲目 = 桶内来源优先序最前（flat 已按序入桶，桶首即代表）
    const song = entries[0].song
    const tier: MatchTier =
      sources.length === 1 ? 'single' : isrcMatched(entries) ? 'isrc' : tierOf(entries)
    return { song, sources, tier }
  })
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false
  for (const item of a) if (!b.has(item)) return false
  return true
}

/** 档位置信度：isrc > exact > fuzzy（single 不参与选桶） */
function tierRank(tier: MatchTier): number {
  return tier === 'isrc' ? 0 : tier === 'exact' ? 1 : 2
}

/** 桶里任意两个成员 ISRC 相同（有 isrc 且相等）即 isrc 档 */
function isrcMatched(entries: Array<{ song: Song }>): boolean {
  const isrcs = entries.map(e => isrcOf(e.song)).filter((x): x is string => !!x)
  if (isrcs.length < 2) return false
  return new Set(isrcs).size < isrcs.length
}

/** exact / fuzzy 判定（isrc 档除外） */
function tierOf(entries: Array<{ song: Song }>): MatchTier {
  const rep = entries[0].song
  const repArtists = artistSet(rep.artist)
  return entries.slice(1).every(({ song }) =>
    setsEqual(repArtists, artistSet(song.artist)) &&
    durationClose(rep, song, DURATION_TOLERANCE_SEC)
  ) ? 'exact' : 'fuzzy'
}

/**
 * 阶段 5 导入用：把目标库里的一首歌与候选列表配对。
 * 返回 best = { song, tier }；tier 越小越可信；null = 未匹配。
 */
export function bestMatchFor(
  target: Song,
  candidates: Song[]
): { song: Song; tier: 'isrc' | 'exact' | 'fuzzy' } | null {
  const targetIsrc = isrcOf(target)
  if (targetIsrc) {
    const hit = candidates.find(c => isrcOf(c) === targetIsrc)
    if (hit) return { song: hit, tier: 'isrc' }
  }
  const title = titleOf(target)
  const artists = artistSet(target.artist)
  let fuzzy: Song | null = null
  for (const c of candidates) {
    if (!titleOf(c) || titleOf(c) !== title) continue
    const otherArtists = artistSet(c.artist)
    if (![...artists].some(a => otherArtists.has(a))) continue
    if (setsEqual(artists, otherArtists) && durationClose(target, c, DURATION_TOLERANCE_SEC)) {
      return { song: c, tier: 'exact' }
    }
    fuzzy ??= c
  }
  return fuzzy ? { song: fuzzy, tier: 'fuzzy' } : null
}
