/**
 * 心形入口的统一判定（复审 B4）：
 * 源声明了 favorites 能力才给收藏入口——插件源没声明时点了只会
 * 先变红再回滚（乐观更新被打回）甚至抛错。SongList 一直按能力隐藏，
 * PlayerBar / 全屏 / 车载 / 专辑页在 F10 后也必须走同一道闸。
 */
import type { SourceCapabilities } from '@/api/types'

export function sourceSupportsFavorites(
  caps: Record<string, SourceCapabilities> | undefined,
  serverId: string | undefined | null
): boolean {
  return !!(serverId && caps?.[serverId]?.favorites)
}
