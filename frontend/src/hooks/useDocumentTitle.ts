/**
 * 页面标题。
 *
 * 标题一直是固定的「N1KO MUSIC」：开了几个标签页就分不清哪个是哪个，
 * 浏览历史里也是一排一模一样的条目。读屏在切换页面时念的同样是这一句，
 * 于是「我到哪儿了」这个问题没有答案。
 *
 * 正在播放时把曲名放在最前——这是标签页最有用的一条信息，
 * 也是各家播放器的通行做法（缩到只剩图标时鼠标悬停仍看得见）。
 */

import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { usePlayerStore } from '@/store/playerStore'
import { useT } from '@/i18n'

const APP_NAME = 'N1KO MUSIC'

/** 路由前缀 → i18n 键。取最长匹配，所以 /albums/:id 会落到 album.detail 而非 albums。 */
const ROUTE_TITLES: Array<[string, string]> = [
  ['/albums/', 'nav.albums'],
  ['/artists/', 'nav.artists'],
  ['/playlists/', 'nav.playlists'],
  ['/songs/', 'nav.songDetail'],
  ['/albums', 'nav.albums'],
  ['/artists', 'nav.artists'],
  ['/playlists', 'nav.playlists'],
  ['/library', 'nav.library'],
  ['/search', 'nav.search'],
  ['/favorites', 'nav.favorites'],
  ['/history', 'nav.history'],
  ['/stats', 'nav.stats'],
  ['/issue', 'nav.issue'],
  ['/recommendations', 'nav.recommendations'],
  ['/settings', 'nav.settings'],
]

export function useDocumentTitle() {
  const { t, locale } = useT()
  const { pathname } = useLocation()
  const currentSong = usePlayerStore(s => s.currentSong)
  const isPlaying = usePlayerStore(s => s.isPlaying)

  useEffect(() => {
    const entry = ROUTE_TITLES.find(([prefix]) => pathname.startsWith(prefix))
    const page = entry ? t(entry[1]) : null

    // 正在播放的曲名优先：标签页缩到只剩图标时，这是唯一还看得见的信息
    const nowPlaying = isPlaying && currentSong
      ? `${currentSong.title} · ${currentSong.artist}`
      : null

    document.title = [nowPlaying, page, APP_NAME].filter(Boolean).join(' — ')
    // locale 是必要依赖：切语言后标题要跟着变
  }, [pathname, currentSong, isPlaying, t, locale])
}
