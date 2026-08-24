/**
 * 移动端顶栏：紧凑版（品牌 + 搜索 / 主题 / 用户菜单）
 * 顶部安全区留白；用户菜单与桌面 TopBar 保持一致（设置 / 最近播放 / 断开连接）
 */

import { useNavigate } from 'react-router-dom'
import {
  Sun, Moon, MagnifyingGlass, User,
  ClockCounterClockwise, GearSix, SignOut,
} from '@phosphor-icons/react'
import { useThemeStore } from '@/store/themeStore'
import { useServerStore } from '@/store/serverStore'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { prefetchRoute } from '@/routes/lazyRoutes'
import { useT } from '@/i18n'

const iconBtn =
  'w-9 h-9 rounded-full flex items-center justify-center text-ink-soft ' +
  'active:text-primary transition-colors duration-200 active:scale-95'

export function MobileHeader() {
  const { t } = useT()
  const navigate = useNavigate()
  const { resolvedTheme, toggleTheme } = useThemeStore()
  const { username, disconnect } = useServerStore()
  const themeLabel = resolvedTheme === 'dark' ? t('settings.theme.toLight') : t('settings.theme.toDark')

  return (
    <header
      className="flex-shrink-0 select-none border-b border-hair bg-paper"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      }}
    >
      <div className="h-12 px-4 flex items-center gap-1">
        <button
          onClick={() => navigate('/')}
          className="font-serif font-bold text-[17px] tracking-[0.02em] text-foreground mr-auto"
          aria-label={t('action.backHome')}
        >
          N1KO<span className="text-primary">·</span>MUSIC
        </button>

        <button
          onClick={() => navigate('/search')}
          onTouchStart={() => prefetchRoute('/search')}
          className={iconBtn}
          aria-label={t('nav.search')}
        >
          <MagnifyingGlass size={19} />
        </button>

        <button
          onClick={toggleTheme}
          className={iconBtn}
          aria-label={themeLabel}
        >
          {resolvedTheme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className={iconBtn} aria-label={t('nav.userMenu')}>
              <User size={19} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {username && (
              <>
                <div className="px-2 py-1.5">
                  <p className="text-sm font-medium">{username}</p>
                </div>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem
              onTouchStart={() => prefetchRoute('/settings')}
              onClick={() => navigate('/settings')}
            >
              <GearSix size={16} className="mr-2" />
              {t('nav.settings')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onTouchStart={() => prefetchRoute('/history')}
              onClick={() => navigate('/history')}
            >
              <ClockCounterClockwise size={16} className="mr-2" />
              {t('nav.history')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onClick={disconnect}>
              <SignOut size={16} className="mr-2" />
              {t('settings.disconnect.action')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
