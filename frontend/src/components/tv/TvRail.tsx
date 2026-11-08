/**
 * 电视的左侧导航条（样式见 index.css 的「左侧导航条」）。
 *
 * 平时只露一列图标，焦点一进来（:focus-within）就展开成面板、内容区压暗。
 * 它是一排（data-nav-group）：从内容区往左进来时落在当前页那一项（data-nav-preferred），
 * 上下键不会掉出去（data-nav-contain）。按确认换页后焦点交给新页面（TvModeEffects）。
 * 搜索放最上面：电视上搜索最常用，也最远。
 */

import { Link, useLocation } from 'react-router-dom'
import type { Icon } from '@phosphor-icons/react'
import { MagnifyingGlass, House, Sparkle, Books, Playlist, Heart, GearSix } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { prefetchRoute } from '@/routes/lazyRoutes'
import { useT } from '@/i18n'
import { PRIMARY_NAV, isNavActive, type NavItem } from '@/components/layout/navItems'

const libraryItem = PRIMARY_NAV.find(item => item.to === '/library')

const TV_NAV: Array<NavItem & { last?: boolean }> = [
  { to: '/search', labelKey: 'nav.search', icon: MagnifyingGlass },
  { to: '/', labelKey: 'nav.home', icon: House, match: p => p === '/' },
  { to: '/recommendations', labelKey: 'nav.recommendations', icon: Sparkle },
  // 音乐库沿用一级导航的匹配：专辑、歌手这些子页都算「音乐库」
  { to: '/library', labelKey: 'nav.library', icon: Books, match: libraryItem?.match },
  { to: '/playlists', labelKey: 'nav.playlists', icon: Playlist },
  { to: '/favorites', labelKey: 'nav.favorites', icon: Heart },
  { to: '/settings', labelKey: 'nav.settings', icon: GearSix, last: true },
]

/** 音乐库的匹配把歌单、收藏也吞进去了；电视上它们各有一格，先认更具体的那一格 */
function activeItem(pathname: string): string | undefined {
  const exact = TV_NAV.find(item => item.to !== '/library' && isNavActive(item, pathname))
  if (exact) return exact.to
  return TV_NAV.find(item => isNavActive(item, pathname))?.to
}

export function TvRail() {
  const { t } = useT()
  const { pathname } = useLocation()
  const current = activeItem(pathname)

  return (
    <nav aria-label={t('nav.main')} className="tv-rail" data-tv-rail="" data-nav-group="rail" data-nav-contain="y" data-nav-enter="x">
      <div className="tv-rail-dim" aria-hidden="true" />
      <div className="tv-rail-bg" aria-hidden="true" />
      <div className="tv-rail-logo" aria-hidden="true">N1KO<span>MUSIC</span></div>
      <div className="tv-rail-list">
        {TV_NAV.map(item => {
          const active = item.to === current
          const ItemIcon: Icon = item.icon
          return (
            /* Link 而不是 NavLink：NavLink 只在它自己认为匹配时才写 aria-current，
               专辑、歌手这些子页它不认作「音乐库」 */
            <Link
              key={item.to}
              to={item.to}
              onFocus={() => prefetchRoute(item.to)}
              className={cn('tv-rail-item', item.last && 'is-last')}
              aria-current={active ? 'page' : undefined}
              data-nav-preferred={active ? '' : undefined}
              data-tv-focus="rail"
              /* 收起时只露出图标那一截（38px）：按这个宽度算，内容区第一列往左才进得来 */
              data-nav-w="38"
            >
              <ItemIcon size={18} weight={active ? 'fill' : 'regular'} />
              <span className="lbl">{t(item.labelKey)}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
