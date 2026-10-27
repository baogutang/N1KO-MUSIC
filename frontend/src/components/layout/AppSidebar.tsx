/**
 * 宽窗口（≥1024）的侧栏：iPadOS 式浮起的一张纸片。
 *
 * 上：品牌 + 收起键（⌃⌘S）
 * 中：发现（首页 / 推荐 / 本期 / 搜索）、音乐库的七个分类、主库上的歌单
 * 下：服务器菜单、曲库范围、明暗、设置
 *
 * 收起后内容区铺满，工具栏左端出现展开键；收起状态跨会话保留（themeStore.sidebarCollapsed）。
 */

import { useState } from 'react'
import type { DragEvent } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { GearSix, Moon, SidebarSimple, Sun } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { needsTrafficLightInset } from '@/lib/platform'
import { useThemeStore } from '@/store/themeStore'
import { usePlaylists, useAddToPlaylist } from '@/hooks/useServerQueries'
import { useSourceCapabilities } from '@/hooks/useSourceQueries'
import { useServerStore } from '@/store/serverStore'
import { isSongDrag, readSongDrag, endSongDrag } from '@/lib/songDrag'
import { toast } from '@/components/ui/use-toast'
import type { Playlist } from '@/api/types'
import { findAdapterFor } from '@/api'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'
import { prefetchRoute } from '@/routes/lazyRoutes'
import { useT } from '@/i18n'
import { ServerMenu } from './ServerMenu'
import { LibraryScopeMenu } from './LibraryScopeMenu'
import { SIDEBAR_DISCOVER, SIDEBAR_LIBRARY, isNavActive, type NavItem } from './navItems'

const itemCls = (active: boolean) =>
  cn(
    'flex min-h-[38px] w-full items-center gap-3 rounded-sm px-2.5 text-[14.5px] transition-colors duration-150',
    active
      ? 'bg-paper-3 font-semibold text-ink'
      : 'text-ink-soft hover:bg-paper-deep hover:text-ink'
  )

function NavGroup({ items }: { items: NavItem[] }) {
  const { t } = useT()
  const { pathname } = useLocation()
  return (
    <ul className="flex flex-col gap-0.5">
      {items.map(item => {
        const active = isNavActive(item, pathname)
        const Icon = item.icon
        return (
          <li key={item.to}>
            <NavLink
              to={item.to}
              onMouseEnter={() => prefetchRoute(item.to)}
              onFocus={() => prefetchRoute(item.to)}
              className={itemCls(active)}
              aria-current={active ? 'page' : undefined}
            >
              <Icon size={19} weight={active ? 'fill' : 'regular'} className={active ? 'text-primary' : 'text-ink-faint'} />
              <span className="truncate">{t(item.labelKey)}</span>
            </NavLink>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * 把歌拖到侧栏的歌单上（iPadOS 接妙控板、桌面）：直接加进去。
 * 规则与「加入歌单」对话框一致：曲目必须和歌单同源、那个源能写歌单、歌单不是只读的智能歌单；
 * 不满足时给一句说明，而不是让一次拖放静默失败。
 */
function usePlaylistDrop() {
  const { t } = useT()
  const caps = useSourceCapabilities()
  const primaryServerId = useServerStore(s => s.activeServerId)
  const addToPlaylist = useAddToPlaylist()
  const [overId, setOverId] = useState<string | null>(null)

  const onDragOver = (e: DragEvent, pl: Playlist) => {
    if (!isSongDrag(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    if (overId !== pl.id) setOverId(pl.id)
  }
  const onDragLeave = (pl: Playlist) => {
    if (overId === pl.id) setOverId(null)
  }
  const onDrop = (e: DragEvent, pl: Playlist) => {
    const songs = readSongDrag(e)
    setOverId(null)
    if (!songs) return
    e.preventDefault()
    endSongDrag()
    const sameSource = songs.every(song => (song.serverId || primaryServerId) === pl.serverId)
    if (!sameSource) {
      toast({ title: t('shell.dropCrossSource'), description: pl.name })
      return
    }
    if (pl.readonly || !caps[pl.serverId]?.playlistWrite) {
      toast({ title: t('shell.dropReadonly'), description: pl.name })
      return
    }
    addToPlaylist.mutate(
      { playlistId: pl.id, songIds: songs.map(song => song.id), serverId: pl.serverId },
      {
        onSuccess: () => toast({ title: t('shell.addedToPlaylist', { name: pl.name, count: songs.length }) }),
        onError: () => toast({ title: t('shell.addToPlaylistFailed'), description: pl.name, variant: 'destructive' }),
      }
    )
  }
  return { overId, onDragOver, onDragLeave, onDrop }
}

function PlaylistGroup() {
  const { t } = useT()
  const { pathname } = useLocation()
  const { data: playlists } = usePlaylists()
  const drop = usePlaylistDrop()
  if (!playlists?.length) return null
  return (
    <>
      <p className="px-2.5 pb-1.5 pt-5 text-[13px] font-medium text-ink-faint">{t('nav.playlists')}</p>
      <ul className="flex flex-col gap-0.5">
        {playlists.slice(0, 12).map(pl => {
          const to = `/playlists/${encodeURIComponent(pl.id)}`
          const active = pathname === to
          const cover = pl.coverArt ? findAdapterFor(pl.serverId)?.getCoverUrl(pl.coverArt, 64) ?? undefined : undefined
          return (
            <li key={pl.id}>
              <NavLink
                to={to}
                className={cn(itemCls(active), drop.overId === pl.id && 'bg-primary/10 outline outline-2 -outline-offset-2 outline-primary/60')}
                aria-current={active ? 'page' : undefined}
                onDragOver={e => drop.onDragOver(e, pl)}
                onDragLeave={() => drop.onDragLeave(pl)}
                onDrop={e => drop.onDrop(e, pl)}
              >
                <span className="h-6 w-6 flex-none overflow-hidden rounded-[6px] bg-paper-3">
                  <ImageWithFallback src={cover} alt="" fallbackType="album" className="h-full w-full" />
                </span>
                <span className="min-w-0 flex-1 truncate">{pl.name}</span>
                {typeof pl.songCount === 'number' && (
                  <span className="num text-[12px] text-ink-faint">{pl.songCount}</span>
                )}
              </NavLink>
            </li>
          )
        })}
      </ul>
    </>
  )
}

export function AppSidebar() {
  const { t } = useT()
  const { pathname } = useLocation()
  const resolvedTheme = useThemeStore(s => s.resolvedTheme)
  const toggleTheme = useThemeStore(s => s.toggleTheme)
  const toggleSidebar = useThemeStore(s => s.toggleSidebar)
  const themeLabel = resolvedTheme === 'dark' ? t('settings.theme.toLight') : t('settings.theme.toDark')
  const settingsActive = pathname.startsWith('/settings')

  return (
    <nav
      aria-label={t('nav.main')}
      className="sheet col-start-1 row-start-1 m-2 mr-0 flex min-h-0 flex-col overflow-hidden"
      style={{
        marginTop: 'calc(env(safe-area-inset-top) + 8px)',
        marginBottom: 'calc(env(safe-area-inset-bottom) + 8px)',
        marginLeft: 'calc(env(safe-area-inset-left) + 8px)',
      }}
    >
      <div
        className={cn('flex h-14 flex-none items-center justify-between pl-4 pr-2', needsTrafficLightInset && 'pt-6 h-[76px]')}
        data-tauri-drag-region
      >
        <NavLink to="/" className="font-display text-[19px] font-semibold tracking-[-0.02em] text-ink" aria-label={t('action.backHome')}>
          N1KO
        </NavLink>
        <button
          onClick={toggleSidebar}
          className="grid h-9 w-9 place-items-center rounded-pill text-ink-faint transition-colors hover:bg-paper-deep hover:text-ink"
          aria-label={t('shell.hideSidebar')}
          title={`${t('shell.hideSidebar')}  ⌃⌘S`}
        >
          <SidebarSimple size={19} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3 scrollbar-hide">
        <NavGroup items={SIDEBAR_DISCOVER} />
        <p className="px-2.5 pb-1.5 pt-5 text-[13px] font-medium text-ink-faint">{t('nav.library')}</p>
        <NavGroup items={SIDEBAR_LIBRARY} />
        <PlaylistGroup />
      </div>

      <div className="flex flex-none flex-col gap-1 border-t border-hair-soft px-2.5 py-2">
        <ServerMenu />
        <div className="flex items-center gap-1 px-1">
          <LibraryScopeMenu className="mr-auto" />
          <button
            onClick={toggleTheme}
            className="grid h-9 w-9 place-items-center rounded-pill text-ink-faint transition-colors hover:bg-paper-deep hover:text-ink"
            aria-label={themeLabel}
            title={themeLabel}
          >
            {resolvedTheme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <NavLink
            to="/settings"
            onMouseEnter={() => prefetchRoute('/settings')}
            className={cn(
              'grid h-9 w-9 place-items-center rounded-pill transition-colors hover:bg-paper-deep hover:text-ink',
              settingsActive ? 'text-primary' : 'text-ink-faint'
            )}
            aria-label={t('nav.settings')}
            aria-current={settingsActive ? 'page' : undefined}
            title={t('nav.settings')}
          >
            <GearSix size={18} weight={settingsActive ? 'fill' : 'regular'} />
          </NavLink>
        </div>
      </div>
    </nav>
  )
}
