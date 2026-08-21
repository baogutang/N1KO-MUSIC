/**
 * 主导航行（杂志编辑风，DESIGN v2 §3）
 * 纯文字链接：首页 / 音乐库 / 歌手 / 歌单 / 推荐 / 收藏 / 统计 / 本期
 * 当前项 accent 色 + 下方 2px accent 短划线（不是背景块）；hover 变 accent
 * /albums 并入音乐库页；/history 在用户菜单；/search 在顶部工具条
 */

import { NavLink } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { prefetchRoute } from '@/routes/lazyRoutes'

const navItems = [
  { to: '/', label: '首页' },
  { to: '/library', label: '音乐库' },
  { to: '/artists', label: '歌手' },
  { to: '/playlists', label: '歌单' },
  { to: '/recommendations', label: '推荐' },
  { to: '/favorites', label: '收藏' },
  { to: '/stats', label: '统计' },
  { to: '/issue', label: '本期' },
]

export function TopNav() {
  return (
    <nav
      className="flex-shrink-0 border-b border-hair select-none"
      aria-label="主导航"
      data-tauri-drag-region
    >
      <ul
        className="max-w-[1180px] mx-auto px-10 flex items-center gap-8"
        data-tauri-drag-region
      >
        {navItems.map(({ to, label }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={to === '/'}
              onMouseEnter={() => prefetchRoute(to)}
              onFocus={() => prefetchRoute(to)}
              onTouchStart={() => prefetchRoute(to)}
              className={({ isActive }) =>
                cn(
                  'relative block py-2.5 text-[14px] font-medium tracking-[0.04em] transition-colors duration-200',
                  isActive
                    ? "text-primary after:absolute after:left-1/2 after:-translate-x-1/2 after:bottom-0 after:w-5 after:h-[2px] after:bg-primary after:content-['']"
                    : 'text-ink-soft hover:text-primary'
                )
              }
            >
              {label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
