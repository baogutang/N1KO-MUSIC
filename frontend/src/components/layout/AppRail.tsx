/**
 * 中等窗口（600–1023）的侧边导航条。
 *
 * iPhone Duo 展开、iPad 竖屏、iPad 半屏分屏落在这一档：横向放不下侧栏，
 * 但底部标签栏会把纵向空间切掉一截。参考 QQ 音乐在 Duo 上的做法，导航竖排在左侧，
 * 播放控制仍留在底部。四个一级入口在上，设置沉到底。
 */

import { NavLink, useLocation } from 'react-router-dom'
import { GearSix } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { needsTrafficLightInset } from '@/lib/platform'
import { prefetchRoute } from '@/routes/lazyRoutes'
import { useT } from '@/i18n'
import { PRIMARY_NAV, isNavActive } from './navItems'

const railItem = (active: boolean) =>
  cn(
    'flex w-[64px] flex-col items-center gap-1 rounded-md py-2 text-[11.5px] font-medium transition-colors duration-150',
    active ? 'bg-paper-3 text-primary' : 'text-ink-faint hover:bg-paper-deep hover:text-ink'
  )

export function AppRail() {
  const { t } = useT()
  const { pathname } = useLocation()
  const settingsActive = pathname.startsWith('/settings')

  return (
    <nav
      aria-label={t('nav.main')}
      className="sheet col-start-1 row-start-1 m-2 mr-0 flex min-h-0 w-[76px] flex-col items-center gap-1 py-3"
      style={{
        marginTop: 'calc(env(safe-area-inset-top) + 8px)',
        marginBottom: 'calc(env(safe-area-inset-bottom) + 8px)',
        marginLeft: 'calc(env(safe-area-inset-left) + 8px)',
      }}
    >
      <NavLink
        to="/"
        className={cn('mb-2 font-display text-[15px] font-semibold tracking-[-0.02em] text-ink', needsTrafficLightInset && 'mt-6')}
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
            <Icon size={22} weight={active ? 'fill' : 'regular'} />
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
        <GearSix size={22} weight={settingsActive ? 'fill' : 'regular'} />
        <span>{t('nav.settings')}</span>
      </NavLink>
    </nav>
  )
}
