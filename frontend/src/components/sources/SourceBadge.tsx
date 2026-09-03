/**
 * 来源徽标（PLAN 2.1）。
 *
 * 多源聚合下每条曲目 / 分区都要能一眼看出「来自哪个音源」：
 * 内置音源（网易云 / QQ）用官方 App 图标（public/logos）；
 * 第三方插件没有官方图标，波普皮肤是彩色小方块（manifest color 或
 * id 哈希取 --src-1..5 色板），纸·墨·朱是单色描边空心方块。
 * 样式主体在 index.css 的 .src-chip 组件类里，这里只负责选档与排版变体。
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

/** 内置音源的官方图标（App Store 512px 官方图，打包进 public/logos） */
const PLUGIN_LOGOS: Record<string, string> = {
  netease: '/logos/netease.png',
  qqmusic: '/logos/qqmusic.jpg',
}

/** 插件有没有官方 logo（有则调用方优先用 SourceLogo，无则回退色块） */
export function pluginLogoSrc(pluginId?: string): string | undefined {
  return pluginId ? PLUGIN_LOGOS[pluginId] : undefined
}

/** 音源官方图标；没有官方图标的插件返回 null，调用方用色块兜底 */
export function SourceLogo({
  pluginId,
  size = 16,
  className,
}: {
  pluginId?: string
  size?: number
  className?: string
}) {
  const src = pluginLogoSrc(pluginId)
  if (!src) return null
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className={cn('flex-shrink-0 rounded-[22%] object-cover', className)}
    />
  )
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
  // 内置音源：官方图标顶替色块（紧凑模式略大于 9px 色块，保证图形可辨）
  const logoSrc = pluginLogoSrc(server.pluginId)
  if (logoSrc) {
    if (!withName) {
      return (
        <img
          src={logoSrc}
          alt=""
          className={cn('h-[11px] w-[11px] flex-shrink-0 rounded-[2.5px] object-cover', className)}
        />
      )
    }
    return (
      <span className={cn('inline-flex items-center gap-1.5 min-w-0', className)}>
        <img src={logoSrc} alt="" className="h-[15px] w-[15px] flex-shrink-0 rounded-[3px] object-cover" />
        <span className="truncate text-[11px] tracking-[0.08em] text-ink-soft">{server.name}</span>
      </span>
    )
  }
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
