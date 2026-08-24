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
  SongExtras,
  ServerCapabilities,
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
        'X-Emby-Authorization': `MediaBrowser Client="N1KO-MUSIC", Device="Web", DeviceId="msp-web", Version="1.0.0", Token="${config.token}"`,
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
              'MediaBrowser Client="N1KO-MUSIC", Device="Web", DeviceId="msp-web", Version="1.0.0"',
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

  /** Jellyfin/Emby 走标准 HTTP 语义：401/403 就是凭据失效 */
  async diagnose(): Promise<'ok' | 'unauthorized' | 'unreachable'> {
    try {
      await this.client.get('/System/Ping')
      return 'ok'
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status
      if (status === 401 || status === 403) return 'unauthorized'
      return 'unreachable'
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

  /**
   * 封面用哪个 ItemId 请求 /Images/Primary。
   * 音轨常有专辑图而无独立 Primary，用 track Id 会 404；有 ImageTags.Primary 时用本曲，否则用专辑。
   */
  private resolveSongCoverArtId(item: Record<string, unknown>): string | undefined {
    const tags = item.ImageTags as Record<string, string> | undefined
    if (tags?.Primary && item.Id) return String(item.Id)
    if (item.AlbumId) return String(item.AlbumId)
    if (item.Id) return String(item.Id)
    return undefined
  }

  /** Jellyfin 歌曲字段映射 */
  private mapSong(item: Record<string, unknown>): Song {
    const albumArtist = (item.AlbumArtists as Array<Record<string, string>> | undefined)?.[0]
    // ArtistItems 提供音轨歌手的 Name+Id 配对；AlbumArtists 是专辑歌手，合辑下两者不同，仅作回退
    const artistItem = (item.ArtistItems as Array<Record<string, string>> | undefined)?.[0]
    return {
      id: String(item.Id),
      title: String(item.Name || ''),
      artist: String(
        artistItem?.Name ||
        (item.Artists as string[] | undefined)?.[0] ||
        albumArtist?.Name ||
        item.AlbumArtist || ''
      ),
      artistId: artistItem?.Id ?? albumArtist?.Id,
      album: String(item.Album || ''),
      albumId: item.AlbumId ? String(item.AlbumId) : undefined,
      coverArt: this.resolveSongCoverArtId(item),
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
      // Jellyfin 侧此前连读都没有：评分与断点位置都躺在 UserData 里
      userRating: item.UserData
        ? Number((item.UserData as Record<string, unknown>).Rating) || undefined
        : undefined,
      ext: this.mapJellyfinExtras(item),
    }
  }

  /** 把 Jellyfin 的 MediaStreams / People / UserData 折算成统一的扩展元数据 */
  private mapJellyfinExtras(item: Record<string, unknown>): SongExtras | undefined {
    const ext: SongExtras = {}

    const audio = (item.MediaStreams as Array<Record<string, unknown>> | undefined)
      ?.find(s => s.Type === 'Audio')
    if (audio) {
      const bitDepth = Number(audio.BitDepth)
      if (Number.isFinite(bitDepth) && bitDepth) ext.bitDepth = bitDepth
      const sampleRate = Number(audio.SampleRate)
      if (Number.isFinite(sampleRate) && sampleRate) ext.samplingRate = sampleRate
      const channels = Number(audio.Channels)
      if (Number.isFinite(channels) && channels) ext.channelCount = channels
    }

    // Jellyfin 只有整轨增益，没有 album gain
    const normalization = Number(item.NormalizationGain)
    if (Number.isFinite(normalization) && normalization !== 0) {
      ext.replayGain = { trackGain: normalization }
    }

    const people = item.People as Array<Record<string, unknown>> | undefined
    if (Array.isArray(people) && people.length) {
      const contributors = people
        .filter(p => p.Name)
        .map(p => ({
          role: String(p.Role || p.Type || ''),
          name: String(p.Name),
          artistId: p.Id ? String(p.Id) : undefined,
        }))
      if (contributors.length) ext.contributors = contributors
    }

    const userData = item.UserData as Record<string, unknown> | undefined
    const ticks = Number(userData?.PlaybackPositionTicks)
    if (Number.isFinite(ticks) && ticks > 0) ext.bookmarkPosition = Math.floor(ticks / 10_000)

    const providerIds = item.ProviderIds as Record<string, unknown> | undefined
    if (providerIds?.MusicBrainzTrack) ext.musicBrainzId = String(providerIds.MusicBrainzTrack)

    return Object.keys(ext).length ? ext : undefined
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
        Fields: 'MediaStreams,RunTimeTicks,UserData,Genres,ImageTags',
        // 分页列表必须用确定性排序：Random 每次请求都重新洗牌，翻页会重复/漏项
        SortBy: 'SortName',
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

  async getSong(songId: string): Promise<Song | null> {
    try {
      const resp = await this.client.get(`/Items/${songId}`, {
        params: {
          UserId: this.userId,
          Fields: 'MediaStreams,RunTimeTicks,UserData,Genres,ImageTags,People,ProviderIds,NormalizationGain',
        },
      })
      return this.mapSong(resp.data as Record<string, unknown>)
    } catch {
      return null
    }
  }

  async searchAll(query: string, signal?: AbortSignal): Promise<SearchResult> {
    const [songs, albums, artists] = await Promise.all([
      this.client.get('/Items', {
        params: this.itemsParams({
          SearchTerm: query,
          IncludeItemTypes: 'Audio',
          Fields: 'MediaStreams,RunTimeTicks,UserData,ImageTags',
          Limit: 20,
        }),
        signal,
      }),
      this.client.get('/Items', {
        params: this.itemsParams({
          SearchTerm: query,
          IncludeItemTypes: 'MusicAlbum',
          Fields: 'RunTimeTicks,UserData,Genres',
          Limit: 10,
        }),
        signal,
      }),
      this.client.get('/Items', {
        params: this.itemsParams({
          SearchTerm: query,
          IncludeItemTypes: 'MusicArtist',
          Fields: 'UserData',
          Limit: 10,
        }),
        signal,
      }),
    ])
    return {
      songs: ((songs.data.Items ?? []) as Record<string, unknown>[]).map(this.mapSong.bind(this)),
      albums: ((albums.data.Items ?? []) as Record<string, unknown>[]).map(this.mapAlbum.bind(this)),
      artists: ((artists.data.Items ?? []) as Record<string, unknown>[]).map(this.mapArtist.bind(this)),
    }
  }

  getStreamUrl(
    songId: string,
    maxBitrate: number,
    format: string = '',
    _contentType?: string,
    _path?: string,
    _suffix?: string
  ): string {
    // 限码率时须从 Container 中去掉 flac/wav，否则服务器直连无损、忽略码率上限
    const container = format
      ? format
      : maxBitrate > 0
        ? 'opus,webm|opus,mp3,aac,m4a|aac,m4b|aac,ogg'
        : 'opus,webm|opus,mp3,aac,m4a|aac,m4b|aac,flac,webma,webm|webma,wav,ogg'
    // maxBitrate 单位为 kbps，Jellyfin MaxStreamingBitrate 单位为 bps
    const bitrateParam = maxBitrate > 0 ? `&MaxStreamingBitrate=${maxBitrate * 1000}` : ''
    return `${this.baseUrl}/Audio/${songId}/universal?UserId=${this.userId}&api_key=${this.token}&Container=${container}&TranscodingContainer=ts&TranscodingProtocol=hls&AudioCodec=aac${bitrateParam}`
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

  /**
   * 完整的播放会话生命周期。
   *
   * 此前只有 scrobble 会开一个会话（Sessions/Playing）却从不上报进度与停止，
   * 服务器那边的「播放中 / 继续播放」状态因此一直是错的，
   * 断点位置（UserData.PlaybackPositionTicks）也永远不会被写回。
   */
  async reportPlayback(
    songId: string,
    state: { positionMs: number; isPaused?: boolean; event: 'start' | 'progress' | 'stop' }
  ): Promise<void> {
    const ticks = Math.max(0, Math.round(state.positionMs)) * 10_000
    const body = {
      ItemId: songId,
      PositionTicks: ticks,
      IsPaused: !!state.isPaused,
      CanSeek: true,
      IsMuted: false,
      PlayMethod: 'DirectStream',
    }
    const path =
      state.event === 'start' ? '/Sessions/Playing'
      : state.event === 'stop' ? '/Sessions/Playing/Stopped'
      : '/Sessions/Playing/Progress'
    try {
      await this.client.post(path, body)
    } catch {
      // 上报失败不该影响播放
    }
  }

  /** 五星评分：Jellyfin 用 UserData 的 Rating 字段 */
  async setRating(id: string, rating: number): Promise<void> {
    const clamped = Math.max(0, Math.min(5, Math.round(rating)))
    await this.client.post(`/UserItems/${id}/UserData`, { Rating: clamped || null }, {
      params: { userId: this.userId },
    })
  }

  /** 长音轨断点：写回 UserData 的播放位置 */
  async createBookmark(songId: string, positionMs: number): Promise<void> {
    await this.client.post(
      `/UserItems/${songId}/UserData`,
      { PlaybackPositionTicks: Math.max(0, Math.round(positionMs)) * 10_000 },
      { params: { userId: this.userId } }
    )
  }

  async deleteBookmark(songId: string): Promise<void> {
    await this.client.post(
      `/UserItems/${songId}/UserData`,
      { PlaybackPositionTicks: 0 },
      { params: { userId: this.userId } }
    )
  }

  /** 多音乐库：Jellyfin 用户可见的媒体库视图 */
  async getMusicFolders(): Promise<Array<{ id: string; name: string }>> {
    try {
      const resp = await this.client.get(`/Users/${this.userId}/Views`)
      const items = (resp.data?.Items ?? []) as Array<Record<string, unknown>>
      return items
        .filter(v => v.CollectionType === 'music')
        .map(v => ({ id: String(v.Id), name: String(v.Name || v.Id) }))
    } catch {
      return []
    }
  }

  async getAlbumInfo(albumId: string): Promise<{
    notes?: string; musicBrainzId?: string; externalUrl?: string
  } | null> {
    try {
      const resp = await this.client.get(`/Users/${this.userId}/Items/${albumId}`, {
        params: { Fields: 'Overview,ProviderIds,ExternalUrls' },
      })
      const item = resp.data as Record<string, unknown>
      const notes = item.Overview ? String(item.Overview) : undefined
      const providerIds = item.ProviderIds as Record<string, unknown> | undefined
      const musicBrainzId = providerIds?.MusicBrainzAlbum
        ? String(providerIds.MusicBrainzAlbum)
        : undefined
      const externalUrl = (item.ExternalUrls as Array<Record<string, unknown>> | undefined)?.[0]?.Url
      if (!notes && !musicBrainzId && !externalUrl) return null
      return { notes, musicBrainzId, externalUrl: externalUrl ? String(externalUrl) : undefined }
    } catch {
      return null
    }
  }

  async getServerCapabilities(): Promise<ServerCapabilities> {
    try {
      const resp = await this.client.get('/System/Info/Public')
      const info = resp.data as Record<string, unknown>
      return {
        openSubsonic: false,
        serverVersion: info.Version ? String(info.Version) : undefined,
        serverType: info.ProductName ? String(info.ProductName) : this.type,
        extensions: {},
      }
    } catch {
      return { openSubsonic: false, extensions: {} }
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
        params: { UserId: this.userId, Fields: 'RunTimeTicks,UserData,Genres,Overview,ProviderIds' },
      }),
      this.client.get('/Items', {
        params: this.itemsParams({
          ParentId: albumId,
          IncludeItemTypes: 'Audio',
          Fields: 'MediaStreams,RunTimeTicks,UserData,ImageTags,People,ProviderIds,NormalizationGain',
          SortBy: 'IndexNumber,SortName',
        }),
      }),
    ])
    const album = this.mapAlbum(albumResp.data as Record<string, unknown>)
    const songs = ((songsResp.data.Items ?? []) as Record<string, unknown>[]).map(
      this.mapSong.bind(this)
    )
    // 唱片说明直接从同一次请求的 Overview / ProviderIds 里取，不额外发请求
    const raw = albumResp.data as Record<string, unknown>
    const providerIds = raw.ProviderIds as Record<string, unknown> | undefined
    return {
      ...album,
      songs,
      notes: raw.Overview ? String(raw.Overview) : undefined,
      musicBrainzId: providerIds?.MusicBrainzAlbum ? String(providerIds.MusicBrainzAlbum) : undefined,
    }
  }

  async getRecentAlbums(size = 20): Promise<Album[]> {
    const data = await this.getAlbums({ size, sortBy: 'DateCreated' })
    return data.items
  }

  async getRandomSongs(size = 50): Promise<Song[]> {
    const resp = await this.client.get('/Items', {
      params: this.itemsParams({
        IncludeItemTypes: 'Audio',
        Fields: 'MediaStreams,RunTimeTicks,UserData,Genres,ImageTags',
        SortBy: 'Random',
        Limit: size,
      }),
    })
    return ((resp.data.Items ?? []) as Record<string, unknown>[]).map(this.mapSong.bind(this))
  }

  /** 定向候选：失败时返回空数组，由推荐逻辑回退到随机候选 */
  private async audioItems(extra: Record<string, unknown>): Promise<Song[]> {
    try {
      const resp = await this.client.get('/Items', {
        params: this.itemsParams({
          IncludeItemTypes: 'Audio',
          Fields: 'MediaStreams,RunTimeTicks,UserData,Genres,ImageTags',
          ...extra,
        }),
      })
      return ((resp.data.Items ?? []) as Record<string, unknown>[]).map(this.mapSong.bind(this))
    } catch {
      return []
    }
  }

  async getArtistSongs(artist: { id?: string; name: string }, count = 30): Promise<Song[]> {
    if (!artist.id && !artist.name) return []
    return this.audioItems({
      ...(artist.id ? { ArtistIds: artist.id } : { Artists: artist.name }),
      SortBy: 'PlayCount,SortName',
      SortOrder: 'Descending',
      Limit: count,
    })
  }

  async getGenreSongs(genre: string, count = 30): Promise<Song[]> {
    if (!genre) return []
    return this.audioItems({ Genres: genre, SortBy: 'Random', Limit: count })
  }

  async getSimilarSongs(songId: string, count = 30): Promise<Song[]> {
    if (!songId) return []
    try {
      const resp = await this.client.get(`/Items/${songId}/Similar`, {
        params: {
          UserId: this.userId,
          Fields: 'MediaStreams,RunTimeTicks,UserData,Genres,ImageTags',
          Limit: count,
        },
      })
      return ((resp.data.Items ?? []) as Record<string, unknown>[]).map(this.mapSong.bind(this))
    } catch {
      return []
    }
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
          Fields: 'RunTimeTicks,UserData,ImageTags',
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
        params: { UserId: this.userId, Fields: 'MediaStreams,RunTimeTicks,UserData,ImageTags', MediaType: 'Audio' },
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

  /**
   * 从歌单移除。
   *
   * 调用方传的是**下标**（Subsonic 的 updatePlaylist 就是按下标删的，
   * 这个接口沿用了那套语义）。但 Jellyfin/Emby 的 EntryIds 要的是
   * **PlaylistItemId**——歌单条目自己的 GUID，既不是序号，也不是歌曲 id。
   *
   * 此前直接把下标当 GUID 发过去：匹配不到任何条目，服务端原样保存并
   * 返回 204，于是界面提示「已移除」而那首歌一直都在，用户反复删也删不掉。
   *
   * 所以这里先查一次条目列表，把下标翻译成真正的 PlaylistItemId。
   * 一次多余的请求换一个真能删掉的删除。
   *
   * 下标从大到小删：一次删多首时，先删小下标会让后面的下标全部前移。
   */
  async removeSongsFromPlaylist(playlistId: string, songIndexes: number[]): Promise<void> {
    if (!songIndexes.length) return
    const resp = await this.client.get(`/Playlists/${playlistId}/Items`, {
      params: { UserId: this.userId, MediaType: 'Audio' },
    })
    const items = (resp.data.Items ?? []) as Record<string, unknown>[]

    const entryIds = [...songIndexes]
      .sort((a, b) => b - a)
      .map(index => items[index]?.PlaylistItemId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)

    if (!entryIds.length) {
      // 下标全部越界说明调用方看到的列表和服务器已经不一致了。
      // 静默返回会让界面提示「已移除」而实际什么都没发生——这正是要修的那种谎。
      throw new Error('No matching playlist entries to remove')
    }

    await this.client.delete(`/Playlists/${playlistId}/Items`, {
      params: { EntryIds: entryIds.join(',') },
    })
  }

  async getStarred(): Promise<{ songs: Song[]; albums: Album[]; artists: Artist[] }> {
    const [songsResp, albumsResp, artistsResp] = await Promise.all([
      this.client.get('/Items', {
        params: this.itemsParams({
          IncludeItemTypes: 'Audio',
          Filters: 'IsFavorite',
          Fields: 'MediaStreams,RunTimeTicks,UserData,ImageTags',
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

  async updateSongMetadata(_songId: string, _metadata: { title?: string; album?: string; artist?: string; year?: number; genre?: string; track?: number }): Promise<void> {
    throw new Error('Jellyfin: updateSongMetadata not implemented')
  }

  async setLyrics(_songId: string, _lyrics: string): Promise<void> {
    throw new Error('Jellyfin: setLyrics not implemented')
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
