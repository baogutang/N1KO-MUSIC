/**
 * 移动端底部导航：首页 / 音乐库 / 歌手 / 歌单 / 更多
 * 「更多」弹出次级入口：推荐 / 收藏 / 统计 / 最近播放（桌面 TopNav 其余项 + 用户菜单项）
 * 激活态沿用桌面语言：accent 色（桌面为文字 + 2px 短划线，移动端为图标+文字着色）
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

const tabs = [
  { to: '/', label: '首页', icon: House },
  { to: '/library', label: '音乐库', icon: Books },
  { to: '/artists', label: '歌手', icon: UsersThree },
  { to: '/playlists', label: '歌单', icon: Playlist },
]

const moreItems = [
  { to: '/recommendations', label: '推荐', icon: Sparkle },
  { to: '/issue', label: '本期', icon: Newspaper },
  { to: '/favorites', label: '收藏', icon: Heart },
  { to: '/stats', label: '统计', icon: ChartBar },
  { to: '/history', label: '最近播放', icon: ClockCounterClockwise },
]

export function BottomNav() {
  const navigate = useNavigate()
  const setCarMode = usePlayerStore(s => s.setCarMode)

  return (
    <nav
      className="flex-shrink-0 border-t border-hair bg-paper select-none"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label="主导航"
    >
      <ul className="flex items-stretch">
        {tabs.map(({ to, label, icon: Icon }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              end={to === '/'}
              onTouchStart={() => prefetchRoute(to)}
              className={({ isActive }) =>
                cn(
                  'flex flex-col items-center justify-center gap-0.5 py-1.5 transition-colors duration-200',
                  isActive ? 'text-primary' : 'text-ink-soft active:text-primary'
                )
              }
            >
              <Icon size={22} />
              <span className="text-[10px] font-medium tracking-[0.04em]">{label}</span>
            </NavLink>
          </li>
        ))}
        <li className="flex-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="w-full flex flex-col items-center justify-center gap-0.5 py-1.5 text-ink-soft active:text-primary transition-colors duration-200"
                aria-label="更多"
              >
                <DotsThree size={22} weight="bold" />
                <span className="text-[10px] font-medium tracking-[0.04em]">更多</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top" className="w-44 mb-2">
              {moreItems.map(({ to, label, icon: Icon }) => (
                <DropdownMenuItem
                  key={to}
                  onTouchStart={() => prefetchRoute(to)}
                  onClick={() => navigate(to)}
                >
                  <Icon size={16} className="mr-2" />
                  {label}
                </DropdownMenuItem>
              ))}
              {/*
                车载模式放在这里而不是只藏在全屏播放器的 ⋯ 里：
                真要开车的人不会为了进它连点四层。
              */}
              <DropdownMenuItem onClick={() => setCarMode(true)}>
                <SteeringWheel size={16} className="mr-2" />
                车载模式
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </li>
      </ul>
    </nav>
  )
}
