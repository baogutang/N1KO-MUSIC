/**
 * 主导航行：首页 / 音乐库 / 歌手 / 歌单 / 推荐 / 收藏 / 统计 / 本期
 *
 * 纸·墨·朱（DESIGN v2 §3）：纯文字链接，当前项 accent 色 + 下方 2px 短划线，不是背景块。
 * 糖果·波普（DESIGN v3 §3）：胶囊，当前项是葡萄紫实底 + 墨描边。
 *
 * /albums 并入音乐库页；/history 在用户菜单；/search 在顶部工具条
 */

import { NavLink } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { prefetchRoute } from '@/routes/lazyRoutes'
import { useT } from '@/i18n'

const navItems = [
  { to: '/', labelKey: 'nav.home' },
  { to: '/library', labelKey: 'nav.library' },
  { to: '/artists', labelKey: 'nav.artists' },
  { to: '/playlists', labelKey: 'nav.playlists' },
  { to: '/recommendations', labelKey: 'nav.recommendations' },
  { to: '/favorites', labelKey: 'nav.favorites' },
  { to: '/stats', labelKey: 'nav.stats' },
  { to: '/issue', labelKey: 'nav.issue' },
]

export function TopNav() {
  const { t } = useT()

  return (
    <nav
      className="flex-shrink-0 border-b border-hair select-none"
      aria-label={t('nav.main')}
      data-tauri-drag-region
    >
      <ul
        className="max-w-[1180px] mx-auto px-10 flex items-center gap-8 pop:gap-1.5 pop:py-1.5"
        data-tauri-drag-region
      >
        {navItems.map(({ to, labelKey }) => (
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
                  'pop:px-4 pop:py-2 pop:rounded-pill pop:border pop:border-transparent pop:font-semibold',
                  isActive
                    ? "text-primary after:absolute after:left-1/2 after:-translate-x-1/2 after:bottom-0 after:w-5 after:h-[2px] after:bg-primary after:content-[''] " +
                      'pop:after:hidden pop:bg-primary pop:text-primary-foreground pop:border-hair pop:shadow-press'
                    : 'text-ink-soft hover:text-primary pop:hover:bg-secondary pop:hover:text-foreground'
                )
              }
            >
              {t(labelKey)}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
