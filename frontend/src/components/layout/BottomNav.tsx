/**
 * 移动端底部导航：首页 / 音乐库 / 歌手 / 歌单 / 更多
 * 「更多」弹出次级入口：推荐 / 收藏 / 统计 / 最近播放（桌面 TopNav 其余项 + 用户菜单项）
 * 激活态沿用桌面语言：编辑风是 accent 着色，波普是主色实心胶囊——
 * 和桌面主导航的当前项是同一个语义（当前项 = 主色实底）。
 * 底部安全区留白
 */

import { NavLink, useNavigate } from 'react-router-dom'
import {
  House, Books, UsersThree, Playlist, DotsThree,
  Sparkle, Heart, ChartBar, ClockCounterClockwise, Newspaper, SteeringWheel,
} from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { prefetchRoute } from '@/routes/lazyRoutes'
import { usePlayerStore } from '@/store/playerStore'
import { useT } from '@/i18n'

const tabs = [
  { to: '/', labelKey: 'nav.home', icon: House },
  { to: '/library', labelKey: 'nav.library', icon: Books },
  { to: '/artists', labelKey: 'nav.artists', icon: UsersThree },
  { to: '/playlists', labelKey: 'nav.playlists', icon: Playlist },
]

const moreItems = [
  { to: '/recommendations', labelKey: 'nav.recommendations', icon: Sparkle },
  { to: '/issue', labelKey: 'nav.issue', icon: Newspaper },
  { to: '/favorites', labelKey: 'nav.favorites', icon: Heart },
  { to: '/stats', labelKey: 'nav.stats', icon: ChartBar },
  { to: '/history', labelKey: 'nav.history', icon: ClockCounterClockwise },
]

export function BottomNav() {
  const { t } = useT()
  const navigate = useNavigate()
  const setCarMode = usePlayerStore(s => s.setCarMode)

  return (
    <nav
      className="flex-shrink-0 border-t border-hair bg-paper select-none pop:bg-surface"
      /* 横屏时刘海/圆角在左右侧，只补上下的话导航项会被切掉一块 */
      style={{
        paddingBottom: 'env(safe-area-inset-bottom)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      }}
      aria-label={t('nav.main')}
    >
      <ul className="flex items-stretch pop:gap-1 pop:px-2 pop:pt-1.5">
        {tabs.map(({ to, labelKey, icon: Icon }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              end={to === '/'}
              onTouchStart={() => prefetchRoute(to)}
              className={({ isActive }) =>
                cn(
                  'flex flex-col items-center justify-center gap-0.5 py-1.5 transition-colors duration-200',
                  'pop:rounded-pill pop:border pop:border-transparent',
                  isActive
                    ? 'text-primary pop:bg-primary pop:text-primary-foreground pop:border-hair pop:shadow-press'
                    : 'text-ink-soft active:text-primary'
                )
              }
            >
              <Icon size={22} />
              <span className="text-[10px] font-medium tracking-[0.04em]">{t(labelKey)}</span>
            </NavLink>
          </li>
        ))}
        <li className="flex-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="w-full flex flex-col items-center justify-center gap-0.5 py-1.5 text-ink-soft active:text-primary transition-colors duration-200 pop:rounded-pill pop:border pop:border-transparent"
                aria-label={t('nav.more')}
              >
                <DotsThree size={22} weight="bold" />
                <span className="text-[10px] font-medium tracking-[0.04em]">{t('nav.more')}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top" className="w-44 mb-2">
              {moreItems.map(({ to, labelKey, icon: Icon }) => (
                <DropdownMenuItem
                  key={to}
                  onTouchStart={() => prefetchRoute(to)}
                  onClick={() => navigate(to)}
                >
                  <Icon size={16} className="mr-2" />
                  {t(labelKey)}
                </DropdownMenuItem>
              ))}
              {/*
                车载模式放在这里而不是只藏在全屏播放器的 ⋯ 里：
                真要开车的人不会为了进它连点四层。
              */}
              <DropdownMenuItem onClick={() => setCarMode(true)}>
                <SteeringWheel size={16} className="mr-2" />
                {t('player.carMode')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </li>
      </ul>
    </nav>
  )
}
