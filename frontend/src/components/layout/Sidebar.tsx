/**
 * 侧边栏导航组件
 * 包含服务器信息、主导航、歌单快捷入口
 */

import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  House, MagnifyingGlass, VinylRecord, Heart, ClockCounterClockwise,
  ChartBar, GearSix, CaretRight, SignOut, Plus, MusicNote, Sparkle,
  CrownSimple, Waveform,
} from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { useServerStore, getServerTypeLabel } from '@/store/serverStore'
import { usePlaylists } from '@/hooks/useServerQueries'
import { useMemberStore } from '@/store/memberStore'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { prefetchRoute } from '@/routes/lazyRoutes'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MemberUpgradeDialog } from '@/components/member/MemberUpgradeDialog'
import { toast } from '@/components/ui/use-toast'

const mainNavItems = [
  { to: '/', icon: House, label: '首页', premium: false },
  { to: '/search', icon: MagnifyingGlass, label: '搜索', premium: false },
  { to: '/library', icon: VinylRecord, label: '音乐库', premium: false },
  { to: '/recommendations', icon: Sparkle, label: '为你推荐', premium: true },
]

const collectionNavItems = [
  { to: '/favorites', icon: Heart, label: '我的收藏', premium: true },
  { to: '/history', icon: ClockCounterClockwise, label: '最近播放', premium: false },
  { to: '/stats', icon: ChartBar, label: '听歌统计', premium: true },
]

export function Sidebar() {
  const { servers, activeServerId, disconnect, activateServer } = useServerStore()
  const navigate = useNavigate()
  const { data: playlists } = usePlaylists()
  const activeServer = servers.find(s => s.id === activeServerId)
  const isPremium = useMemberStore(s => s.isPremium)
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [upgradeName, setUpgradeName] = useState<string | undefined>()
  const bindPrefetch = (to: string) => ({
    onMouseEnter: () => prefetchRoute(to),
    onFocus: () => prefetchRoute(to),
    onTouchStart: () => prefetchRoute(to),
  })

  return (
    <aside className="flex flex-col h-full w-60 bg-background border-r border-border flex-shrink-0">
      {/* 会员升级弹窗 */}
      <MemberUpgradeDialog
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        featureName={upgradeName}
      />
      {/* 品牌区 + 服务器切换 */}
      <div className="px-3 pt-4 pb-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2.5 w-full px-2 py-1.5 rounded-md hover:bg-surface transition-colors duration-150 group text-left active:scale-[0.97]">
              {/* 品牌方标 */}
              <div className="w-[34px] h-[34px] rounded-[10px] flex items-center justify-center flex-shrink-0 text-primary-foreground [background:linear-gradient(145deg,hsl(var(--primary)),color-mix(in_srgb,hsl(var(--primary))_60%,black))]">
                <Waveform size={17} weight="fill" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold tracking-[0.06em] text-foreground truncate">
                  N1KO MUSIC
                </p>
                <p className="flex items-center gap-[5px] text-[11px] text-muted-foreground truncate">
                  <span className="w-[5px] h-[5px] rounded-full bg-primary flex-shrink-0" aria-hidden="true" />
                  {activeServer ? activeServer.name : '未连接'}
                </p>
              </div>
              <CaretRight size={14} className="text-muted-foreground group-hover:text-foreground transition-colors flex-shrink-0" />
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
            <DropdownMenuItem onClick={() => navigate('/settings')}>
              <Plus size={16} className="mr-2" />
              添加服务器
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive"
              onClick={disconnect}
            >
              <SignOut size={16} className="mr-2" />
              断开连接
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ScrollArea className="flex-1">
        <div className="px-3 pb-3 space-y-5">
          {/* 主导航 */}
          <nav>
            <ul className="space-y-0.5">
              {mainNavItems.map(({ to, icon: Icon, label, premium }) => {
                const locked = premium && !isPremium
                if (locked) {
                  return (
                    <li key={to}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            className="nav-item w-full opacity-45 cursor-not-allowed select-none"
                            onClick={() => { setUpgradeName(label); setUpgradeOpen(true) }}
                          >
                            <Icon size={18} className="flex-shrink-0" />
                            <span className="flex-1 text-left">{label}</span>
                            <CrownSimple size={12} weight="fill" className="text-amber-500" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="right">
                          <p>「{label}」是会员专属功能，点击了解详情</p>
                        </TooltipContent>
                      </Tooltip>
                    </li>
                  )
                }
                return (
                  <li key={to}>
                    <NavLink
                      to={to}
                      end={to === '/'}
                      {...bindPrefetch(to)}
                      className={({ isActive }) =>
                        cn('nav-item', isActive && 'active')
                      }
                    >
                      <Icon size={18} className="flex-shrink-0" />
                      <span>{label}</span>
                    </NavLink>
                  </li>
                )
              })}
            </ul>
          </nav>

          {/* 我的收藏 */}
          <nav>
            <p className="px-3 mb-2 text-[11px] text-muted-foreground/70 uppercase tracking-widest">
              我的音乐
            </p>
            <ul className="space-y-0.5">
              {collectionNavItems.map(({ to, icon: Icon, label, premium }) => {
                const locked = premium && !isPremium
                if (locked) {
                  return (
                    <li key={to}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            className="nav-item w-full opacity-45 cursor-not-allowed select-none"
                            onClick={() => { setUpgradeName(label); setUpgradeOpen(true) }}
                          >
                            <Icon size={18} className="flex-shrink-0" />
                            <span className="flex-1 text-left">{label}</span>
                            <CrownSimple size={12} weight="fill" className="text-amber-500" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="right">
                          <p>「{label}」是会员专属功能，点击了解详情</p>
                        </TooltipContent>
                      </Tooltip>
                    </li>
                  )
                }
                return (
                  <li key={to}>
                    <NavLink
                      to={to}
                      {...bindPrefetch(to)}
                      className={({ isActive }) =>
                        cn('nav-item', isActive && 'active')
                      }
                    >
                      <Icon size={18} className="flex-shrink-0" />
                      <span>{label}</span>
                    </NavLink>
                  </li>
                )
              })}
            </ul>
          </nav>

          {/* 歌单列表 */}
          {playlists && playlists.length > 0 && (
            <nav>
              <div className="flex items-center justify-between px-3 mb-2">
                <p className="text-[11px] text-muted-foreground/70 uppercase tracking-widest">
                  歌单
                </p>
                <button
                  onClick={() => navigate('/playlists')}
                  onMouseEnter={() => prefetchRoute('/playlists')}
                  onFocus={() => prefetchRoute('/playlists')}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  全部
                </button>
              </div>
              <ul className="space-y-0.5">
                {playlists.slice(0, 8).map(playlist => (
                  <li key={playlist.id}>
                    <NavLink
                      to={`/playlists/${playlist.id}`}
                      {...bindPrefetch(`/playlists/${playlist.id}`)}
                      className={({ isActive }) =>
                        cn('nav-item', isActive && 'active')
                      }
                    >
                      <VinylRecord size={18} className="flex-shrink-0 text-muted-foreground" />
                      <span className="flex-1 min-w-0 truncate">{playlist.name}</span>
                    </NavLink>
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </div>
      </ScrollArea>

      {/* 底部设置 */}
      <div className="p-3 border-t border-border space-y-1">
        {/* 会员状态 */}
        {!isPremium ? (
          <button
            onClick={() => { setUpgradeName(undefined); setUpgradeOpen(true) }}
            className="flex items-center gap-2.5 w-full px-3 py-2 rounded-md
              border border-amber-500/30 bg-amber-500/10
              text-amber-500 hover:border-amber-500/50 hover:text-amber-400
              transition-colors duration-150 active:scale-[0.97]"
          >
            <CrownSimple size={16} weight="fill" className="flex-shrink-0" />
            <span className="text-[12.5px] font-medium">升级会员</span>
          </button>
        ) : (
          <div className="flex items-center gap-2.5 px-3 py-2 rounded-md border border-amber-500/30 bg-amber-500/10">
            <CrownSimple size={16} weight="fill" className="text-amber-500 flex-shrink-0" />
            <span className="text-[12.5px] font-medium text-amber-500">会员已激活</span>
          </div>
        )}
        <NavLink
          to="/settings"
          {...bindPrefetch('/settings')}
          className={({ isActive }) =>
            cn('nav-item', isActive && 'active')
          }
        >
          <GearSix size={18} className="flex-shrink-0" />
          <span>设置</span>
        </NavLink>
      </div>
    </aside>
  )
}
