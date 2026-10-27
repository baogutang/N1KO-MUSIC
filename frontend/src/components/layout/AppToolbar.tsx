/**
 * 内容区顶上的工具栏，吸顶在滚动容器里。
 *
 * 左：侧栏收起时的展开键、后退 / 前进
 * 中：栏目名——页面自己的大标题滚出视野后才浮现（iOS 的大标题收拢）
 * 右：宽窗口是搜索胶囊 + 面板开关；中、窄窗口是「更多」菜单，
 *     收着导航放不下的入口、车载模式、明暗与断开连接（原底部「更多」+ 用户菜单）
 *
 * 内容滚到底下时铺上半透明纸色与模糊（滚动边缘效果）；三条提示横幅挂在它下面一起吸顶。
 * 空白处是 Tauri 的窗口拖拽区；macOS 桌面壳下侧栏收起时让出红黄绿三个键的位置。
 */

import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  CaretLeft, CaretRight, DotsThreeCircle, GearSix, MagnifyingGlass, Moon,
  SidebarSimple, SignOut, SquareHalf, SteeringWheel, Sun,
} from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { needsTrafficLightInset } from '@/lib/platform'
import { useThemeStore } from '@/store/themeStore'
import { useServerStore } from '@/store/serverStore'
import { usePlayerStore } from '@/store/playerStore'
import { useDestructiveConfirm } from '@/components/layout/useDestructiveConfirm'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { prefetchRoute } from '@/routes/lazyRoutes'
import { useT } from '@/i18n'
import { MORE_NAV } from './navItems'
import { sectionKeyFor } from './sections'
import { useShellLayout } from './useShellLayout'

const toolBtn =
  'grid h-9 w-9 flex-none place-items-center rounded-pill text-ink-soft transition-colors duration-150 ' +
  'hover:bg-paper-deep hover:text-ink active:scale-95 disabled:opacity-40 disabled:hover:bg-transparent'

/** react-router v7 在 history.state.idx 里记着当前条目的序号：0 就是第一页，没得退 */
function historyIndex(): number {
  const idx = (window.history.state as { idx?: number } | null)?.idx
  return typeof idx === 'number' ? idx : 0
}

function MoreMenu() {
  const { t } = useT()
  const navigate = useNavigate()
  const resolvedTheme = useThemeStore(s => s.resolvedTheme)
  const toggleTheme = useThemeStore(s => s.toggleTheme)
  const setCarMode = usePlayerStore(s => s.setCarMode)
  const { username, disconnect } = useServerStore()
  const confirm = useDestructiveConfirm()
  const themeLabel = resolvedTheme === 'dark' ? t('settings.theme.toLight') : t('settings.theme.toDark')

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className={toolBtn} aria-label={t('nav.more')}>
            <DotsThreeCircle size={22} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {username && (
            <>
              <div className="px-2 py-1.5">
                <p className="truncate text-sm font-semibold">{username}</p>
              </div>
              <DropdownMenuSeparator />
            </>
          )}
          {MORE_NAV.map(({ to, labelKey, icon: Icon }) => (
            <DropdownMenuItem
              key={to}
              onMouseEnter={() => prefetchRoute(to)}
              onTouchStart={() => prefetchRoute(to)}
              onClick={() => navigate(to)}
            >
              <Icon size={16} className="mr-2" />
              {t(labelKey)}
            </DropdownMenuItem>
          ))}
          {/* 车载模式放在这里而不是只藏在全屏播放器的「更多」里：真要开车的人不会为了进它连点四层 */}
          <DropdownMenuItem onClick={() => setCarMode(true)}>
            <SteeringWheel size={16} className="mr-2" />
            {t('player.carMode')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={toggleTheme}>
            {resolvedTheme === 'dark' ? <Sun size={16} className="mr-2" /> : <Moon size={16} className="mr-2" />}
            {themeLabel}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => navigate('/settings')}>
            <GearSix size={16} className="mr-2" />
            {t('nav.settings')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive"
            onClick={() => confirm.request({
              title: t('settings.disconnect.confirm'),
              description: t('masthead.disconnectDesc'),
              onConfirm: disconnect,
            })}
          >
            <SignOut size={16} className="mr-2" />
            {t('settings.disconnect.action')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {confirm.dialog}
    </>
  )
}

export function AppToolbar({ scrolled, titled, children }: { scrolled: boolean; titled: boolean; children?: ReactNode }) {
  const { t } = useT()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { wc, sidebarVisible, panelVisible } = useShellLayout()
  const toggleSidebar = useThemeStore(s => s.toggleSidebar)
  const setNowPlayingPanel = useThemeStore(s => s.setNowPlayingPanel)
  const sectionKey = sectionKeyFor(pathname)
  const canGoBack = historyIndex() > 0
  const wide = wc === 'wide'
  const leftInset = needsTrafficLightInset && (wc === 'compact' || (wide && !sidebarVisible))

  return (
    <div className="sticky top-0 z-30" data-scrolled={scrolled || undefined}>
      <div
        className={cn('scroll-edge flex items-center gap-1 px-3 regular:px-5', leftInset && 'pl-[84px]')}
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 8px)', paddingBottom: 8 }}
        data-tauri-drag-region
      >
        <div className="flex min-w-[96px] items-center gap-0.5" data-tauri-drag-region>
          {wide && !sidebarVisible && (
            <button
              onClick={toggleSidebar}
              className={toolBtn}
              aria-label={t('shell.showSidebar')}
              title={`${t('shell.showSidebar')}  ⌃⌘S`}
            >
              <SidebarSimple size={19} />
            </button>
          )}
          {(wc !== 'compact' || canGoBack) && (
            <button onClick={() => navigate(-1)} className={toolBtn} aria-label={t('action.back')} disabled={!canGoBack}>
              <CaretLeft size={18} />
            </button>
          )}
          {wc !== 'compact' && (
            <button onClick={() => navigate(1)} className={toolBtn} aria-label={t('action.forward')}>
              <CaretRight size={18} />
            </button>
          )}
        </div>

        <p
          className={cn(
            'min-w-0 flex-1 truncate text-center text-[15px] font-semibold text-ink transition-opacity duration-200',
            titled ? 'opacity-100' : 'opacity-0'
          )}
          aria-hidden={!titled}
          data-tauri-drag-region
        >
          {sectionKey ? t(sectionKey) : ''}
        </p>

        <div className="flex min-w-[96px] items-center justify-end gap-1" data-tauri-drag-region>
          {wide && !pathname.startsWith('/search') && (
            <button
              onClick={() => navigate('/search')}
              onMouseEnter={() => prefetchRoute('/search')}
              className="flex h-9 w-[220px] items-center gap-2 rounded-pill bg-paper-deep px-3.5 text-[13.5px] text-ink-faint transition-colors hover:bg-paper-3"
              aria-label={t('nav.search')}
            >
              <MagnifyingGlass size={15} />
              <span className="flex-1 text-left">{t('nav.search')}</span>
              <kbd className="num font-sans text-[12px] text-ink-faint">⌘K</kbd>
            </button>
          )}
          {wide ? (
            <button
              onClick={() => setNowPlayingPanel(!panelVisible)}
              className={cn(toolBtn, panelVisible && 'text-primary')}
              aria-label={t(panelVisible ? 'shell.hidePanel' : 'shell.showPanel')}
              aria-pressed={panelVisible}
              title={`${t(panelVisible ? 'shell.hidePanel' : 'shell.showPanel')}  ⌥⌘P`}
            >
              <SquareHalf size={20} />
            </button>
          ) : (
            <MoreMenu />
          )}
        </div>
      </div>
      {children}
    </div>
  )
}
