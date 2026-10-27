/**
 * 外壳的导航表：侧栏（宽）、侧边导航条（中）、底部标签栏（窄）共用这一份。
 *
 * 三档里都在的只有四个一级入口；侧栏有地方，再把音乐库的分类和「本期」摊开。
 * 中、窄两档放不下的入口进工具栏的「更多」菜单（MORE_NAV），一个都不丢。
 */
import type { Icon } from '@phosphor-icons/react'
import {
  House, Sparkle, Books, MagnifyingGlass, Newspaper, MusicNotes, VinylRecord,
  UsersThree, Playlist, Heart, ClockCounterClockwise, ChartBar,
} from '@phosphor-icons/react'

export interface NavItem {
  to: string
  labelKey: string
  icon: Icon
  /** 当前路径属于这个入口吗；缺省按前缀匹配 */
  match?: (pathname: string) => boolean
}

/** 音乐库下的所有路由：在中、窄两档里都算「音乐库」这一格 */
const LIBRARY_PATHS = /^\/(library|albums|artists|playlists|favorites|history|stats|songs|toplists)(\/|$)/

export const PRIMARY_NAV: NavItem[] = [
  { to: '/', labelKey: 'nav.home', icon: House, match: p => p === '/' },
  { to: '/recommendations', labelKey: 'nav.recommendations', icon: Sparkle },
  { to: '/library', labelKey: 'nav.library', icon: Books, match: p => LIBRARY_PATHS.test(p) },
  { to: '/search', labelKey: 'nav.search', icon: MagnifyingGlass },
]

/** 侧栏第一组：发现 */
export const SIDEBAR_DISCOVER: NavItem[] = [
  { to: '/', labelKey: 'nav.home', icon: House, match: p => p === '/' },
  { to: '/recommendations', labelKey: 'nav.recommendations', icon: Sparkle },
  { to: '/issue', labelKey: 'nav.issue', icon: Newspaper },
  { to: '/search', labelKey: 'nav.search', icon: MagnifyingGlass },
]

/** 侧栏第二组：音乐库的分类 */
export const SIDEBAR_LIBRARY: NavItem[] = [
  { to: '/library', labelKey: 'library.allSongs', icon: MusicNotes, match: p => p === '/library' || p.startsWith('/songs/') },
  { to: '/albums', labelKey: 'nav.albums', icon: VinylRecord },
  { to: '/artists', labelKey: 'nav.artists', icon: UsersThree },
  { to: '/playlists', labelKey: 'nav.playlists', icon: Playlist },
  { to: '/favorites', labelKey: 'nav.favorites', icon: Heart },
  { to: '/history', labelKey: 'nav.history', icon: ClockCounterClockwise },
  { to: '/stats', labelKey: 'nav.stats', icon: ChartBar },
]

/** 中、窄两档放不进导航的入口：工具栏「更多」菜单 */
export const MORE_NAV: NavItem[] = [
  { to: '/issue', labelKey: 'nav.issue', icon: Newspaper },
  { to: '/favorites', labelKey: 'nav.favorites', icon: Heart },
  { to: '/history', labelKey: 'nav.history', icon: ClockCounterClockwise },
  { to: '/stats', labelKey: 'nav.stats', icon: ChartBar },
]

export function isNavActive(item: NavItem, pathname: string): boolean {
  if (item.match) return item.match(pathname)
  return pathname === item.to || pathname.startsWith(item.to + '/')
}
