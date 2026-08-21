/**
 * 服务器能力探测。
 *
 * 这一批接口只有部分服务器实现（分享是 Subsonic 独有、评分 Jellyfin 走另一套、
 * 多音乐库 Emby 与 Navidrome 语义也不同）。原则是：
 * **不支持的服务器上入口整个不出现**，而不是让用户点了没反应。
 *
 * 探测结果按服务器缓存，切服务器时自动失效。
 */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getAdapter, hasAdapter } from '@/api'
import { useServerStore } from '@/store/serverStore'

export interface ClientCapabilities {
  /** 公开分享链接 */
  shares: boolean
  /** 五星评分写回 */
  rating: boolean
  /** 长音轨断点 */
  bookmarks: boolean
  /** 服务器上此刻还有谁在听 */
  nowPlaying: boolean
  /** 多音乐库 */
  musicFolders: boolean
  /** 从客户端触发扫描 */
  scan: boolean
  /** 跨设备播放队列 */
  playQueue: boolean
  /** 电台种子（相似曲目 / 热门曲目 / 流派）*/
  radio: boolean
}

const NONE: ClientCapabilities = {
  shares: false, rating: false, bookmarks: false, nowPlaying: false,
  musicFolders: false, scan: false, playQueue: false, radio: false,
}

/**
 * 方法存在与否是同步可知的（都是 adapter 上的可选方法），
 * 只有多音乐库需要真的问一次服务器——有些服务器实现了接口但只返回一个库，
 * 那种情况下切换器没有意义，不该出现。
 */
export function useServerCapabilities(): ClientCapabilities & { folders: Array<{ id: string; name: string }> } {
  const activeServerId = useServerStore(s => s.activeServerId)
  const isConnected = useServerStore(s => s.isConnected)

  const methods = useMemo<ClientCapabilities>(() => {
    if (!hasAdapter()) return NONE
    const a = getAdapter()
    return {
      shares: typeof a.createShare === 'function',
      rating: typeof a.setRating === 'function',
      bookmarks: typeof a.createBookmark === 'function',
      nowPlaying: typeof a.getNowPlaying === 'function',
      musicFolders: typeof a.getMusicFolders === 'function',
      scan: typeof a.startScan === 'function',
      playQueue: typeof a.savePlayQueue === 'function',
      radio: typeof a.getSimilarSongs === 'function' || typeof a.getArtistSongs === 'function',
    }
    // activeServerId 是必要依赖：getAdapter() 在切换服务器后会返回另一个实例，
    // 而 lint 看不到这层间接关系，只能显式说明。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeServerId])

  const { data: folders } = useQuery({
    queryKey: [activeServerId ?? 'no-server', 'music-folders'],
    queryFn: () => getAdapter().getMusicFolders?.() ?? [],
    enabled: !!activeServerId && isConnected && methods.musicFolders,
    staleTime: 30 * 60 * 1000,
  })

  return {
    ...methods,
    // 只有一个库时切换器没有意义
    musicFolders: methods.musicFolders && (folders?.length ?? 0) > 1,
    folders: folders ?? [],
  }
}
