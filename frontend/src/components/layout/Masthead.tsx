/**
 * 报头 masthead（杂志编辑风，DESIGN v2 §3，demo .masthead）
 * 左：N1KO MUSIC 品牌（sans 700 + wide tracking）+ 服务器连接状态点
 *    （下拉承载原侧边栏的服务器切换 / 添加 / 断开功能）
 * 右：当日日期；下缘 3px double 发丝线
 */

import { useNavigate } from 'react-router-dom'
import { CaretDown, MusicNote, Plus, SignOut } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { useServerStore, getServerTypeLabel } from '@/store/serverStore'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { prefetchRoute } from '@/routes/lazyRoutes'
import { toast } from '@/components/ui/use-toast'

export function Masthead() {
  const navigate = useNavigate()
  const { servers, activeServerId, disconnect, activateServer } = useServerStore()
  const activeServer = servers.find(s => s.id === activeServerId)

  const now = new Date()
  const dateLabel = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(now)
  const weekLabel = new Intl.DateTimeFormat('zh-CN', { weekday: 'long' }).format(now)

  return (
    <div className="flex-shrink-0 border-b-[3px] border-double border-hair">
      <div className="max-w-[1180px] mx-auto px-10 pt-2 pb-3 flex items-baseline justify-between gap-4">
        {/* 品牌 + 服务器状态下拉 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="group flex items-baseline gap-3 text-left" aria-label="服务器菜单">
              <span className="font-sans font-bold text-[15px] tracking-[0.3em] text-foreground">
                N1KO MUSIC
              </span>
              <span className="flex items-center gap-1.5 text-[11px] tracking-[0.18em] text-ink-soft group-hover:text-foreground transition-colors duration-200">
                <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" aria-hidden="true" />
                <span className="max-w-[180px] truncate">
                  {activeServer ? activeServer.name : '未连接'}
                </span>
                <CaretDown size={10} className="text-ink-faint flex-shrink-0" />
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56" align="start">
            {servers.map(server => (
              <DropdownMenuItem
                key={server.id}
                onClick={() => {
                  if (!activateServer(server.id)) {
                    toast({
                      title: '该服务器需要重新登录',
                      description: '登录凭据已升级，请在登录页重新连接',
                      variant: 'destructive',
                    })
                  }
                }}
                className={cn(activeServerId === server.id && 'text-primary')}
              >
                <MusicNote size={16} className="mr-2" />
                {server.name}
                <span className="ml-auto text-xs text-muted-foreground">
                  {getServerTypeLabel(server.type)}
                </span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onMouseEnter={() => prefetchRoute('/settings')}
              onFocus={() => prefetchRoute('/settings')}
              onClick={() => navigate('/settings')}
            >
              <Plus size={16} className="mr-2" />
              添加服务器
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onClick={disconnect}>
              <SignOut size={16} className="mr-2" />
              断开连接
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* 日期（数字等宽 tabular） */}
        <p className="num text-[12px] tracking-[0.14em] text-ink-soft flex-shrink-0">
          {dateLabel} {weekLabel}
        </p>
      </div>
    </div>
  )
}
