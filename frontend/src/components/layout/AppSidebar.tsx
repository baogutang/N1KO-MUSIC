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
import { motion } from 'motion/react'
import { cn } from '@/lib/utils'
import { SPRING_SNAPPY } from '@/lib/motion'
import { useThemeToggle } from '@/hooks/useThemeToggle'
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
    'relative flex min-h-[40px] w-full items-center gap-3 rounded-[12px] px-3 text-[14.5px] font-medium transition-colors duration-2',
    active ? 'text-ink' : 'text-ink-2 hover:bg-ink/[0.05] hover:text-ink'
  )

/**
 * 当前项的底：一块会滑的片。换页时它从上一项弹簧滑到新的一项（layoutId），
 * 而不是两处各自闪一下。
 */
function ActivePill({ id }: { id: string }) {
  return (
    <motion.span
      layoutId={id}
      transition={SPRING_SNAPPY}
      aria-hidden="true"
      className="absolute inset-0 -z-10 rounded-[12px] bg-ink/[0.075]"
    />
  )
}

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
              className={cn(itemCls(active), 'isolate')}
              aria-current={active ? 'page' : undefined}
            >
              {active && <ActivePill id="sidebar-active" />}
              <Icon size={20} weight={active ? 'fill' : 'regular'} className={active ? 'text-leaf' : 'text-ink-3'} />
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
      <p className="px-3 pb-1.5 pt-6 text-[13px] font-semibold text-ink-3">{t('nav.playlists')}</p>
      <ul className="flex flex-col gap-0.5">
        {playlists.slice(0, 12).map(pl => {
          const to = `/playlists/${encodeURIComponent(pl.id)}`
          const active = pathname === to
          const cover = pl.coverArt ? findAdapterFor(pl.serverId)?.getCoverUrl(pl.coverArt, 64) ?? undefined : undefined
          return (
            <li key={pl.id}>
              <NavLink
                to={to}
                className={cn(itemCls(active), 'isolate', drop.overId === pl.id && 'bg-lime/25 outline outline-2 -outline-offset-2 outline-leaf/60')}
                aria-current={active ? 'page' : undefined}
                onDragOver={e => drop.onDragOver(e, pl)}
                onDragLeave={() => drop.onDragLeave(pl)}
                onDrop={e => drop.onDrop(e, pl)}
              >
                {active && <ActivePill id="sidebar-active" />}
                <span className="h-7 w-7 flex-none overflow-hidden rounded-[7px] bg-fill shadow-hair">
                  <ImageWithFallback src={cover} alt="" fallbackType="album" className="h-full w-full" />
                </span>
                <span className="min-w-0 flex-1 truncate">{pl.name}</span>
                {typeof pl.songCount === 'number' && (
                  <span className="num text-[12px] text-ink-3">{pl.songCount}</span>
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
  const toggleTheme = useThemeToggle()
  const toggleSidebar = useThemeStore(s => s.toggleSidebar)
  const themeLabel = resolvedTheme === 'dark' ? t('settings.theme.toLight') : t('settings.theme.toDark')
  const settingsActive = pathname.startsWith('/settings')

  return (
    <nav
      aria-label={t('nav.main')}
      className="col-start-1 row-start-1 m-2.5 mr-0 flex min-h-0 flex-col overflow-hidden rounded-[22px] bg-surface-2/75 shadow-hair"
      style={{
        marginTop: 'calc(env(safe-area-inset-top) + 10px)',
        marginBottom: 'calc(env(safe-area-inset-bottom) + 10px)',
        marginLeft: 'calc(env(safe-area-inset-left) + 10px)',
      }}
    >
      <div
        className={cn('flex h-[60px] flex-none items-center justify-between pl-5 pr-2.5', needsTrafficLightInset && 'pt-6 h-[80px]')}
        data-tauri-drag-region
      >
        <NavLink to="/" className="font-display text-[22px] font-bold tracking-[-0.04em] text-ink" aria-label={t('action.backHome')}>
          N1KO
        </NavLink>
        <button
          onClick={toggleSidebar}
          className="press-pop grid h-9 w-9 place-items-center rounded-pill text-ink-3 hover:bg-ink/[0.06] hover:text-ink"
          aria-label={t('shell.hideSidebar')}
          title={`${t('shell.hideSidebar')}  ⌃⌘S`}
        >
          <SidebarSimple size={19} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3 scrollbar-hide">
        <NavGroup items={SIDEBAR_DISCOVER} />
        <p className="px-3 pb-1.5 pt-6 text-[13px] font-semibold text-ink-3">{t('nav.library')}</p>
        <NavGroup items={SIDEBAR_LIBRARY} />
        <PlaylistGroup />
      </div>

      <div className="hairline-t flex flex-none flex-col gap-1 px-2.5 py-2">
        <ServerMenu />
        <div className="flex items-center gap-1 px-1">
          <LibraryScopeMenu className="mr-auto" />
          <button
            onClick={e => toggleTheme(e)}
            className="press-pop grid h-9 w-9 place-items-center rounded-pill text-ink-3 hover:bg-ink/[0.06] hover:text-ink"
            aria-label={themeLabel}
            title={themeLabel}
          >
            {resolvedTheme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <NavLink
            to="/settings"
            onMouseEnter={() => prefetchRoute('/settings')}
            className={cn(
              'press-pop grid h-9 w-9 place-items-center rounded-pill hover:bg-ink/[0.06] hover:text-ink',
              settingsActive ? 'text-leaf' : 'text-ink-3'
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
