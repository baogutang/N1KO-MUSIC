/**
 * 顶部工具条（杂志编辑风，DESIGN v2 §3，demo .utility）
 * 左：返回 / 前进；右：搜索入口（⌘K）、主题切换、用户菜单
 * macOS 隐藏标题栏（titleBarStyle Overlay）下整条兼作窗口拖拽区，
 * 左侧留出红绿灯位置；交互子元素不是拖拽目标，点击不受影响
 */

import { useNavigate } from 'react-router-dom'
import {
  CaretLeft, CaretRight, Sun, Moon, MagnifyingGlass, User,
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
import { cn } from '@/lib/utils'
import { prefetchRoute } from '@/routes/lazyRoutes'

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)

/**
 * 拖拽区标记：始终渲染（不再按 isMac 门控）。
 * drag.js 只认 e.target 自身属性；按钮/链接等子元素无属性，点击不受影响。
 * WebkitAppRegion 仅为旧习惯保留，WKWebView 会忽略，无害。
 */
const dragRegionProps = {
  'data-tauri-drag-region': true,
  style: { WebkitAppRegion: 'drag' } as React.CSSProperties,
}

/** 图标键：纯图标，hover 变 accent（DESIGN §4.1） */
const iconBtn =
  'w-7 h-7 rounded-full flex items-center justify-center text-ink-soft ' +
  'hover:text-primary transition-colors duration-200 active:scale-95'

export function TopBar() {
  const navigate = useNavigate()
  const { resolvedTheme, toggleTheme } = useThemeStore()
  const { username, disconnect } = useServerStore()

  return (
    <header className="h-11 flex-shrink-0 select-none" {...dragRegionProps}>
      <div
        className={cn(
          'h-full max-w-[1180px] mx-auto px-10 flex items-center gap-1',
          isMac && 'pl-[78px]' // 红绿灯留白
        )}
        {...dragRegionProps}
      >
        {/* 返回 / 前进 */}
        <button onClick={() => navigate(-1)} className={iconBtn} aria-label="返回">
          <CaretLeft size={17} />
        </button>
        <button onClick={() => navigate(1)} className={iconBtn} aria-label="前进">
          <CaretRight size={17} />
        </button>

        <div className="flex-1" {...dragRegionProps} />

        {/* 搜索入口：细线小钮（DESIGN §4.1 次操作），⌘K 快捷键见 useKeyboardShortcuts */}
        <button
          onClick={() => navigate('/search')}
          onMouseEnter={() => prefetchRoute('/search')}
          onFocus={() => prefetchRoute('/search')}
          className="flex items-center gap-2 h-7 px-3 mr-1 rounded-sm border border-hair text-[12px] tracking-[0.08em] text-ink-soft hover:text-foreground hover:border-ink-faint transition-colors duration-200 active:scale-[0.97]"
          aria-label="搜索"
        >
          <MagnifyingGlass size={14} />
          <span className="hidden md:inline">搜索</span>
          <kbd className="hidden md:inline font-num text-[10px] text-ink-faint">⌘K</kbd>
        </button>

        {/* 主题切换 */}
        <button
          onClick={toggleTheme}
          className={iconBtn}
          title={resolvedTheme === 'dark' ? '切换浅色模式' : '切换深色模式'}
          aria-label={resolvedTheme === 'dark' ? '切换浅色模式' : '切换深色模式'}
        >
          {resolvedTheme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
        </button>

        {/* 用户菜单 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="w-7 h-7 ml-1 rounded-full border border-hair flex items-center justify-center text-ink-soft hover:text-foreground hover:border-ink-faint transition-colors duration-200 active:scale-95"
              aria-label="用户菜单"
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
              设置
            </DropdownMenuItem>
            <DropdownMenuItem
              onMouseEnter={() => prefetchRoute('/history')}
              onFocus={() => prefetchRoute('/history')}
              onClick={() => navigate('/history')}
            >
              <ClockCounterClockwise size={16} className="mr-2" />
              最近播放
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onClick={disconnect}>
              <SignOut size={16} className="mr-2" />
              断开连接
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
