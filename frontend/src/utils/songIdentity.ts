/**
 * 曲目身份的统一归一化（阶段 4.1）。
 *
 * 此前有九套局部实现各自为政：跨源匹配用 NFKC 全剥、推荐去重只去空白还把
 * 括号后缀整段剥掉（Live 版于是被当重复，F08）、统计分组只 lower、歌词匹配
 * 又一套 trim+lower……同一首歌在不同入口得到不同的「身份」。
 *
 * 这里是唯一的一份：
 * - titleKey：NFKC（全角→半角）、小写、去全部标点/符号/空白。
 *   **版本词（Live/Remix/Remaster/伴奏/Intro/Outro）保留在 key 里**——
 *   「Live 版」和「录音室版」是两首歌，剥掉版本词去重会把它们当成一首。
 * - artistKey / artistSet：整串 key 与按合作者拆开的集合（「A / B」与
 *   「B / A」是同一批人）。
 * - songKey：标题 key + 排序后的歌手集合。
 *
 * 注意：historyImport.syntheticSongId 是**持久化** id，其算法已冻结，
 * 不迁到这里、不改输出（改了会让已有统计聚合断裂）。
 */

import type { Song } from '@/api/types'

/** 合作者分隔：& , ; 、 / 以及 feat. / ft. / with */
const ARTIST_SEPARATORS = /[&,;、/]|(?:\s+feat\.?\s+)|(?:\s+ft\.?\s+)|(?:\s+with\s+)/gi

/** 全角 → 半角、去空白与常见标点、小写。标题与歌手共用。null 安全（缺元数据的歌不炸）。 */
export function normalizeText(text: string | null | undefined): string {
  return (text ?? '')
    .normalize('NFKC')
    .toLowerCase()
    // 去所有标点与空白（含括号本身——括号里的版本词作为普通文字保留）
    .replace(/[\p{P}\p{S}\p{Z}\s]+/gu, '')
}

/**
 * 标题 key。版本词保留（见文件头）：「歌名 (Live)」→「歌名live」，
 * 与「歌名」不同 key。
 */
export function titleKey(title: string | null | undefined): string {
  return normalizeText(title)
}

/** 歌手整串 key：「A / B」与「A/B」相同 */
export function artistKey(artist: string | null | undefined): string {
  return normalizeText(artist)
}

/** 歌手串 → 归一化歌手集合（拆 & / 、 / feat. / with） */
export function artistSet(artist: string | null | undefined): Set<string> {
  const parts = (artist ?? '').split(ARTIST_SEPARATORS).map(normalizeText).filter(Boolean)
  return new Set(parts)
}

/** 曲目身份 key：标题 + 排序后的歌手集合（与来源、顺序无关） */
export function songKey(song: Pick<Song, 'title' | 'artist'>): string {
  const artists = [...artistSet(song.artist ?? '')].sort().join('+')
  return `${titleKey(song.title ?? '')}|${artists}`
}

/**
 * 屏蔽命中（集合语义，阶段 4.1）。
 *
 * 屏蔽「A」要挡住「A / B」与「A feat. B」；屏蔽「A / B」（某次合作）不该
 * 连坐 A 的独唱。为此把**屏蔽条目**当整串 key 比，把**歌曲**展开成
 * 「整串 key ∪ 各合作者」的身份集合——方向就对了。
 *
 * mutedEntries 是 tasteStore 里存的原始键（旧的 lower 键也兼容：
 * 两侧都过 artistKey 归一）。
 */
/** 一串歌手的规范形：成员排序后拼接（「A / B」与「B / A」同一串） */
function canonicalGroup(artist: string): string {
  return [...artistSet(artist)].sort().join('+')
}

export function artistBlockedBy(songArtist: string, mutedEntries: Iterable<string>): boolean {
  let mutedFull: Set<string> | null = null
  for (const entry of mutedEntries) {
    const key = canonicalGroup(entry)
    if (!key) continue
    ;(mutedFull ??= new Set()).add(key)
  }
  if (!mutedFull?.size) return false
  if (mutedFull.has(canonicalGroup(songArtist))) return true
  for (const member of artistSet(songArtist)) {
    if (mutedFull.has(member)) return true
  }
  return false
}
