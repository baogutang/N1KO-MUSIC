/**
 * Jellyfin API 适配器
 *
 * API 文档: https://api.jellyfin.org/
 * Jellyfin 使用 REST API，基于 token 认证
 */

import axios, { type AxiosInstance } from 'axios'
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
  ListParams,
  PageResult,
} from '../types'
import { parseLrcText } from './subsonic'

export class JellyfinAdapter implements MusicServerAdapter {
  readonly type: ServerType = 'jellyfin'
  private client: AxiosInstance
  private baseUrl: string
  private token: string
  private userId: string

  constructor(config: { url: string; token: string; userId: string }) {
    this.baseUrl = config.url.replace(/\/$/, '')
    this.token = config.token
    this.userId = config.userId

    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: {
        'X-Emby-Authorization': `MediaBrowser Client="MusicStreamPro", Device="Web", DeviceId="msp-web", Version="1.0.0", Token="${config.token}"`,
        'Content-Type': 'application/json',
      },
    })
  }

  async login(url: string, username: string, password: string): Promise<AuthResult> {
    const cleanUrl = url.replace(/\/$/, '')
    try {
      const resp = await axios.post(
        `${cleanUrl}/Users/AuthenticateByName`,
        { Username: username, Pw: password },
        {
          headers: {
            'X-Emby-Authorization':
              'MediaBrowser Client="MusicStreamPro", Device="Web", DeviceId="msp-web", Version="1.0.0"',
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        }
      )
      const data = resp.data
      return {
        success: true,
        token: data.AccessToken,
        userId: data.User?.Id,
        username: data.User?.Name,
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Connection failed'
      return { success: false, token: '', error: message }
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.client.get('/System/Ping')
      return true
    } catch {
      return false
    }
  }

  /** Jellyfin 歌曲字段映射 */
  private mapSong(item: Record<string, unknown>): Song {
    const albumArtist = (item.AlbumArtists as Array<Record<string, string>> | undefined)?.[0]
    return {
      id: String(item.Id),
      title: String(item.Name || ''),
      artist: String(
        (item.Artists as string[] | undefined)?.[0] ||
        albumArtist?.Name ||
        item.AlbumArtist || ''
      ),
      artistId: albumArtist?.Id,
      album: String(item.Album || ''),
      albumId: item.AlbumId ? String(item.AlbumId) : undefined,
      coverArt: item.Id ? String(item.Id) : undefined,
      duration: Math.floor((Number(item.RunTimeTicks) || 0) / 10_000_000),
      bitRate: item.MediaStreams
        ? Math.floor(
            ((item.MediaStreams as Array<Record<string, unknown>>).find(s => s.Type === 'Audio')
              ?.BitRate as number || 0) / 1000
          )
        : undefined,
      track: item.IndexNumber ? Number(item.IndexNumber) : undefined,
      year: item.ProductionYear ? Number(item.ProductionYear) : undefined,
      genre: (item.Genres as string[] | undefined)?.[0],
      playCount: item.UserData
        ? Number((item.UserData as Record<string, unknown>).PlayCount) || 0
        : undefined,
      starred: item.UserData
        ? !!(item.UserData as Record<string, unknown>).IsFavorite
        : false,
    }
  }

  /** Jellyfin 专辑字段映射 */
  private mapAlbum(item: Record<string, unknown>): Album {
    const artistItem = (item.AlbumArtists as Array<Record<string, string>> | undefined)?.[0]
    return {
      id: String(item.Id),
      name: String(item.Name || ''),
      artist: String(artistItem?.Name || item.AlbumArtist || ''),
      artistId: artistItem?.Id,
      coverArt: String(item.Id),
      songCount: item.ChildCount ? Number(item.ChildCount) : undefined,
      duration: Math.floor((Number(item.RunTimeTicks) || 0) / 10_000_000),
      year: item.ProductionYear ? Number(item.ProductionYear) : undefined,
      genre: (item.Genres as string[] | undefined)?.[0],
      starred: item.UserData
        ? !!(item.UserData as Record<string, unknown>).IsFavorite
        : false,
    }
  }

  /** Jellyfin 歌手字段映射 */
  private mapArtist(item: Record<string, unknown>): Artist {
    return {
      id: String(item.Id),
      name: String(item.Name || ''),
      coverArt: String(item.Id),
      artistImageUrl: `${this.baseUrl}/Items/${item.Id}/Images/Primary`,
      starred: item.UserData
        ? !!(item.UserData as Record<string, unknown>).IsFavorite
        : false,
    }
  }

  /** 构建通用 Items 查询参数 */
  private itemsParams(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      UserId: this.userId,
      Recursive: true,
      ...extra,
    }
  }

  async getSongs(params: ListParams = {}): Promise<PageResult<Song>> {
    const resp = await this.client.get('/Items', {
      params: this.itemsParams({
        IncludeItemTypes: 'Audio',
        Fields: 'MediaStreams,RunTimeTicks,UserData,Genres',
        SortBy: 'Random',
        Limit: params.size ?? 50,
        StartIndex: params.offset ?? 0,
      }),
    })
    const items = (resp.data.Items ?? []) as Record<string, unknown>[]
    return {
      items: items.map(this.mapSong.bind(this)),
      total: resp.data.TotalRecordCount,
      offset: params.offset ?? 0,
      size: items.length,
    }
  }

  async searchAll(query: string): Promise<SearchResult> {
    const [songs, albums, artists] = await Promise.all([
      this.client.get('/Items', {
        params: this.itemsParams({
          SearchTerm: query,
          IncludeItemTypes: 'Audio',
          Fields: 'MediaStreams,RunTimeTicks,UserData',
          Limit: 20,
        }),
      }),
      this.client.get('/Items', {
        params: this.itemsParams({
          SearchTerm: query,
          IncludeItemTypes: 'MusicAlbum',
          Fields: 'RunTimeTicks,UserData,Genres',
          Limit: 10,
        }),
      }),
      this.client.get('/Items', {
        params: this.itemsParams({
          SearchTerm: query,
          IncludeItemTypes: 'MusicArtist',
          Fields: 'UserData',
          Limit: 10,
        }),
      }),
    ])
    return {
      songs: ((songs.data.Items ?? []) as Record<string, unknown>[]).map(this.mapSong.bind(this)),
      albums: ((albums.data.Items ?? []) as Record<string, unknown>[]).map(this.mapAlbum.bind(this)),
      artists: ((artists.data.Items ?? []) as Record<string, unknown>[]).map(this.mapArtist.bind(this)),
    }
  }

  getStreamUrl(songId: string, _maxBitrate: number, _format: string = ''): string {
    return `${this.baseUrl}/Audio/${songId}/universal?UserId=${this.userId}&api_key=${this.token}&Container=opus,webm|opus,mp3,aac,m4a|aac,m4b|aac,flac,webma,webm|webma,wav,ogg&TranscodingContainer=ts&TranscodingProtocol=hls&AudioCodec=aac`
  }

  getCoverUrl(id: string, size = 300): string {
    return `${this.baseUrl}/Items/${id}/Images/Primary?maxWidth=${size}&quality=96&api_key=${this.token}`
  }

  async getLyrics(songId: string): Promise<Lyrics | null> {
    try {
      const resp = await this.client.get(`/Audio/${songId}/Lyrics`)
      const lyrics = resp.data
      if (!lyrics?.Lyrics?.length) return null
      const lines = (lyrics.Lyrics as Array<{ Start: number; Text: string }>).map(l => ({
        time: Math.floor(l.Start / 10000),
        text: l.Text,
      }))
      return { songId, lines, synced: lines.some(l => l.time > 0) }
    } catch {
      // 尝试从内嵌 LRC 获取
      try {
        const resp = await this.client.get(`/Items/${songId}/Lyrics`)
        const rawLrc = typeof resp.data === 'string' ? resp.data : ''
        if (rawLrc) {
          const lines = parseLrcText(rawLrc)
          return { songId, lines, synced: lines.some(l => l.time > 0) }
        }
      } catch {
        // ignore
      }
      return null
    }
  }

  async scrobble(songId: string, submission = true): Promise<void> {
    if (submission) {
      await this.client.post(`/Users/${this.userId}/PlayedItems/${songId}`)
    } else {
      await this.client.post(`/Sessions/Playing`, {
        ItemId: songId,
        CanSeek: true,
        IsPaused: false,
        IsMuted: false,
        PlayMethod: 'DirectStream',
      })
    }
  }

  async getAlbums(params: ListParams = {}): Promise<PageResult<Album>> {
    const resp = await this.client.get('/Items', {
      params: this.itemsParams({
        IncludeItemTypes: 'MusicAlbum',
        Fields: 'RunTimeTicks,UserData,Genres',
        SortBy: params.sortBy ?? 'DateCreated',
        SortOrder: 'Descending',
        Limit: params.size ?? 50,
        StartIndex: params.offset ?? 0,
        Genres: params.genre,
      }),
    })
    const items = (resp.data.Items ?? []) as Record<string, unknown>[]
    return {
      items: items.map(this.mapAlbum.bind(this)),
      total: resp.data.TotalRecordCount,
      offset: params.offset ?? 0,
      size: items.length,
    }
  }

  async getAlbumDetail(albumId: string): Promise<AlbumDetail> {
    const [albumResp, songsResp] = await Promise.all([
      this.client.get(`/Items/${albumId}`, {
        params: { UserId: this.userId, Fields: 'RunTimeTicks,UserData,Genres' },
      }),
      this.client.get('/Items', {
        params: this.itemsParams({
          ParentId: albumId,
          IncludeItemTypes: 'Audio',
          Fields: 'MediaStreams,RunTimeTicks,UserData',
          SortBy: 'IndexNumber,SortName',
        }),
      }),
    ])
    const album = this.mapAlbum(albumResp.data as Record<string, unknown>)
    const songs = ((songsResp.data.Items ?? []) as Record<string, unknown>[]).map(
      this.mapSong.bind(this)
    )
    return { ...album, songs }
  }

  async getRecentAlbums(size = 20): Promise<Album[]> {
    const data = await this.getAlbums({ size, sortBy: 'DateCreated' })
    return data.items
  }

  async getRandomSongs(size = 50): Promise<Song[]> {
    const data = await this.getSongs({ size })
    return data.items
  }

  async getArtists(): Promise<Artist[]> {
    const resp = await this.client.get('/Artists', {
      params: {
        UserId: this.userId,
        Fields: 'UserData',
        Recursive: true,
        Limit: 500,
      },
    })
    return ((resp.data.Items ?? []) as Record<string, unknown>[]).map(this.mapArtist.bind(this))
  }

  async getArtistDetail(artistId: string): Promise<ArtistDetail> {
    const [artistResp, albumsResp, songsResp] = await Promise.all([
      this.client.get(`/Items/${artistId}`, {
        params: { UserId: this.userId, Fields: 'UserData,Overview' },
      }),
      this.client.get('/Items', {
        params: this.itemsParams({
          ArtistIds: artistId,
          IncludeItemTypes: 'MusicAlbum',
          Fields: 'RunTimeTicks,UserData',
          SortBy: 'ProductionYear',
          SortOrder: 'Descending',
        }),
      }),
      this.client.get('/Items', {
        params: this.itemsParams({
          ArtistIds: artistId,
          IncludeItemTypes: 'Audio',
          Fields: 'RunTimeTicks,UserData',
          SortBy: 'Album,IndexNumber',
          SortOrder: 'Ascending',
          Limit: 500,
        }),
      }),
    ])
    const artist = this.mapArtist(artistResp.data as Record<string, unknown>)
    const albums = ((albumsResp.data.Items ?? []) as Record<string, unknown>[]).map(
      this.mapAlbum.bind(this)
    )
    const songs = ((songsResp.data.Items ?? []) as Record<string, unknown>[]).map(
      this.mapSong.bind(this)
    )
    return {
      ...artist,
      biography: (artistResp.data as Record<string, unknown>).Overview as string | undefined,
      albums,
      songs,
    }
  }

  async getPlaylists(): Promise<Playlist[]> {
    const resp = await this.client.get('/Items', {
      params: this.itemsParams({
        IncludeItemTypes: 'Playlist',
        Fields: 'UserData',
        MediaTypes: 'Audio',
      }),
    })
    return ((resp.data.Items ?? []) as Record<string, unknown>[]).map(p => ({
      id: String(p.Id),
      name: String(p.Name || ''),
      songCount: p.ChildCount ? Number(p.ChildCount) : undefined,
      coverArt: String(p.Id),
    }))
  }

  async getPlaylistDetail(playlistId: string): Promise<PlaylistDetail> {
    const [plResp, songsResp] = await Promise.all([
      this.client.get(`/Items/${playlistId}`, { params: { UserId: this.userId } }),
      this.client.get(`/Playlists/${playlistId}/Items`, {
        params: { UserId: this.userId, Fields: 'MediaStreams,RunTimeTicks,UserData', MediaType: 'Audio' },
      }),
    ])
    const songs = ((songsResp.data.Items ?? []) as Record<string, unknown>[]).map(
      this.mapSong.bind(this)
    )
    return {
      id: String(plResp.data.Id),
      name: String(plResp.data.Name || ''),
      songs,
      songCount: songs.length,
      coverArt: String(plResp.data.Id),
    }
  }

  async createPlaylist(name: string, songIds: string[] = []): Promise<Playlist> {
    const resp = await this.client.post('/Playlists', {
      Name: name,
      Ids: songIds,
      UserId: this.userId,
      MediaType: 'Audio',
    })
    return { id: String(resp.data.Id), name }
  }

  async updatePlaylist(playlistId: string, name?: string): Promise<void> {
    if (name) {
      await this.client.post(`/Items/${playlistId}`, { Name: name })
    }
  }

  async deletePlaylist(playlistId: string): Promise<void> {
    await this.client.delete(`/Items/${playlistId}`)
  }

  async addSongsToPlaylist(playlistId: string, songIds: string[]): Promise<void> {
    await this.client.post(`/Playlists/${playlistId}/Items`, null, {
      params: { Ids: songIds.join(','), UserId: this.userId },
    })
  }

  async removeSongsFromPlaylist(playlistId: string, songIndexes: number[]): Promise<void> {
    for (const index of songIndexes) {
      await this.client.delete(`/Playlists/${playlistId}/Items`, {
        params: { EntryIds: String(index) },
      })
    }
  }

  async getStarred(): Promise<{ songs: Song[]; albums: Album[]; artists: Artist[] }> {
    const [songsResp, albumsResp, artistsResp] = await Promise.all([
      this.client.get('/Items', {
        params: this.itemsParams({
          IncludeItemTypes: 'Audio',
          Filters: 'IsFavorite',
          Fields: 'MediaStreams,RunTimeTicks,UserData',
          Recursive: true,
        }),
      }),
      this.client.get('/Items', {
        params: this.itemsParams({
          IncludeItemTypes: 'MusicAlbum',
          Filters: 'IsFavorite',
          Fields: 'RunTimeTicks,UserData',
          Recursive: true,
        }),
      }),
      this.client.get('/Artists', {
        params: { UserId: this.userId, IsFavorite: true },
      }),
    ])
    return {
      songs: ((songsResp.data.Items ?? []) as Record<string, unknown>[]).map(this.mapSong.bind(this)),
      albums: ((albumsResp.data.Items ?? []) as Record<string, unknown>[]).map(this.mapAlbum.bind(this)),
      artists: ((artistsResp.data.Items ?? []) as Record<string, unknown>[]).map(this.mapArtist.bind(this)),
    }
  }

  async star(id: string): Promise<void> {
    await this.client.post(`/Users/${this.userId}/FavoriteItems/${id}`)
  }

  async unstar(id: string): Promise<void> {
    await this.client.delete(`/Users/${this.userId}/FavoriteItems/${id}`)
  }

  async getGenres(): Promise<Array<{ name: string; songCount: number; albumCount: number }>> {
    const resp = await this.client.get('/MusicGenres', {
      params: { UserId: this.userId },
    })
    return ((resp.data.Items ?? []) as Record<string, unknown>[]).map(g => ({
      name: String(g.Name || ''),
      songCount: 0,
      albumCount: 0,
    }))
  }
}
