/**
 * 来源徽标（PLAN 2.1）。
 *
 * 多源聚合下每条曲目 / 分区都要能一眼看出「来自哪个音源」：
 * 波普皮肤是彩色小方块（manifest color 或 id 哈希取 --src-1..5 色板），
 * 纸·墨·朱是单色描边空心方块。样式主体在 index.css 的 .src-chip 组件类里，
 * 这里只负责选档与排版变体。
 */

import { CSSProperties } from 'react'
import { cn } from '@/lib/utils'
import { usePluginStore } from '@/plugins/host/pluginStore'
import { useServerStore } from '@/store/serverStore'
import { stablePick } from '@/utils/palettePick'

/** 色板档位数（--src-1..5），与 index.css 的 .src-p1..p5 对应 */
export const SRC_PALETTE_SIZE = 5

/** id → 档位 class（src-p1..p5），导出供测试断言稳定性 */
export function paletteClass(serverId: string): string {
  return `src-p${stablePick(serverId, SRC_PALETTE_SIZE) + 1}`
}

/**
 * 单个音源的徽标。`withName` 时带音源名（分区头用），
 * 否则只有小方块（曲目行内联用，紧凑）。
 *
 * manifest 的 color（安装时已校验 #RRGGBB）原样透传给 CSS，
 * 不在 JS 里解析。
 */
export function SourceBadge({
  serverId,
  withName = false,
  className,
}: {
  serverId: string
  withName?: boolean
  className?: string
}) {
  const server = useServerStore(s => s.servers.find(x => x.id === serverId))
  const pluginColor = usePluginStore(
    s => (server?.pluginId ? s.plugins.find(p => p.id === server?.pluginId)?.color : undefined)
  )
  const chipClass = cn('src-chip', paletteClass(serverId))
  const chipStyle = pluginColor ? ({ '--chip-bg': pluginColor } as CSSProperties) : undefined

  if (!server) return null
  if (!withName) {
    return <span aria-hidden className={cn(chipClass, className)} style={chipStyle} />
  }
  return (
    <span className={cn('inline-flex items-center gap-1.5 min-w-0', className)}>
      <span aria-hidden className={chipClass} style={chipStyle} />
      <span className="truncate text-[11px] tracking-[0.08em] text-ink-soft">{server.name}</span>
    </span>
  )
}
