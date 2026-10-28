/**
 * 服务器菜单：切主库 / 添加服务器 / 断开连接。
 *
 * 原来挂在报头（Masthead）的品牌字标上；外壳没有报头了，它住进侧栏底部，
 * 侧边导航条与窄窗口则由工具栏的「更多」菜单承担同样的入口。
 * 菜单内容与确认流程原样保留（复核 F6：插件行与当前主库不提供「设为主库」，切换先确认）。
 */

import { useNavigate } from 'react-router-dom'
import { CaretUpDown, HardDrives, MusicNote, Plus, SignOut } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { useDestructiveConfirm } from '@/components/layout/useDestructiveConfirm'
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
import { useT } from '@/i18n'

export function ServerMenu({ className }: { className?: string }) {
  const { t } = useT()
  const navigate = useNavigate()
  const { servers, activeServerId, disconnect, activateServer } = useServerStore()
  const confirm = useDestructiveConfirm()
  const activeServer = servers.find(s => s.id === activeServerId)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className={cn(
              'press-pop group flex w-full min-w-0 items-center gap-3 rounded-[12px] px-2.5 py-2 text-left hover:bg-ink/[0.05]',
              className
            )}
            aria-label={t('settings.server.menu')}
          >
            <span className="grid h-9 w-9 flex-none place-items-center rounded-[10px] bg-surface text-ink-2">
              <HardDrives size={18} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="truncate text-[14px] font-semibold text-ink">
                {activeServer ? activeServer.name : t('settings.server.notConnected')}
              </span>
              {activeServer && (
                <span className="mt-0.5 truncate text-[12px] text-ink-3">
                  {getServerTypeLabel(activeServer.type)}
                </span>
              )}
            </span>
            <CaretUpDown size={14} className="flex-none text-ink-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-64" align="start" side="top">
          {/* 可切的主库候选（复核 F6）：插件行不提供「设为主库」；当前主库自己也不出现 */}
          {servers
            .filter(server => server.type !== 'plugin' && server.id !== activeServerId)
            .map(server => (
              <DropdownMenuItem
                key={server.id}
                onClick={() => {
                  /* 切主库是破坏性动作（清队列/缓存）：与设置页一样先确认（1.7） */
                  confirm.request({
                    title: t('settings.primaryDialog.title'),
                    description: t('settings.primaryDialog.desc', { name: server.name }),
                    confirmLabel: t('settings.primaryDialog.confirm'),
                    onConfirm: () => {
                      void (async () => {
                        if (!(await activateServer(server.id))) {
                          toast({
                            title: t('sources.relogin'),
                            description: t('settings.server.reloginDesc'),
                            variant: 'destructive',
                          })
                        }
                      })()
                    },
                  })
                }}
              >
                <MusicNote size={16} className="text-ink-3" />
                <span className="min-w-0 truncate">{server.name}</span>
                <span className="ml-auto flex-none text-[12px] text-ink-3">
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
            <Plus size={16} className="text-ink-3" />
            {t('settings.server.add')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-danger focus:text-danger"
            onClick={() => {
              /* 断开同样先确认（1.7）：点一下不该直接清空曲库入口 */
              confirm.request({
                title: t('settings.disconnect.confirm'),
                description: t('masthead.disconnectDesc'),
                onConfirm: disconnect,
              })
            }}
          >
            <SignOut size={16} />
            {t('settings.disconnect.action')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {/* 破坏性动作确认（1.7）：切主库 / 断开连接 */}
      {confirm.dialog}
    </>
  )
}
