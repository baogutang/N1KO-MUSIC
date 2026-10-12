/**
 * 能力推导的唯一真源（阶段 4.1）。
 *
 * 此前两处逐行重复（useServerCapabilities 的主库版 / useSourceQueries 的
 * capabilitiesOf 聚合版），已漂移风险随时变现实。声明的 getSourceCapabilities
 * 优先，未声明的适配器按方法存在性推断。
 */
import type { MusicServerAdapter } from '@/api/types'
import type { ClientCapabilities } from '@/hooks/useServerCapabilities'
import type { SourceCapabilities } from '@/api/types'

export function capabilitiesOfAdapter(a: MusicServerAdapter): ClientCapabilities {
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
    recommendSongs: declared?.recommendSongs ?? typeof a.getRecommendSongs === 'function',
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
}

/** ClientCapabilities 的源级子集（聚合查询用） */
export function sourceCapabilitiesOf(a: MusicServerAdapter): SourceCapabilities {
  const caps = capabilitiesOfAdapter(a)
  return {
    search: caps.search, album: caps.album, artist: caps.artist, lyrics: caps.lyrics,
    userPlaylists: caps.userPlaylists, favorites: caps.favorites,
    playlistWrite: caps.playlistWrite, topLists: caps.topLists,
    recommendSheets: caps.recommendSheets, recommendSongs: caps.recommendSongs,
    importSheet: caps.importSheet, libraryBrowse: caps.libraryBrowse, radio: caps.radio,
  }
}

/** 行级能力：歌曲自己的源 > 主库（SongList 行、心形、电台入口共用） */
export function rowCapsOf(
  caps: Record<string, SourceCapabilities> | undefined,
  songServerId: string | undefined,
  primaryCaps: SourceCapabilities | undefined
): SourceCapabilities {
  if (songServerId && caps?.[songServerId]) return caps[songServerId]
  return primaryCaps ?? {
    search: false, album: false, artist: false, lyrics: false,
    userPlaylists: false, favorites: false, playlistWrite: false,
    topLists: false, recommendSheets: false, recommendSongs: false,
    importSheet: false, libraryBrowse: false, radio: false,
  }
}
