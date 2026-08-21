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
import { LibraryScopeMenu } from './LibraryScopeMenu'
import { issueNumber } from '@/services/issueNumber'
import { useT } from '@/i18n'

export function Masthead() {
  const { t, locale } = useT()
  const navigate = useNavigate()
  const { servers, activeServerId, disconnect, activateServer } = useServerStore()
  const activeServer = servers.find(s => s.id === activeServerId)

  const now = new Date()
  // 日期跟着界面语言走：中文界面写「2026年8月21日 星期五」，英文界面写 "21 August 2026"
  const dateLabel = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(now)
  const weekLabel = new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(now)
  // 刊号按 ISO 周推算，同一天在任何一台设备上都是同一期
  const issue = issueNumber(now.getTime())

  return (
    <div
      className="flex-shrink-0 border-b-[3px] border-double border-hair select-none"
      data-tauri-drag-region
    >
      <div
        className="max-w-[1180px] mx-auto px-10 pt-2 pb-3 flex items-baseline justify-between gap-4"
        data-tauri-drag-region
      >
        {/* 品牌 + 服务器状态下拉 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="group flex items-baseline gap-3 text-left" aria-label={t('settings.server.menu')}>
              <span className="font-sans font-bold text-[15px] tracking-[0.3em] text-foreground">
                N1KO MUSIC
              </span>
              <span className="flex items-center gap-1.5 text-[11px] tracking-[0.18em] text-ink-soft group-hover:text-foreground transition-colors duration-200">
                <span
                  className={cn(
                    'w-1.5 h-1.5 rounded-full flex-shrink-0',
                    activeServer ? 'bg-primary' : 'bg-ink-faint'
                  )}
                  aria-hidden="true"
                />
                <span className="max-w-[180px] truncate">
                  {activeServer ? activeServer.name : t('settings.server.notConnected')}
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
                      title: t('settings.server.reloginTitle'),
                      description: t('settings.server.reloginDesc'),
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
              {t('settings.server.add')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onClick={disconnect}>
              <SignOut size={16} className="mr-2" />
              {t('settings.disconnect.action')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* 音乐库切换：服务器暴露多于一个库时才出现 */}
        <LibraryScopeMenu className="hidden sm:inline-flex" />

        {/* 刊号 + 日期（数字等宽 tabular）。刊号在前：它是这本刊物的编号，
            日期只是这一期的落款。 */}
        <p className="num flex flex-shrink-0 items-baseline gap-3 text-[12px] tracking-[0.14em] text-ink-soft">
          <span className="text-primary">{issue.label}</span>
          <span className="hidden sm:inline">{dateLabel} {weekLabel}</span>
        </p>
      </div>
    </div>
  )
}
