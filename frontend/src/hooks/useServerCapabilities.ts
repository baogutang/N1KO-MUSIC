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
import type { SourceCapabilities } from '@/api/types'
import { useServerStore } from '@/store/serverStore'

/**
 * 客户端视角的能力 = 音源级能力（SourceCapabilities，PROTOCOL §6）
 * + 只对 NAS 音源有意义的客户端能力（方法存在性 + 服务器探测）。
 */
export interface ClientCapabilities extends SourceCapabilities {
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
}

const NONE: ClientCapabilities = {
  search: false, album: false, artist: false, lyrics: false,
  userPlaylists: false, favorites: false, playlistWrite: false,
  topLists: false, recommendSheets: false, importSheet: false,
  libraryBrowse: false, radio: false,
  shares: false, rating: false, bookmarks: false, nowPlaying: false,
  musicFolders: false, scan: false, playQueue: false,
}

/**
 * 大部分能力靠「adapter 上有没有这个方法」就能同步判断，但有两项不行，
 * 它们必须真的问一次服务器：
 *
 * - **多音乐库**：有些服务器实现了接口却只返回一个库，切换器没有意义。
 * - **分享**：Subsonic 系适配器一律实现了 createShare，可服务器那边可能整个关着
 *   （Navidrome 的 `ND_ENABLESHARING` 默认为 false，会回 501）。只看方法存在
 *   就等于永远说「支持」，入口照常出现，点下去才报错——这正是要避免的那种交互。
 *
 * 两者都遵循同一条原则：**没有得到服务器的肯定答复，入口就不出现。**
 */
export function useServerCapabilities(): ClientCapabilities & { folders: Array<{ id: string; name: string }> } {
  const activeServerId = useServerStore(s => s.activeServerId)
  const isConnected = useServerStore(s => s.isConnected)

  const methods = useMemo<ClientCapabilities>(() => {
    if (!hasAdapter()) return NONE
    const a = getAdapter()
    // 音源级能力优先取适配器声明；未声明 getSourceCapabilities 的适配器按方法存在性推断
    const declared = a.getSourceCapabilities?.()
    return {
      search: declared?.search ?? typeof a.searchAll === 'function',
      album: declared?.album ?? typeof a.getAlbumDetail === 'function',
      artist: declared?.artist ?? typeof a.getArtistDetail === 'function',
      lyrics: declared?.lyrics ?? typeof a.getLyrics === 'function',
      userPlaylists: declared?.userPlaylists ?? typeof a.getPlaylists === 'function',
      favorites: declared?.favorites ?? typeof a.getStarred === 'function',
      playlistWrite: declared?.playlistWrite ?? typeof a.createPlaylist === 'function',
      topLists: declared?.topLists ?? typeof a.getTopLists === 'function',
      recommendSheets: declared?.recommendSheets ?? typeof a.getRecommendSheets === 'function',
      importSheet: declared?.importSheet ?? false,
      libraryBrowse: declared?.libraryBrowse ?? true,
      radio: declared?.radio
        ?? (typeof a.getSimilarSongs === 'function' || typeof a.getArtistSongs === 'function'),
      shares: typeof a.createShare === 'function',
      rating: typeof a.setRating === 'function',
      bookmarks: typeof a.createBookmark === 'function',
      nowPlaying: typeof a.getNowPlaying === 'function',
      musicFolders: typeof a.getMusicFolders === 'function',
      scan: typeof a.startScan === 'function',
      playQueue: typeof a.savePlayQueue === 'function',
    }
    // activeServerId 是必要依赖：getAdapter() 在切换服务器后会返回另一个实例，
    // 而 lint 看不到这层间接关系，只能显式说明。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeServerId])

  // 探测一次分享是否真的开着。probeShares 只在服务器明确回答时 resolve；
  // 连不上时它会抛错，让这个查询进入 error 态——**不要**在这里 retry: false，
  // 那会把一次网络抖动变成半小时没有分享入口（抖动时 data 是 undefined 而非 false，
  // 于是重挂载和重试都还能把它救回来）。
  const { data: sharesEnabled } = useQuery({
    queryKey: [activeServerId ?? 'no-server', 'shares-enabled'],
    queryFn: () => getAdapter().probeShares?.() ?? true,
    enabled: !!activeServerId && isConnected && methods.shares,
    staleTime: 30 * 60 * 1000,
  })

  const { data: folders } = useQuery({
    queryKey: [activeServerId ?? 'no-server', 'music-folders'],
    queryFn: () => getAdapter().getMusicFolders?.() ?? [],
    enabled: !!activeServerId && isConnected && methods.musicFolders,
    staleTime: 30 * 60 * 1000,
  })

  return {
    ...methods,
    // 只认肯定答复：探测在飞、或者根本没问到服务器时都按「不支持」算。
    // 入口晚出现一会儿，好过点下去才失败。
    shares: methods.shares && sharesEnabled === true,
    // 只有一个库时切换器没有意义
    musicFolders: methods.musicFolders && (folders?.length ?? 0) > 1,
    folders: folders ?? [],
  }
}
