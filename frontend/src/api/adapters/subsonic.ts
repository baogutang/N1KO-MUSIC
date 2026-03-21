/**
 * Subsonic / Navidrome API 适配器
 *
 * 协议文档: http://www.subsonic.org/pages/api.jsp
 * Navidrome 完全兼容 Subsonic API，支持额外的扩展字段
 */

import axios, { type AxiosInstance } from 'axios'
import md5 from 'md5'
import type {
  MusicServerAdapter,
  ServerType,
  AuthResult,
  Song,
  Album,
  AlbumDetail,
  Artist,
  ArtistDetail,
  Playlist,
  PlaylistDetail,
  SearchResult,
  Lyrics,
  LyricLine,
  ListParams,
  PageResult,
} from '../types'

/** Subsonic 响应外层结构 */
interface SubsonicResponse<T = unknown> {
  'subsonic-response': {
    status: 'ok' | 'failed'
    version: string
    error?: { code: number; message: string }
  } & T
}

export class SubsonicAdapter implements MusicServerAdapter {
  readonly type: ServerType = 'subsonic'
  private client: AxiosInstance
  private baseUrl: string
  private username: string
  private token: string
  private salt: string

  constructor(config: { url: string; username: string; token: string; salt: string }) {
    this.baseUrl = config.url.replace(/\/$/, '')
    this.username = config.username
    this.token = config.token
    this.salt = config.salt

    this.client = axios.create({
      baseURL: `${this.baseUrl}/rest`,
      timeout: 30000,
    })
  }

  /** 构建 Subsonic API 公共参数 */
  private buildParams(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      u: this.username,
      t: this.token,
      s: this.salt,
      v: '1.16.1',
      c: 'MusicStreamPro',
      f: 'json',
      ...extra,
    }
  }

  /** 发送 Subsonic API 请求 */
  private async request<T>(endpoint: string, params: Record<string, unknown> = {}): Promise<T> {
    const response = await this.client.get<SubsonicResponse<T>>(endpoint, {
      params: this.buildParams(params),
    })
    const data = response.data['subsonic-response']
    if (data.status === 'failed') {
      throw new Error(data.error?.message || 'Subsonic API error')
    }
    return data as T
  }

  async login(url: string, username: string, password: string): Promise<AuthResult> {
    const salt = Math.random().toString(36).substring(2, 12)
    const token = md5(password + salt)
    const testUrl = url.replace(/\/$/, '')

    try {
      const resp = await axios.get(`${testUrl}/rest/ping`, {
        params: { u: username, t: token, s: salt, v: '1.16.1', c: 'MusicStreamPro', f: 'json' },
        timeout: 10000,
      })
      const data = resp.data['subsonic-response']
      if (data.status === 'ok') {
        return { success: true, token, salt, username }
      }
      return { success: false, token: '', error: data.error?.message || 'Authentication failed' }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Connection failed'
      return { success: false, token: '', error: message }
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.request('/ping')
      return true
    } catch {
      return false
    }
  }

  /** 将 Subsonic 歌曲对象转换为统一 Song 类型 */
  private mapSong(s: Record<string, unknown>): Song {
    return {
      id: String(s.id),
      title: String(s.title || ''),
      artist: String(s.artist || ''),
      artistId: s.artistId ? String(s.artistId) : undefined,
      album: String(s.album || ''),
      albumId: s.albumId ? String(s.albumId) : undefined,
      coverArt: s.coverArt ? String(s.coverArt) : undefined,
      duration: Number(s.duration) || 0,
      bitRate: s.bitRate ? Number(s.bitRate) : undefined,
      contentType: s.contentType ? String(s.contentType) : undefined,
      size: s.size ? Number(s.size) : undefined,
      track: s.track ? Number(s.track) : undefined,
      year: s.year ? Number(s.year) : undefined,
      genre: s.genre ? String(s.genre) : undefined,
      playCount: s.playCount ? Number(s.playCount) : undefined,
      starred: !!s.starred,
      userRating: s.userRating ? Number(s.userRating) : undefined,
      path: s.path ? String(s.path) : undefined,
    }
  }

  /** 将 Subsonic 专辑对象转换为统一 Album 类型 */
  private mapAlbum(a: Record<string, unknown>): Album {
    return {
      id: String(a.id),
      name: String(a.name || a.title || ''),
      artist: String(a.artist || ''),
      artistId: a.artistId ? String(a.artistId) : undefined,
      coverArt: a.coverArt ? String(a.coverArt) : undefined,
      songCount: a.songCount ? Number(a.songCount) : undefined,
      duration: a.duration ? Number(a.duration) : undefined,
      year: a.year ? Number(a.year) : undefined,
      genre: a.genre ? String(a.genre) : undefined,
      starred: !!a.starred,
      playCount: a.playCount ? Number(a.playCount) : undefined,
    }
  }

  /** 将 Subsonic 歌手对象转换为统一 Artist 类型 */
  private mapArtist(a: Record<string, unknown>): Artist {
    return {
      id: String(a.id),
      name: String(a.name || ''),
      albumCount: a.albumCount ? Number(a.albumCount) : undefined,
      coverArt: a.coverArt ? String(a.coverArt) : undefined,
      artistImageUrl: a.artistImageUrl ? String(a.artistImageUrl) : undefined,
      starred: !!a.starred,
    }
  }

  async getSongs(params: ListParams = {}): Promise<PageResult<Song>> {
    const data = await this.request<{
      albumList2?: { album?: unknown[] }
      songsByGenre?: { song?: unknown[] }
      randomSongs?: { song?: unknown[] }
    }>('/getRandomSongs', { size: params.size ?? 50 })
    const songs = ((data.randomSongs as Record<string, unknown[]> | undefined)?.song ?? []) as Record<string, unknown>[]
    return { items: songs.map(this.mapSong.bind(this)), offset: 0, size: songs.length }
  }

  async searchAll(query: string): Promise<SearchResult> {
    const data = await this.request<{
      searchResult3?: {
        song?: unknown[]
        album?: unknown[]
        artist?: unknown[]
      }
    }>('/search3', {
      query,
      songCount: 20,
      albumCount: 10,
      artistCount: 10,
      songOffset: 0,
      albumOffset: 0,
      artistOffset: 0,
    })
    const result = (data.searchResult3 ?? {}) as {
      song?: Record<string, unknown>[]
      album?: Record<string, unknown>[]
      artist?: Record<string, unknown>[]
    }
    return {
      songs: (result.song ?? []).map(this.mapSong.bind(this)),
      albums: (result.album ?? []).map(this.mapAlbum.bind(this)),
      artists: (result.artist ?? []).map(this.mapArtist.bind(this)),
    }
  }

  getStreamUrl(songId: string, maxBitrate: number, format: string = ''): string {
    // stream / getCoverArt 返回二进制数据，不需要 f（API 响应格式）参数
    const { f: _, ...authParams } = this.buildParams()
    const authEntries = Object.fromEntries(
      Object.entries(authParams).map(([k, v]) => [k, String(v)])
    )

    const streamParams: Record<string, string> = {
      id: songId,
      ...authEntries,
      maxBitRate: String(maxBitrate),
    }

    // 优先使用调用方指定的格式（如 opus 回退）
    // 否则：有损(maxBitrate>0)转码 mp3，无损(maxBitrate=0)不指定格式返回原文件
    if (format) {
      streamParams.format = format
    } else if (maxBitrate > 0) {
      streamParams.format = 'mp3'
    }

    const params = new URLSearchParams(streamParams)
    return `${this.baseUrl}/rest/stream?${params.toString()}`
  }

  getCoverUrl(id: string, size = 300): string {
    // getCoverArt 返回二进制图片，不需要 f（API 响应格式）参数
    const { f: _, ...authParams } = this.buildParams()
    const params = new URLSearchParams({
      id,
      size: String(size),
      ...Object.fromEntries(
        Object.entries(authParams).map(([k, v]) => [k, String(v)])
      ),
    })
    return `${this.baseUrl}/rest/getCoverArt?${params.toString()}`
  }

  async getLyrics(songId: string, title?: string, artist?: string): Promise<Lyrics | null> {
    // 优先使用 OpenSubsonic 扩展接口 getLyricsBySongId（返回带时间戳的结构化歌词）
    try {
      const extData = await this.request<{
        lyricsList?: {
          structuredLyrics?: Array<{
            displayArtist?: string
            displayTitle?: string
            lang?: string
            offset?: number
            synced?: boolean
            line?: Array<{ start?: number; value?: string }>
          }>
        }
      }>('/getLyricsBySongId', { id: songId })

      const list = extData.lyricsList?.structuredLyrics ?? []
      if (list.length > 0) {
        // 优先取 synced=true 的歌词，否则取第一个
        const preferred = list.find(l => l.synced) ?? list[0]
        const offset = preferred.offset ?? 0
        const lines: LyricLine[] = (preferred.line ?? []).map(l => ({
          // start 单位是毫秒，offset 是整体偏移（毫秒）
          time: l.start !== undefined && l.start !== null ? Math.max(0, l.start + offset) : 0,
          text: l.value ?? '',
        })).filter(l => l.text)
        return {
          songId,
          title: preferred.displayTitle,
          artist: preferred.displayArtist,
          lines,
          synced: preferred.synced ?? lines.some(l => l.time > 0),
        }
      }
    } catch {
      // 服务器不支持 OpenSubsonic 扩展，降级到旧接口
    }

    // 降级：使用旧版 getLyrics（返回纯文本，无时间戳）
    try {
      const data = await this.request<{
        lyrics?: { value?: string; title?: string; artist?: string }
      }>('/getLyrics', { id: songId, title, artist })
      const raw = (data.lyrics as Record<string, unknown> | undefined)?.value as string | undefined
      if (!raw) return null
      const lines = parseLrcText(raw)
      return {
        songId,
        title: (data.lyrics as Record<string, unknown> | undefined)?.title as string | undefined,
        artist: (data.lyrics as Record<string, unknown> | undefined)?.artist as string | undefined,
        lines,
        synced: lines.some(l => l.time > 0),
      }
    } catch {
      return null
    }
  }

  async scrobble(songId: string, submission = true): Promise<void> {
    await this.request('/scrobble', { id: songId, submission })
  }

  async getAlbums(params: ListParams = {}): Promise<PageResult<Album>> {
    const type = params.type ?? 'newest'
    const data = await this.request<{
      albumList2?: { album?: unknown[] }
    }>('/getAlbumList2', {
      type,
      size: params.size ?? 50,
      offset: params.offset ?? 0,
      fromYear: params.fromYear,
      toYear: params.toYear,
      genre: params.genre,
    })
    const albums = ((data.albumList2 as Record<string, unknown[]> | undefined)?.album ?? []) as Record<string, unknown>[]
    return { items: albums.map(this.mapAlbum.bind(this)), offset: params.offset ?? 0, size: albums.length }
  }

  async getAlbumDetail(albumId: string): Promise<AlbumDetail> {
    const data = await this.request<{ album?: Record<string, unknown> }>('/getAlbum', { id: albumId })
    const album = (data.album ?? {}) as Record<string, unknown>
    const songs = ((album.song ?? []) as Record<string, unknown>[]).map(this.mapSong.bind(this))
    return { ...this.mapAlbum(album), songs }
  }

  async getRecentAlbums(size = 20): Promise<Album[]> {
    const data = await this.getAlbums({ type: 'newest', size })
    return data.items
  }

  async getRandomSongs(size = 50): Promise<Song[]> {
    const data = await this.request<{ randomSongs?: { song?: unknown[] } }>('/getRandomSongs', { size })
    const songs = ((data.randomSongs as Record<string, unknown[]> | undefined)?.song ?? []) as Record<string, unknown>[]
    return songs.map(this.mapSong.bind(this))
  }

  async getArtists(): Promise<Artist[]> {
    const data = await this.request<{
      artists?: { index?: Array<{ artist?: unknown[] }> }
    }>('/getArtists')
    const indexes = (data.artists as Record<string, unknown> | undefined)?.index as Array<Record<string, unknown>> | undefined ?? []
    const artists: Artist[] = []
    for (const index of indexes) {
      const list = (index.artist ?? []) as Record<string, unknown>[]
      artists.push(...list.map(this.mapArtist.bind(this)))
    }
    return artists
  }

  async getArtistDetail(artistId: string): Promise<ArtistDetail> {
    // Phase 1: 基本信息（并行）
    const [artistData, infoData] = await Promise.allSettled([
      this.request<{ artist?: Record<string, unknown> }>('/getArtist', { id: artistId }),
      this.request<{ artistInfo2?: Record<string, unknown> }>('/getArtistInfo2', { id: artistId }),
    ])
    const artist = artistData.status === 'fulfilled'
      ? (artistData.value.artist ?? {}) as Record<string, unknown>
      : {}
    const info = infoData.status === 'fulfilled'
      ? ((infoData.value.artistInfo2 ?? {}) as Record<string, unknown>)
      : {}
    const albums = ((artist.album ?? []) as Record<string, unknown>[]).map(this.mapAlbum.bind(this))
    const similarArtists = ((info.similarArtist ?? []) as Record<string, unknown>[]).map(this.mapArtist.bind(this))

    const artistName = String(artist.name || '')

    // Phase 2: 热门歌曲 + 全部专辑歌曲（并行）
    const topSongsPromise = artistName
      ? this.request<{ topSongs?: { song?: unknown[] } }>('/getTopSongs', { artist: artistName, count: 50 })
          .catch(() => null)
      : Promise.resolve(null)
    const albumSongPromises = albums.map(a =>
      this.request<{ album?: Record<string, unknown> }>('/getAlbum', { id: a.id })
        .catch(() => null)
    )
    const [topSongsResult, ...albumResults] = await Promise.all([topSongsPromise, ...albumSongPromises])

    const topSongs = topSongsResult
      ? (((topSongsResult.topSongs as Record<string, unknown> | undefined)?.song ?? []) as Record<string, unknown>[]).map(this.mapSong.bind(this))
      : []

    // 从所有专辑中聚合歌曲，按专辑 → 曲目号排序
    const allSongs = albumResults
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .flatMap(r => {
        const album = (r.album ?? {}) as Record<string, unknown>
        return ((album.song ?? []) as Record<string, unknown>[]).map(this.mapSong.bind(this))
      })

    return {
      ...this.mapArtist(artist),
      biography: info.biography as string | undefined,
      musicBrainzId: info.musicBrainzId as string | undefined,
      lastFmUrl: info.lastFmUrl as string | undefined,
      albums,
      topSongs,
      songs: allSongs,
      similarArtists,
    }
  }

  async getPlaylists(): Promise<Playlist[]> {
    const data = await this.request<{ playlists?: { playlist?: unknown[] } }>('/getPlaylists')
    const list = ((data.playlists as Record<string, unknown[]> | undefined)?.playlist ?? []) as Record<string, unknown>[]
    return list.map(p => ({
      id: String(p.id),
      name: String(p.name || ''),
      comment: p.comment ? String(p.comment) : undefined,
      owner: p.owner ? String(p.owner) : undefined,
      songCount: p.songCount ? Number(p.songCount) : undefined,
      duration: p.duration ? Number(p.duration) : undefined,
      coverArt: p.coverArt ? String(p.coverArt) : undefined,
      isPublic: !!p.public,
      created: p.created ? String(p.created) : undefined,
    }))
  }

  async getPlaylistDetail(playlistId: string): Promise<PlaylistDetail> {
    const data = await this.request<{ playlist?: Record<string, unknown> }>('/getPlaylist', { id: playlistId })
    const pl = (data.playlist ?? {}) as Record<string, unknown>
    const songs = ((pl.entry ?? []) as Record<string, unknown>[]).map(this.mapSong.bind(this))
    return {
      id: String(pl.id),
      name: String(pl.name || ''),
      comment: pl.comment ? String(pl.comment) : undefined,
      owner: pl.owner ? String(pl.owner) : undefined,
      songCount: songs.length,
      coverArt: pl.coverArt ? String(pl.coverArt) : undefined,
      isPublic: !!pl.public,
      songs,
    }
  }

  async createPlaylist(name: string, songIds: string[] = []): Promise<Playlist> {
    const data = await this.request<{ playlist?: Record<string, unknown> }>('/createPlaylist', {
      name,
      songId: songIds,
    })
    const pl = (data.playlist ?? { id: '', name }) as Record<string, unknown>
    return { id: String(pl.id), name: String(pl.name || name) }
  }

  async updatePlaylist(playlistId: string, name?: string, comment?: string): Promise<void> {
    await this.request('/updatePlaylist', { playlistId, name, comment })
  }

  async deletePlaylist(playlistId: string): Promise<void> {
    await this.request('/deletePlaylist', { id: playlistId })
  }

  async addSongsToPlaylist(playlistId: string, songIds: string[]): Promise<void> {
    await this.request('/updatePlaylist', { playlistId, songIdToAdd: songIds })
  }

  async removeSongsFromPlaylist(playlistId: string, songIndexes: number[]): Promise<void> {
    await this.request('/updatePlaylist', { playlistId, songIndexToRemove: songIndexes })
  }

  async getStarred(): Promise<{ songs: Song[]; albums: Album[]; artists: Artist[] }> {
    const data = await this.request<{
      starred2?: { song?: unknown[]; album?: unknown[]; artist?: unknown[] }
    }>('/getStarred2')
    const starred = (data.starred2 ?? {}) as {
      song?: Record<string, unknown>[]
      album?: Record<string, unknown>[]
      artist?: Record<string, unknown>[]
    }
    return {
      songs: (starred.song ?? []).map(this.mapSong.bind(this)),
      albums: (starred.album ?? []).map(this.mapAlbum.bind(this)),
      artists: (starred.artist ?? []).map(this.mapArtist.bind(this)),
    }
  }

  async star(id: string, type: 'song' | 'album' | 'artist'): Promise<void> {
    const paramKey = type === 'song' ? 'id' : type === 'album' ? 'albumId' : 'artistId'
    await this.request('/star', { [paramKey]: id })
  }

  async unstar(id: string, type: 'song' | 'album' | 'artist'): Promise<void> {
    const paramKey = type === 'song' ? 'id' : type === 'album' ? 'albumId' : 'artistId'
    await this.request('/unstar', { [paramKey]: id })
  }

  async getGenres(): Promise<Array<{ name: string; songCount: number; albumCount: number }>> {
    const data = await this.request<{
      genres?: { genre?: unknown[] }
    }>('/getGenres')
    const genres = ((data.genres as Record<string, unknown[]> | undefined)?.genre ?? []) as Record<string, unknown>[]
    return genres.map(g => ({
      name: String(g.value || g.name || ''),
      songCount: Number(g.songCount) || 0,
      albumCount: Number(g.albumCount) || 0,
    }))
  }
}

/**
 * 解析 LRC 格式歌词文本
 * 支持标准 LRC 和增强 LRC 格式
 */
export function parseLrcText(text: string): LyricLine[] {
  if (!text?.trim()) return []

  const lines: LyricLine[] = []
  const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/g
  const rows = text.split('\n')

  for (const row of rows) {
    const trimmed = row.trim()
    if (!trimmed) continue

    // 提取时间戳
    const times: number[] = []
    let match: RegExpExecArray | null
    timeRegex.lastIndex = 0
    while ((match = timeRegex.exec(trimmed)) !== null) {
      const min = parseInt(match[1])
      const sec = parseInt(match[2])
      const ms = match[3].length === 2 ? parseInt(match[3]) * 10 : parseInt(match[3])
      times.push(min * 60000 + sec * 1000 + ms)
    }

    // 提取歌词文本（去除所有时间标签）
    const lyricText = trimmed.replace(/\[\d{2}:\d{2}\.\d{2,3}\]/g, '').trim()
    if (!lyricText) continue

    for (const time of times) {
      lines.push({ time, text: lyricText })
    }

    // 无时间戳的纯文本行
    if (times.length === 0 && !trimmed.startsWith('[')) {
      lines.push({ time: 0, text: lyricText })
    }
  }

  return lines.sort((a, b) => a.time - b.time)
}
