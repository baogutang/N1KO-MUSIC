/**
 * 中等窗口（600–1023）的侧边导航条。
 *
 * iPhone Duo 展开、iPad 竖屏、iPad 半屏分屏落在这一档：横向放不下侧栏，
 * 但底部标签栏会把纵向空间切掉一截。参考 QQ 音乐在 Duo 上的做法，导航竖排在左侧，
 * 播放控制仍留在底部。四个一级入口在上，设置沉到底。
 */

import { NavLink, useLocation } from 'react-router-dom'
import { GearSix } from '@phosphor-icons/react'
import { motion } from 'motion/react'
import { cn } from '@/lib/utils'
import { SPRING_SNAPPY } from '@/lib/motion'
import { needsTrafficLightInset } from '@/lib/platform'
import { prefetchRoute } from '@/routes/lazyRoutes'
import { useT } from '@/i18n'
import { PRIMARY_NAV, isNavActive } from './navItems'

const railItem = (active: boolean) =>
  cn(
    'press-pop relative isolate flex w-[68px] flex-col items-center gap-1 rounded-[16px] py-2.5 text-[11.5px] font-medium',
    active ? 'text-ink' : 'text-ink-3 hover:bg-ink/[0.05] hover:text-ink'
  )

/** 当前项的底：换页时从上一项滑过来 */
function RailPill() {
  return (
    <motion.span
      layoutId="rail-active"
      transition={SPRING_SNAPPY}
      aria-hidden="true"
      className="absolute inset-0 -z-10 rounded-[16px] bg-ink/[0.075]"
    />
  )
}

export function AppRail() {
  const { t } = useT()
  const { pathname } = useLocation()
  const settingsActive = pathname.startsWith('/settings')

  return (
    <nav
      aria-label={t('nav.main')}
      className="col-start-1 row-start-1 m-2.5 mr-0 flex min-h-0 w-[84px] flex-col items-center gap-1.5 rounded-[24px] bg-surface-2/75 py-4 shadow-hair"
      style={{
        marginTop: 'calc(env(safe-area-inset-top) + 10px)',
        marginBottom: 'calc(env(safe-area-inset-bottom) + 10px)',
        marginLeft: 'calc(env(safe-area-inset-left) + 10px)',
      }}
    >
      <NavLink
        to="/"
        className={cn('mb-3 font-display text-[17px] font-bold tracking-[-0.04em] text-ink', needsTrafficLightInset && 'mt-6')}
        aria-label={t('action.backHome')}
        data-tauri-drag-region
      >
        N1KO
      </NavLink>
      {PRIMARY_NAV.map(item => {
        const active = isNavActive(item, pathname)
        const Icon = item.icon
        return (
          <NavLink
            key={item.to}
            to={item.to}
            onMouseEnter={() => prefetchRoute(item.to)}
            onTouchStart={() => prefetchRoute(item.to)}
            className={railItem(active)}
            aria-current={active ? 'page' : undefined}
          >
            {active && <RailPill />}
            <Icon size={23} weight={active ? 'fill' : 'regular'} className={active ? 'text-leaf' : undefined} />
            <span>{t(item.labelKey)}</span>
          </NavLink>
        )
      })}
      <span className="flex-1" data-tauri-drag-region />
      <NavLink
        to="/settings"
        onTouchStart={() => prefetchRoute('/settings')}
        className={railItem(settingsActive)}
        aria-current={settingsActive ? 'page' : undefined}
      >
        {settingsActive && <RailPill />}
        <GearSix size={23} weight={settingsActive ? 'fill' : 'regular'} className={settingsActive ? 'text-leaf' : undefined} />
        <span>{t('nav.settings')}</span>
      </NavLink>
    </nav>
  )
}
