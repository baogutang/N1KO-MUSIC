/**
 * 报头 masthead
 * 左：N1KO MUSIC 品牌（sans 700 + wide tracking）+ 服务器连接状态
 *    （下拉承载原侧边栏的服务器切换 / 添加 / 断开功能）
 * 右：刊号 + 当日日期
 *
 * 纸·墨·朱（DESIGN v2 §3）：下缘 3px double 发丝线，状态是一个小圆点。
 * 糖果·波普（DESIGN v3 §3）：下缘 2px 实线；状态点变成薄荷绿胶囊，刊号变成葡萄紫贴纸。
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
      className="flex-shrink-0 border-b-[3px] border-double border-hair select-none pop:border-b-2 pop:border-solid"
      data-tauri-drag-region
    >
      <div
        className="max-w-[1180px] mx-auto px-10 pt-2 pb-3 flex items-baseline justify-between gap-4"
        data-tauri-drag-region
      >
        {/* 品牌 + 服务器状态下拉 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="group flex items-baseline gap-3 text-left pop:items-center" aria-label={t('settings.server.menu')}>
              <span className="font-sans font-bold text-[15px] tracking-[0.3em] text-foreground pop:font-extrabold pop:tracking-[0.22em] pop:text-[17px]">
                N1KO MUSIC
              </span>
              <span className="press-pop flex items-center gap-1.5 text-[11px] tracking-[0.18em] text-ink-soft group-hover:text-foreground transition-colors duration-200 pop:rounded-pill pop:border pop:border-hair pop:bg-candy-ok-soft pop:px-3 pop:py-1.5 pop:text-[12px] pop:tracking-normal pop:font-semibold pop:text-foreground pop:shadow-press">
                {/* 「已连接」在波普里绑定薄荷绿（DESIGN v3 §1.3），不再借用主色 */}
                <span
                  className={cn(
                    'w-1.5 h-1.5 rounded-full flex-shrink-0 pop:w-2.5 pop:h-2.5 pop:border pop:border-hair',
                    activeServer
                      ? 'bg-primary pop:bg-candy-ok-fill'
                      : 'bg-ink-faint pop:bg-candy-danger-fill'
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
                onClick={async () => {
                  if (!(await activateServer(server.id))) {
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
        <p className="num flex flex-shrink-0 items-baseline gap-3 text-[12px] tracking-[0.14em] text-ink-soft pop:items-center">
          <span className="text-primary pop:rounded-sm pop:border pop:border-hair pop:bg-primary pop:px-2.5 pop:py-1 pop:text-primary-foreground pop:shadow-press pop:-rotate-2">
            {issue.label}
          </span>
          <span className="hidden sm:inline">{dateLabel} {weekLabel}</span>
        </p>
      </div>
    </div>
  )
}
