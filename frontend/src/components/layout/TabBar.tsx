/**
 * 窄窗口（<600）的底部标签栏：iPhone、Duo 外屏、iPad 侧拉 / 窄分屏。
 * 一张浮起来的纸片胶囊，四个一级入口；当前项陶土色、图标实心。
 * 其余入口在工具栏的「更多」菜单里。
 */

import { NavLink, useLocation } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { prefetchRoute } from '@/routes/lazyRoutes'
import { useT } from '@/i18n'
import { PRIMARY_NAV, isNavActive } from './navItems'

export function TabBar() {
  const { t } = useT()
  const { pathname } = useLocation()

  return (
    <nav aria-label={t('nav.main')} className="sheet pointer-events-auto rounded-pill px-1.5 py-1">
      <ul className="flex items-stretch">
        {PRIMARY_NAV.map(item => {
          const active = isNavActive(item, pathname)
          const Icon = item.icon
          return (
            <li key={item.to} className="flex-1">
              <NavLink
                to={item.to}
                onTouchStart={() => prefetchRoute(item.to)}
                className={cn(
                  'flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-pill text-[11.5px] font-medium transition-colors duration-150',
                  active ? 'bg-paper-3 text-primary' : 'text-ink-faint active:text-ink'
                )}
                aria-current={active ? 'page' : undefined}
              >
                <Icon size={22} weight={active ? 'fill' : 'regular'} />
                <span>{t(item.labelKey)}</span>
              </NavLink>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
