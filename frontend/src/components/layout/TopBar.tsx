/**
 * 顶部导航栏
 * 包含前进/后退、搜索入口、主题切换、用户信息
 */

import { useNavigate } from 'react-router-dom'
import { CaretLeft, CaretRight, Sun, Moon, MagnifyingGlass, User } from '@phosphor-icons/react'
import { useThemeStore } from '@/store/themeStore'
import { useServerStore } from '@/store/serverStore'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { prefetchRoute } from '@/routes/lazyRoutes'

interface TopBarProps {
  title?: string
  className?: string
}

export function TopBar({ title, className }: TopBarProps) {
  const navigate = useNavigate()
  const { resolvedTheme, toggleTheme } = useThemeStore()
  const { username, disconnect } = useServerStore()

  return (
    <header className={cn(
      'h-[60px] flex items-center gap-3 px-6 border-b border-border flex-shrink-0',
      className
    )}>
      {/* 导航按钮 */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => navigate(-1)}
          className="rounded-md active:scale-[0.94]"
        >
          <CaretLeft size={18} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => navigate(1)}
          className="rounded-md active:scale-[0.94]"
        >
          <CaretRight size={18} />
        </Button>
      </div>

      {/* 页面标题 */}
      {title && (
        <h1 className="text-lg font-bold tracking-tight text-foreground truncate flex-1">
          {title}
        </h1>
      )}

      <div className="flex-1" />

      {/* 搜索 */}
      <button
        onClick={() => navigate('/search')}
        onMouseEnter={() => prefetchRoute('/search')}
        onFocus={() => prefetchRoute('/search')}
        className="flex items-center gap-2 h-[34px] px-3 rounded-md bg-surface border border-border text-muted-foreground text-[13px] hover:text-foreground transition-colors duration-150 active:scale-[0.97]"
        aria-label="搜索"
      >
        <MagnifyingGlass size={15} />
        <span className="hidden md:inline">搜索</span>
        <kbd className="hidden md:inline-flex items-center ml-1 px-1.5 py-0.5 rounded-md text-[10.5px] font-num border border-border text-muted-foreground">
          ⌘K
        </kbd>
      </button>

      {/* 主题切换 */}
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={toggleTheme}
        className="rounded-md active:scale-[0.94]"
        title={resolvedTheme === 'dark' ? '切换浅色模式' : '切换深色模式'}
      >
        {resolvedTheme === 'dark' ? (
          <Sun size={18} />
        ) : (
          <Moon size={18} />
        )}
      </Button>

      {/* 用户菜单 */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="w-[30px] h-[30px] rounded-full bg-accent border border-border flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors duration-150 active:scale-[0.94]">
            <User size={15} />
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
            设置
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive" onClick={disconnect}>
            断开连接
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  )
}
