/**
 * 顶部导航栏
 * 包含前进/后退、搜索入口、主题切换、用户信息
 */

import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Sun, Moon, Search, User } from 'lucide-react'
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
      'h-14 flex items-center gap-3 px-6 border-b border-border/50 bg-background/80 backdrop-blur-md flex-shrink-0',
      className
    )}>
      {/* 导航按钮 */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => navigate(-1)}
          className="rounded-full"
        >
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => navigate(1)}
          className="rounded-full"
        >
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>

      {/* 页面标题 */}
      {title && (
        <h1 className="text-lg font-semibold text-foreground truncate flex-1">
          {title}
        </h1>
      )}

      <div className="flex-1" />

      {/* 搜索快捷键提示 */}
      <button
        onClick={() => navigate('/search')}
        className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-secondary text-muted-foreground text-sm hover:bg-accent hover:text-foreground transition-colors"
      >
        <Search className="w-3.5 h-3.5" />
        <span>搜索</span>
        <kbd className="ml-1 px-1.5 py-0.5 rounded text-xs bg-background border border-border font-mono">
          ⌘K
        </kbd>
      </button>

      {/* 主题切换 */}
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={toggleTheme}
        className="rounded-full"
        title={resolvedTheme === 'dark' ? '切换浅色模式' : '切换深色模式'}
      >
        {resolvedTheme === 'dark' ? (
          <Sun className="w-4 h-4" />
        ) : (
          <Moon className="w-4 h-4" />
        )}
      </Button>

      {/* 用户菜单 */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center hover:bg-primary/30 transition-colors">
            <User className="w-4 h-4 text-primary" />
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
          <DropdownMenuItem onClick={() => navigate('/settings')}>
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
