/**
 * 推荐的**硬约束**：所有候选在展示 / 入队之前都要过这一道。
 *
 * 为什么要收在一个地方：推荐有三条入口（本地画像现算、本地画像的持久化缓存、
 * 各平台的每日推荐），过滤原先只挂在其中一两条上——屏蔽了某个歌手，缓存里那批
 * 照样推；账号明确没有会员，平台每日推荐滤掉了，可从外源收藏捞来的候选没滤。
 * 用户看到的是「我明明屏蔽/放不了，它还在推」，而每次都是不同的分支漏的。
 *
 * 只放**确定**的约束：屏蔽是用户明确表达过的，会员曲只在账号确知无权益时才滤
 * （accountVip === false）。权限未知一律保留——宁可多推，不要凭猜测扣掉。
 */

import type { Song } from '@/api/types'
import { readMutedSets } from '@/store/tasteStore'
import { useServerStore } from '@/store/serverStore'

/** 与 recommendationEngine 同款归一化：大小写与首尾空白不该影响屏蔽判定 */
function normalized(text: string | undefined): string {
  return (text ?? '').trim().toLowerCase()
}

export interface RecommendationConstraints {
  mutedArtists?: ReadonlySet<string>
  mutedGenres?: ReadonlySet<string>
  /** serverId → 该源账号有没有会员；undefined 表示还不知道，不做限制 */
  accountVip?: Record<string, boolean | undefined>
}

/** 从 store 读一份当下的约束（纯函数版见 applyRecommendationConstraints） */
export function currentConstraints(): RecommendationConstraints {
  const muted = readMutedSets()
  const servers = useServerStore.getState().servers
  return {
    mutedArtists: muted.artists,
    mutedGenres: muted.genres,
    accountVip: Object.fromEntries(servers.map(s => [s.id, s.accountVip])),
  }
}

/** 纯函数：给定约束滤掉不该推的曲目（顺序不变） */
export function applyRecommendationConstraints(
  songs: readonly Song[],
  constraints: RecommendationConstraints,
): Song[] {
  const { mutedArtists, mutedGenres, accountVip } = constraints
  return songs.filter(song => {
    if (mutedArtists?.has(normalized(song.artist))) return false
    if (mutedGenres?.has(normalized(song.genre))) return false
    // 会员曲：只有确知该来源账号没有权益时才滤（undefined = 还没问到，不动）
    if ((song.vip || song.ext?.vip) && accountVip?.[song.serverId] === false) return false
    return true
  })
}

/** 便捷版：读当下的约束并应用 */
export function filterRecommendable(songs: readonly Song[]): Song[] {
  return applyRecommendationConstraints(songs, currentConstraints())
}
