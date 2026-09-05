/**
 * 顶部工具条（杂志编辑风，DESIGN v2 §3，demo .utility）
 * 左：返回 / 前进；右：搜索入口（⌘K）、主题切换、用户菜单
 * macOS 隐藏标题栏（titleBarStyle Overlay）下整条兼作窗口拖拽区，
 * 左侧留出红绿灯位置；交互子元素不是拖拽目标，点击不受影响
 */

import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CaretLeft, CaretRight, Sun, Moon, MagnifyingGlass, User,
  ClockCounterClockwise, GearSix, SignOut, Palette,
} from '@phosphor-icons/react'
import { useThemeStore, SKINS, SKIN_LABEL_KEYS } from '@/store/themeStore'
import { useServerStore } from '@/store/serverStore'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { prefetchRoute } from '@/routes/lazyRoutes'
import { useT } from '@/i18n'

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)

/**
 * 拖拽区标记。
 *
 * Tauri 注入的 drag.js 在 document 上监听 mousedown，只认 `e.target` **自身**
 * 的 `data-tauri-drag-region` 属性（不看祖先），所以每一块希望能拖的空白
 * 都要自己带上；按钮、链接这些子元素没有该属性，点击不受影响。
 *
 * 这里曾经还挂着 `-webkit-app-region: drag` 的内联样式，注释写的是
 * 「旧习惯保留，WKWebView 会忽略」——那是个未经验证的假设。它是 Electron
 * 的属性，在 Tauri 里没有任何用途，而 WebKit 对它的处理并不保证是「忽略」：
 * 一旦被当作系统拖拽区，鼠标事件就不再派发到该元素，drag.js 的
 * mousedown 永远不会触发，窗口于是拖不动。既然它不产生任何收益，
 * 就不该留在恰好是「拖不动」的那几个元素上。
 */
const dragRegionProps = {
  'data-tauri-drag-region': true,
}

/**
 * 图标键。
 * 编辑风：纯图标，hover 变 accent（DESIGN v2 §4.1）。
 * 波普：  描边圆钮，按下去会压实（DESIGN v3 §4.1）。
 */
const iconBtn =
  'press-pop w-7 h-7 rounded-full flex items-center justify-center text-ink-soft ' +
  'hover:text-primary transition-colors duration-200 active:scale-95 ' +
  'pop:border pop:border-hair pop:bg-surface pop:text-foreground pop:shadow-press ' +
  'pop:hover:text-foreground pop:hover:bg-secondary'

/**
 * 顶栏的中间插槽。
 *
 * 软陶皮把报头（Masthead）塞进这里，让「返回/前进 + 品牌 + 服务器 + 工具组」
 * 读成一条栏杆，而不是上下两行（DESIGN v4 C4）。另外两张皮不传 children，
 * 这里渲染出来的还是原来那块什么都没有的 flex-1 占位（同时是窗口拖拽区），
 * 一个像素都不动。
 *
 * 三个 topbar-* 类名在 pop / editorial 下没有任何声明，纯粹是给 clay 的
 * CSS 一个抓手——版面骨架的差别不该逼组件去认皮肤。
 */
export function TopBar({ children }: { children?: ReactNode }) {
  const { t } = useT()
  const navigate = useNavigate()
  const { resolvedTheme, toggleTheme, skin, toggleSkin } = useThemeStore()
  const { username, disconnect } = useServerStore()
  const themeLabel = resolvedTheme === 'dark' ? t('settings.theme.toLight') : t('settings.theme.toDark')
  // 皮肤切换放在工具条而不是只留在设置页：它是一次「换个心情」的动作，
  // 不是一次配置——埋三层里就等于没有。
  //
  // 三张皮之后这颗键是循环而不是开关，所以标签必须说出**下一张**是谁，
  // 否则用户按下去之前不知道会得到什么。
  const nextSkin = SKINS[(SKINS.indexOf(skin) + 1) % SKINS.length]
  const skinLabel = t('settings.skin.switchTo', { name: t(SKIN_LABEL_KEYS[nextSkin].name) })

  return (
    <header className="top-bar h-11 flex-shrink-0 select-none" {...dragRegionProps}>
      <div
        className={cn(
          'h-full max-w-[1180px] mx-auto px-10 flex items-center gap-1',
          isMac && 'pl-[78px]' // 红绿灯留白
        )}
        {...dragRegionProps}
      >
        {/* 返回 / 前进 */}
        <div className="topbar-nav flex items-center gap-1">
          <button onClick={() => navigate(-1)} className={iconBtn} aria-label={t('action.back')}>
            <CaretLeft size={17} />
          </button>
          <button onClick={() => navigate(1)} className={iconBtn} aria-label={t('action.forward')}>
            <CaretRight size={17} />
          </button>
        </div>

        <div className="topbar-slot flex-1 flex items-center min-w-0" {...dragRegionProps}>
          {children}
        </div>

        <div className="topbar-tools flex items-center gap-1">
          {/* 搜索入口：细线小钮（DESIGN §4.1 次操作），⌘K 快捷键见 useKeyboardShortcuts */}
          <button
            onClick={() => navigate('/search')}
            onMouseEnter={() => prefetchRoute('/search')}
            onFocus={() => prefetchRoute('/search')}
            className="press-pop flex items-center gap-2 h-7 px-3 mr-1 rounded-sm border border-hair text-[12px] tracking-[0.08em] text-ink-soft hover:text-foreground hover:border-ink-faint transition-colors duration-200 active:scale-[0.97] pop:rounded-pill pop:px-4 pop:bg-surface pop:text-foreground pop:shadow-press pop:hover:border-hair pop:hover:bg-secondary"
            aria-label={t('nav.search')}
          >
            <MagnifyingGlass size={14} />
            <span className="hidden md:inline">{t('nav.search')}</span>
            <kbd className="hidden md:inline font-num text-[10px] text-ink-faint">⌘K</kbd>
          </button>

          {/* 皮肤切换：糖果·波普 → 纸·墨·朱 → 奶油·软陶 → 循环 */}
          <button
            onClick={toggleSkin}
            className={iconBtn}
            title={skinLabel}
            aria-label={skinLabel}
          >
            <Palette size={17} />
          </button>

          {/* 明暗切换 */}
          <button
            onClick={toggleTheme}
            className={iconBtn}
            title={themeLabel}
            aria-label={themeLabel}
          >
            {resolvedTheme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
          </button>

          {/* 用户菜单 */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="press-pop w-7 h-7 ml-1 rounded-full border border-hair flex items-center justify-center text-ink-soft hover:text-foreground hover:border-ink-faint transition-colors duration-200 active:scale-95 pop:bg-surface pop:text-foreground pop:shadow-press pop:hover:border-hair pop:hover:bg-secondary"
                aria-label={t('nav.userMenu')}
              >
                <User size={14} />
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
                onMouseEnter={() => prefetchRoute('/settings')}
                onFocus={() => prefetchRoute('/settings')}
                onClick={() => navigate('/settings')}
              >
                <GearSix size={16} className="mr-2" />
                {t('nav.settings')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onMouseEnter={() => prefetchRoute('/history')}
                onFocus={() => prefetchRoute('/history')}
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
      </div>
    </header>
  )
}
