/**
 * 侧边栏导航组件
 * 包含服务器信息、主导航、歌单快捷入口
 */

import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  Home, Search, Library, Heart, Clock,
  BarChart3, Settings, ChevronRight, LogOut, Plus, Music2, Sparkles, Crown
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useServerStore, getServerTypeLabel } from '@/store/serverStore'
import { usePlaylists } from '@/hooks/useServerQueries'
import { useMemberStore } from '@/store/memberStore'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MemberUpgradeDialog } from '@/components/member/MemberUpgradeDialog'

const mainNavItems = [
  { to: '/', icon: Home, label: '首页', premium: false },
  { to: '/search', icon: Search, label: '搜索', premium: false },
  { to: '/library', icon: Library, label: '音乐库', premium: false },
  { to: '/recommendations', icon: Sparkles, label: '为你推荐', premium: true },
]

const collectionNavItems = [
  { to: '/favorites', icon: Heart, label: '我的收藏', premium: true },
  { to: '/history', icon: Clock, label: '最近播放', premium: false },
  { to: '/stats', icon: BarChart3, label: '听歌统计', premium: true },
]

export function Sidebar() {
  const { servers, activeServerId, disconnect, activateServer } = useServerStore()
  const navigate = useNavigate()
  const { data: playlists } = usePlaylists()
  const activeServer = servers.find(s => s.id === activeServerId)
  const isPremium = useMemberStore(s => s.isPremium)
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [upgradeName, setUpgradeName] = useState<string | undefined>()

  return (
    <aside className="flex flex-col h-full w-60 bg-background border-r border-border/50 flex-shrink-0">
      {/* 会员升级弹窗 */}
      <MemberUpgradeDialog
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        featureName={upgradeName}
      />
      {/* 服务器信息 */}
      <div className="p-4 border-b border-border/50">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-3 w-full p-2 rounded-xl hover:bg-accent transition-colors group">
              {/* 服务器 Logo */}
              <div className="w-9 h-9 rounded-xl bg-primary/20 flex items-center justify-center flex-shrink-0">
                <Music2 className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0 text-left">
                <p className="text-sm font-semibold text-foreground line-clamp-1">
                  {activeServer?.name ?? 'N1KO MUSIC'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {activeServer ? getServerTypeLabel(activeServer.type) : '未连接'}
                </p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56" align="start">
            {servers.map(server => (
              <DropdownMenuItem
                key={server.id}
                onClick={() => activateServer(server.id)}
                className={cn(activeServerId === server.id && 'text-primary')}
              >
                <Music2 className="w-4 h-4 mr-2" />
                {server.name}
                <span className="ml-auto text-xs text-muted-foreground">
                  {getServerTypeLabel(server.type)}
                </span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate('/settings')}>
              <Plus className="w-4 h-4 mr-2" />
              添加服务器
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive"
              onClick={disconnect}
            >
              <LogOut className="w-4 h-4 mr-2" />
              断开连接
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-6">
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
                            <Icon className="w-4 h-4 flex-shrink-0" />
                            <span className="flex-1 text-left">{label}</span>
                            <Crown className="w-3 h-3 text-amber-500" />
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
                      className={({ isActive }) =>
                        cn('nav-item', isActive && 'active text-foreground bg-accent')
                      }
                    >
                      <Icon className="w-4 h-4 flex-shrink-0" />
                      <span>{label}</span>
                    </NavLink>
                  </li>
                )
              })}
            </ul>
          </nav>

          {/* 我的收藏 */}
          <nav>
            <p className="px-3 mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
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
                            <Icon className="w-4 h-4 flex-shrink-0" />
                            <span className="flex-1 text-left">{label}</span>
                            <Crown className="w-3 h-3 text-amber-500" />
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
                      className={({ isActive }) =>
                        cn('nav-item', isActive && 'active text-foreground bg-accent')
                      }
                    >
                      <Icon className="w-4 h-4 flex-shrink-0" />
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
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  歌单
                </p>
                <button
                  onClick={() => navigate('/playlists')}
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
                      className={({ isActive }) =>
                        cn('nav-item', isActive && 'active text-foreground bg-accent')
                      }
                    >
                      <Library className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
                      <span className="line-clamp-1">{playlist.name}</span>
                    </NavLink>
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </div>
      </ScrollArea>

      {/* 底部设置 */}
      <div className="p-3 border-t border-border/50 space-y-1">
        {/* 会员状态 */}
        {!isPremium ? (
          <button
            onClick={() => { setUpgradeName(undefined); setUpgradeOpen(true) }}
            className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg
              bg-gradient-to-r from-amber-500/10 to-orange-500/10
              border border-amber-500/20 hover:border-amber-500/40
              text-amber-500 hover:text-amber-400 transition-all group"
          >
            <Crown className="w-4 h-4 flex-shrink-0" />
            <span className="text-sm font-medium">升级会员</span>
          </button>
        ) : (
          <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <Crown className="w-4 h-4 text-amber-500 flex-shrink-0" />
            <span className="text-sm font-medium text-amber-400">会员已激活</span>
          </div>
        )}
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            cn('nav-item', isActive && 'active text-foreground bg-accent')
          }
        >
          <Settings className="w-4 h-4 flex-shrink-0" />
          <span>设置</span>
        </NavLink>
      </div>
    </aside>
  )
}
