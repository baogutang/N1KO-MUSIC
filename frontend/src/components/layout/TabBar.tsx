/**
 * 窄窗口（<600）的底部标签栏：iPhone、Duo 外屏、iPad 侧拉 / 窄分屏。
 * 一枚浮在内容之上的玻璃胶囊，四个一级入口；当前项底下那块片会从上一项滑过来。
 * 其余入口在工具栏的「更多」菜单里。
 */

import { NavLink, useLocation } from 'react-router-dom'
import { motion } from 'motion/react'
import { cn } from '@/lib/utils'
import { SPRING_SNAPPY } from '@/lib/motion'
import { haptic } from '@/lib/haptics'
import { prefetchRoute } from '@/routes/lazyRoutes'
import { useT } from '@/i18n'
import { PRIMARY_NAV, isNavActive } from './navItems'

export function TabBar() {
  const { t } = useT()
  const { pathname } = useLocation()

  return (
    <nav aria-label={t('nav.main')} className="glass pointer-events-auto rounded-pill p-1.5">
      <ul className="flex items-stretch">
        {PRIMARY_NAV.map(item => {
          const active = isNavActive(item, pathname)
          const Icon = item.icon
          return (
            <li key={item.to} className="flex-1">
              <NavLink
                to={item.to}
                onTouchStart={() => prefetchRoute(item.to)}
                onClick={() => { if (!active) haptic('selection') }}
                className={cn(
                  'press-pop relative isolate flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-pill text-[11px] font-semibold',
                  active ? 'text-ink' : 'text-ink-3 active:text-ink'
                )}
                aria-current={active ? 'page' : undefined}
              >
                {active && (
                  <motion.span
                    layoutId="tab-active"
                    transition={SPRING_SNAPPY}
                    aria-hidden="true"
                    className="absolute inset-0 -z-10 rounded-pill bg-ink/[0.08]"
                  />
                )}
                <Icon size={23} weight={active ? 'fill' : 'regular'} className={active ? 'text-leaf' : undefined} />
                <span>{t(item.labelKey)}</span>
              </NavLink>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
