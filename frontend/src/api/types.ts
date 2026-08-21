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
  /** 服务端用户 ID（Jellyfin/Emby 需要，登录响应返回；不可用 token 代替）*/
  userId?: string
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
  /**
   * 服务器已经返回、此前被 mapSong 丢弃的扩展元数据。
   * 收在一个可选对象里而不是往 Song 上摊二十个平铺字段。
   */
  ext?: SongExtras
}

/** 制作人员（OpenSubsonic contributors / Jellyfin People）*/
export interface Contributor {
  /** 角色，如 composer / producer / engineer */
  role: string
  /** 细分角色，如 "guitar" */
  subRole?: string
  name: string
  artistId?: string
}

/** ReplayGain 数据（单位 dB，peak 为线性幅度）*/
export interface ReplayGainInfo {
  trackGain?: number
  albumGain?: number
  trackPeak?: number
  albumPeak?: number
  fallbackGain?: number
}

/**
 * 服务器早就在返、客户端此前一律丢弃的字段。
 * 全部可选：任何一个服务器缺哪项，对应的 UI 直接不渲染即可。
 */
export interface SongExtras {
  /** 音量归一化数据，服务器已算好 */
  replayGain?: ReplayGainInfo
  /** 位深，如 24 */
  bitDepth?: number
  /** 采样率（Hz），如 96000 */
  samplingRate?: number
  /** 声道数 */
  channelCount?: number
  /** 制作人员名录 */
  contributors?: Contributor[]
  /** 展示用的完整艺人串（含 feat.）*/
  displayArtist?: string
  /** 作曲 */
  displayComposer?: string
  /** 情绪标签 */
  moods?: string[]
  /** BPM */
  bpm?: number
  isrc?: string[]
  musicBrainzId?: string
  /** 文件标签里的备注，只读 */
  comment?: string
  /** 长音轨的服务端断点位置（毫秒）*/
  bookmarkPosition?: number
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
  /** 唱片说明 / 乐评（Subsonic getAlbumInfo2 的 notes）*/
  notes?: string
  musicBrainzId?: string
  /** Last.fm 页面等外部链接 */
  externalUrl?: string
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
  /**
   * 服务端给出的索引字母（A–Z / # / 拼音首字母）。
   * 排序规则归服务端管——Navidrome 有 sortName、忽略冠词表，中文库还按拼音
   * 归位；在前端另算一套只会和列表顺序打架，也永远追不上服务端的本地化。
   */
  sortIndex?: string
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
  /**
   * Navidrome 的智能歌单会带 readonly:true 一起返回，长得和普通歌单一模一样。
   * 不标出来的话，用户对它做的编辑操作会静默失效。
   */
  readonly?: boolean
  /** 智能歌单的缓存有效期 */
  validUntil?: string
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
  /** 限定到某个音乐库（多库服务器）。缺省表示全部库。 */
  musicFolderId?: string
  /**
   * 取消信号，由 React Query 的 queryFn 提供。
   *
   * 此前只有搜索接得住它，别处一律接不住：翻两页专辑、连点几个歌手、
   * 在弱网下切走再切回来，在途请求全都还在跑，既占着连接又可能让
   * 后到的旧响应盖掉新结果。
   */
  signal?: AbortSignal
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
  getSong(songId: string): Promise<Song | null>
  /** signal 由 React Query 的 queryFn 提供，用于取消在途搜索 */
  searchAll(query: string, signal?: AbortSignal): Promise<SearchResult>
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
  getAlbumDetail(albumId: string, signal?: AbortSignal): Promise<AlbumDetail>
  getRecentAlbums(size?: number, signal?: AbortSignal): Promise<Album[]>
  getRandomSongs(size?: number, musicFolderId?: string, signal?: AbortSignal): Promise<Song[]>

  // --- 歌手 ---
  getArtists(musicFolderId?: string, signal?: AbortSignal): Promise<Artist[]>
  getArtistDetail(artistId: string, signal?: AbortSignal): Promise<ArtistDetail>

  // --- 歌单 ---
  getPlaylists(signal?: AbortSignal): Promise<Playlist[]>
  getPlaylistDetail(playlistId: string, signal?: AbortSignal): Promise<PlaylistDetail>
  createPlaylist(name: string, songIds?: string[]): Promise<Playlist>
  updatePlaylist(playlistId: string, name?: string, comment?: string): Promise<void>
  deletePlaylist(playlistId: string): Promise<void>
  addSongsToPlaylist(playlistId: string, songIds: string[]): Promise<void>
  removeSongsFromPlaylist(playlistId: string, songIndexes: number[]): Promise<void>

  // --- 收藏 ---
  getStarred(signal?: AbortSignal): Promise<{ songs: Song[]; albums: Album[]; artists: Artist[] }>
  star(id: string, type: 'song' | 'album' | 'artist'): Promise<void>
  unstar(id: string, type: 'song' | 'album' | 'artist'): Promise<void>

  // --- 元数据编辑 ---
  updateSongMetadata(songId: string, metadata: { title?: string; album?: string; artist?: string; year?: number; genre?: string; track?: number }): Promise<void>
  setLyrics(songId: string, lyrics: string): Promise<void>

  // --- 封面 ---
  getCoverUrl(id: string, size?: number): string

  // --- 流派 ---
  getGenres(signal?: AbortSignal): Promise<Array<{ name: string; songCount: number; albumCount: number }>>

  // --- 定向候选（个性化推荐用）---
  // 这三项用于按用户画像拉取候选曲目，而不是只对随机曲目重排序。
  // 均为可选：服务器或适配器不支持时应返回空数组而非抛错，调用方会回退到随机候选。

  /** 指定歌手的曲目，尽可能优先返回热门曲目 */
  getArtistSongs?(artist: { id?: string; name: string }, count?: number): Promise<Song[]>
  /** 指定流派的曲目 */
  getGenreSongs?(genre: string, count?: number): Promise<Song[]>
  /** 与指定歌曲风格相近的曲目 */
  getSimilarSongs?(songId: string, count?: number): Promise<Song[]>

  // --- 服务端已提供、此前从未调用的能力 ---
  // 一律可选并做能力探测：Subsonic 有而 Jellyfin/Emby 没有（或反之）时，
  // 调用方应当把对应入口整个隐藏，而不是让用户点了没反应。

  /**
   * 跨设备续播：把队列与播放位置存到音乐服务器。
   * Subsonic savePlayQueue / getPlayQueue（API 1.12.0 起），不需要自建后端。
   */
  savePlayQueue?(songIds: string[], currentId: string, positionMs: number): Promise<void>
  getPlayQueue?(): Promise<{ songs: Song[]; currentId?: string; positionMs: number; changedBy?: string } | null>

  /** 长音轨断点：Subsonic createBookmark / getBookmarks / deleteBookmark */
  createBookmark?(songId: string, positionMs: number, comment?: string): Promise<void>
  getBookmarks?(): Promise<Array<{ song: Song; positionMs: number; comment?: string }>>
  deleteBookmark?(songId: string): Promise<void>

  /** 五星评分写回（字段早已映射并展示，此前只缺写入）*/
  setRating?(id: string, rating: number, type?: 'song' | 'album'): Promise<void>

  /** 专辑说明 / 乐评 */
  getAlbumInfo?(albumId: string, signal?: AbortSignal): Promise<{ notes?: string; musicBrainzId?: string; externalUrl?: string } | null>

  /** 多音乐库：把整个 App 限定到某一个库 */
  getMusicFolders?(): Promise<Array<{ id: string; name: string }>>

  /** 服务器上此刻还有谁在听 */
  getNowPlaying?(): Promise<Array<{ username: string; playerName?: string; minutesAgo?: number; song: Song }>>

  /** 公开分享链接 */
  createShare?(ids: string[], options?: { description?: string; expiresAt?: number }): Promise<{ id: string; url: string }>
  getShares?(): Promise<Array<{ id: string; url: string; description?: string; expiresAt?: number; visitCount?: number }>>
  deleteShare?(shareId: string): Promise<void>

  /** 从客户端触发扫描并观察进度 */
  startScan?(): Promise<void>
  getScanStatus?(): Promise<{ scanning: boolean; count?: number; folderCount?: number } | null>

  /** 能力协商：OpenSubsonic 扩展与服务器版本 */
  getServerCapabilities?(): Promise<ServerCapabilities>

  /** 精确播放上报（Jellyfin 会话生命周期 / OpenSubsonic reportPlayback）*/
  reportPlayback?(songId: string, state: { positionMs: number; isPaused?: boolean; event: 'start' | 'progress' | 'stop' }): Promise<void>
}

/** 服务器声明的能力，用于在 UI 上隐藏不受支持的入口 */
export interface ServerCapabilities {
  openSubsonic: boolean
  serverVersion?: string
  serverType?: string
  /** OpenSubsonic 扩展名 → 支持的版本号 */
  extensions: Record<string, number[]>
}
