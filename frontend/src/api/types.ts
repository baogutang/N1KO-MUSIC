/**
 * 统一数据类型定义
 * 所有 API 适配器返回此处定义的标准类型，屏蔽底层服务差异
 */

// ===================================================
// 服务器配置
// ===================================================

/** 支持的服务器类型 */
export type ServerType = 'subsonic' | 'navidrome' | 'jellyfin' | 'emby'

/** 服务器连接配置 */
export interface ServerConfig {
  id: string
  name: string
  type: ServerType
  url: string
  username: string
  /** 存储的是 token 或加密后的密码，不存明文 */
  token: string
  /** 额外 salt（Subsonic 需要）*/
  salt?: string
  isActive: boolean
  createdAt: number
  /** 服务器版本信息 */
  version?: string
}

/** 认证结果 */
export interface AuthResult {
  success: boolean
  token: string
  salt?: string
  userId?: string
  username?: string
  error?: string
}

// ===================================================
// 音乐实体
// ===================================================

/** 歌曲 */
export interface Song {
  id: string
  title: string
  artist: string
  artistId?: string
  album: string
  albumId?: string
  /** 专辑封面 ID，用于构造封面 URL */
  coverArt?: string
  /** 时长（秒）*/
  duration: number
  /** 比特率（kbps）*/
  bitRate?: number
  /** 文件格式 */
  contentType?: string
  /** 文件大小（bytes）*/
  size?: number
  /** 曲目编号 */
  track?: number
  /** 发行年份 */
  year?: number
  /** 流派 */
  genre?: string
  /** 播放次数 */
  playCount?: number
  /** 是否收藏 */
  starred?: boolean
  /** 服务器 ID（来源标识）*/
  serverId?: string
  /** 评分（1-5）*/
  userRating?: number
  /** 文件路径（用于自定义歌词/封面 API 的 path 参数）*/
  path?: string
  /** Subsonic 文件后缀（部分列表无 path 时有 suffix，用于流格式推断）*/
  suffix?: string
}

/** 专辑 */
export interface Album {
  id: string
  name: string
  artist: string
  artistId?: string
  coverArt?: string
  songCount?: number
  duration?: number
  year?: number
  genre?: string
  starred?: boolean
  playCount?: number
  serverId?: string
}

/** 专辑详情（含歌曲列表）*/
export interface AlbumDetail extends Album {
  songs: Song[]
}

/** 歌手 */
export interface Artist {
  id: string
  name: string
  /** 专辑数量 */
  albumCount?: number
  /** 封面/头像 */
  coverArt?: string
  artistImageUrl?: string
  starred?: boolean
  serverId?: string
}

/** 歌手详情（含专辑列表）*/
export interface ArtistDetail extends Artist {
  biography?: string
  musicBrainzId?: string
  lastFmUrl?: string
  albums: Album[]
  /** 热门歌曲（服务端推荐排序）*/
  topSongs?: Song[]
  /** 歌手全部歌曲（从所有专辑聚合）*/
  songs?: Song[]
  similarArtists?: Artist[]
}

// ===================================================
// 歌单
// ===================================================

/** 歌单 */
export interface Playlist {
  id: string
  name: string
  comment?: string
  owner?: string
  songCount?: number
  duration?: number
  coverArt?: string
  /** 是否公开 */
  isPublic?: boolean
  created?: string
  changed?: string
  serverId?: string
}

/** 歌单详情（含歌曲列表）*/
export interface PlaylistDetail extends Playlist {
  songs: Song[]
}

// ===================================================
// 歌词
// ===================================================

/** 单行歌词 */
export interface LyricLine {
  /** 时间戳（毫秒）*/
  time: number
  /** 歌词文本 */
  text: string
  /** 翻译（可选）*/
  translation?: string
}

/** 歌词结构 */
export interface Lyrics {
  songId: string
  title?: string
  artist?: string
  lines: LyricLine[]
  /** 是否有时间戳同步 */
  synced: boolean
}

// ===================================================
// 播放历史与统计
// ===================================================

/** 播放历史条目 */
export interface PlayHistoryEntry {
  id: number
  song: Song
  playedAt: number
  duration?: number
}

/** 听歌统计 */
export interface ListeningStats {
  totalPlays: number
  totalDuration: number
  uniqueSongs: number
  uniqueArtists: number
  uniqueAlbums: number
  topSongs: Array<Song & { playCount: number }>
  topArtists: Array<{ artist: string; artistId?: string; playCount: number; duration: number }>
  topAlbums: Array<Album & { playCount: number }>
  /** 按月统计 */
  monthlyData: Array<{ month: string; plays: number; duration: number }>
  /** 按时段统计 */
  hourlyData: Array<{ hour: number; plays: number }>
}

// ===================================================
// 通用分页
// ===================================================

export interface ListParams {
  offset?: number
  size?: number
  type?: string
  /** 按字段排序 */
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
  genre?: string
  fromYear?: number
  toYear?: number
}

export interface PageResult<T> {
  items: T[]
  total?: number
  offset: number
  size: number
}

// ===================================================
// 搜索
// ===================================================

export interface SearchResult {
  songs: Song[]
  albums: Album[]
  artists: Artist[]
  playlists?: Playlist[]
}

// ===================================================
// API 适配器接口
// ===================================================

export interface MusicServerAdapter {
  /** 服务器类型标识 */
  readonly type: ServerType

  // --- 认证 ---
  login(url: string, username: string, password: string): Promise<AuthResult>
  ping(): Promise<boolean>

  // --- 歌曲 ---
  getSongs(params?: ListParams): Promise<PageResult<Song>>
  searchAll(query: string): Promise<SearchResult>
  /** path / suffix 用于识别 DSF/DSD（Navidrome 常缺准确 MIME，但会有 suffix）*/
  getStreamUrl(
    songId: string,
    maxBitrate: number,
    format: string,
    contentType?: string,
    path?: string,
    suffix?: string
  ): string
  getLyrics(songId: string, title?: string, artist?: string): Promise<Lyrics | null>
  scrobble(songId: string, submission?: boolean): Promise<void>

  // --- 专辑 ---
  getAlbums(params?: ListParams): Promise<PageResult<Album>>
  getAlbumDetail(albumId: string): Promise<AlbumDetail>
  getRecentAlbums(size?: number): Promise<Album[]>
  getRandomSongs(size?: number): Promise<Song[]>

  // --- 歌手 ---
  getArtists(): Promise<Artist[]>
  getArtistDetail(artistId: string): Promise<ArtistDetail>

  // --- 歌单 ---
  getPlaylists(): Promise<Playlist[]>
  getPlaylistDetail(playlistId: string): Promise<PlaylistDetail>
  createPlaylist(name: string, songIds?: string[]): Promise<Playlist>
  updatePlaylist(playlistId: string, name?: string, comment?: string): Promise<void>
  deletePlaylist(playlistId: string): Promise<void>
  addSongsToPlaylist(playlistId: string, songIds: string[]): Promise<void>
  removeSongsFromPlaylist(playlistId: string, songIndexes: number[]): Promise<void>

  // --- 收藏 ---
  getStarred(): Promise<{ songs: Song[]; albums: Album[]; artists: Artist[] }>
  star(id: string, type: 'song' | 'album' | 'artist'): Promise<void>
  unstar(id: string, type: 'song' | 'album' | 'artist'): Promise<void>

  // --- 元数据编辑 ---
  updateSongMetadata(songId: string, metadata: { title?: string; album?: string; artist?: string; year?: number; genre?: string; track?: number }): Promise<void>
  setLyrics(songId: string, lyrics: string): Promise<void>

  // --- 封面 ---
  getCoverUrl(id: string, size?: number): string

  // --- 流派 ---
  getGenres(): Promise<Array<{ name: string; songCount: number; albumCount: number }>>
}
