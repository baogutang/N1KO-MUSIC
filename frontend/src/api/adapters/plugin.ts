/**
 * PluginAdapter：把沙箱里的插件映射成 MusicServerAdapter（PLAN 1.3）。
 *
 * 必选方法照接口实现（插件做不到的返回空或抛 unsupported）；可选方法按
 * manifest capabilities 与沙箱回报的 methods **有则挂、无则不定义**——
 * 能力探测（typeof a.xxx === 'function'）因此自然隐藏对应入口。
 *
 * 播放侧的关键差异：流地址来自异步 getMediaSource（挂成 resolveStreamUrl），
 * getStreamUrl 同步语义下直接抛错，播放引擎（0.3 起）会优先走 resolveStreamUrl。
 */

import { parseLrcText } from './subsonic'
import type {
  Album,
  AlbumDetail,
  Artist,
  ArtistDetail,
  AuthResult,
  Lyrics,
  MusicServerAdapter,
  PageResult,
  Playlist,
  PlaylistDetail,
  SearchResult,
  ServerType,
  Song,
  SourceCapabilities,
} from '../types'
import type {
  AlbumItem,
  ArtistItem,
  MediaDetailResult,
  MusicItem,
  Paged,
  PluginManifest,
  SheetItem,
  TopListGroup,
} from '@/plugins/types'
import {
  getRawItem,
  mapAlbumItem,
  mapArtistItem,
  mapMusicItem,
  mapQuality,
  mapSheetItem,
  minimalMusicItem,
  type PluginQuality,
} from '@/plugins/mapping'

/** 沙箱宿主的最小面：适配器只依赖这两个方法，测试用假实现顶上 */
export interface PluginHostLike {
  call<T = unknown>(method: string, ...args: unknown[]): Promise<T>
  hasMethod(method: string): boolean
}

/** 分页拉全的上限（PLAN 1.3：分页拉全歌单上限 2000 条） */
const FETCH_ALL_CAP = 2000

export interface PluginAdapterConfig {
  serverId: string
  manifest: PluginManifest
  host: PluginHostLike
}

export class PluginAdapter implements MusicServerAdapter {
  readonly type: ServerType = 'plugin'
  protected serverId: string
  readonly manifest: PluginManifest
  protected host: PluginHostLike

  // 可选能力：mountOptionalMethods 按沙箱回报的方法决定挂不挂（缺省不存在，
  // 能力探测 typeof a.xxx === 'function' 因此为 false，入口自然隐藏）
  resolveStreamUrl?: MusicServerAdapter['resolveStreamUrl']
  getTopLists?: MusicServerAdapter['getTopLists']
  getTopListDetail?: MusicServerAdapter['getTopListDetail']
  getRecommendSheets?: MusicServerAdapter['getRecommendSheets']

  constructor(config: PluginAdapterConfig) {
    this.serverId = config.serverId
    this.manifest = config.manifest
    this.host = config.host
    this.mountOptionalMethods()
  }

  // --- 认证（插件登录走 Login 页的 QR/Cookie 流程，不经过这里） ---

  async login(_url: string, _username: string, _password: string): Promise<AuthResult> {
    return { success: false, token: '', error: 'Plugin sources log in via QR or cookie, not username/password' }
  }

  async ping(): Promise<boolean> {
    // 沙箱 ready 即视为可达；凭据有效性由 n1ko.auth.getUser 的定期检查负责
    return true
  }

  // --- 歌曲 / 搜索 ---

  async getSongs(): Promise<PageResult<Song>> {
    // 插件音源没有「全库浏览」（libraryBrowse 一般为 false）
    return { items: [], total: 0, offset: 0, size: 0 }
  }

  async getSong(songId: string): Promise<Song | null> {
    const raw = this.rawSong({ id: songId })
    if (!raw) return null
    // 缓存里只有最小项时无从补全——直接以最小形状返回，调用方按需再取详情
    return mapMusicItem(raw, this.serverId)
  }

  async searchAll(query: string): Promise<SearchResult> {
    const result: SearchResult = { songs: [], albums: [], artists: [], playlists: [] }
    if (!this.capability('search')) return result
    const paged = await this.host.call<Paged<MusicItem | AlbumItem | ArtistItem | SheetItem>>('search', query, 1, 'music')
    result.songs = (paged.data ?? []).filter(isMusicItemShape).map(i => mapMusicItem(i as MusicItem, this.serverId))
    if (this.host.hasMethod('search')) {
      const [albums, artists, sheets] = await Promise.allSettled([
        this.host.call<Paged<AlbumItem>>('search', query, 1, 'album'),
        this.host.call<Paged<ArtistItem>>('search', query, 1, 'artist'),
        this.host.call<Paged<SheetItem>>('search', query, 1, 'sheet'),
      ])
      if (albums.status === 'fulfilled') result.albums = (albums.value.data ?? []).map(i => mapAlbumItem(i, this.serverId))
      if (artists.status === 'fulfilled') result.artists = (artists.value.data ?? []).map(i => mapArtistItem(i, this.serverId))
      if (sheets.status === 'fulfilled' && result.playlists) {
        result.playlists = (sheets.value.data ?? []).map(i => mapSheetItem(i, this.serverId))
      }
    }
    return result
  }

  getStreamUrl(): string {
    // 插件流必须异步解析（resolveStreamUrl）；走到这里说明引擎没走异步路径
    throw new Error('Plugin streams must be resolved via resolveStreamUrl')
  }

  async getLyrics(songId: string, title?: string, artist?: string): Promise<Lyrics | null> {
    if (!this.host.hasMethod('getLyric')) return null
    const raw = this.rawSong({ id: songId, title, artist })
    const lyric = await this.host.call<{ rawLrc?: string; translation?: string }>('getLyric', raw)
    if (!lyric?.rawLrc) return null
    const lines = parseLrcText(lyric.rawLrc)
    return { songId, lines, synced: lines.some(l => l.time > 0) }
  }

  async scrobble(): Promise<void> {
    // MusicFree 协议没有 scrobble；播放引擎按 song.serverId 找到这里时不炸即可
  }

  // --- 专辑 / 歌手（仅当插件实现了对应方法才有内容） ---

  async getAlbums(): Promise<PageResult<Album>> {
    return { items: [], total: 0, offset: 0, size: 0 }
  }

  async getAlbumDetail(albumId: string): Promise<AlbumDetail> {
    if (!this.host.hasMethod('getAlbumInfo')) throw new Error('Plugin does not support album detail')
    const rawAlbum = getRawItem<AlbumItem>(this.serverId, 'album', albumId)
      ?? { platform: this.manifest.platform, id: albumId, title: '' }
    const { songs, item: albumItem } = await this.fetchAllDetailPages(
      page => this.host.call<MediaDetailResult<AlbumItem>>('getAlbumInfo', rawAlbum, page)
    )
    const album = mapAlbumItem(albumItem ?? rawAlbum, this.serverId)
    return { ...album, songs }
  }

  async getRecentAlbums(): Promise<Album[]> {
    return []
  }

  async getRandomSongs(): Promise<Song[]> {
    return []
  }

  async getArtists(): Promise<Artist[]> {
    // 插件没有全量歌手列表；歌手入口靠 search(type='artist') 与作品页
    return []
  }

  async getArtistDetail(artistId: string): Promise<ArtistDetail> {
    if (!this.host.hasMethod('getArtistWorks')) throw new Error('Plugin does not support artist detail')
    const rawArtist = getRawItem<ArtistItem>(this.serverId, 'artist', artistId)
      ?? { platform: this.manifest.platform, id: artistId, name: '' }
    const artist = mapArtistItem(rawArtist, this.serverId)
    const [works, albumsWorks] = await Promise.allSettled([
      this.host.call<Paged<MusicItem>>('getArtistWorks', rawArtist, 1, 'music'),
      this.host.call<Paged<AlbumItem>>('getArtistWorks', rawArtist, 1, 'album'),
    ])
    const songs = works.status === 'fulfilled'
      ? await this.fetchMusicPages(1, page => this.host.call<Paged<MusicItem>>('getArtistWorks', rawArtist, page, 'music'), works.value)
      : []
    const albums = albumsWorks.status === 'fulfilled'
      ? (albumsWorks.value.data ?? []).map(i => mapAlbumItem(i, this.serverId))
      : []
    return { ...artist, albums, songs }
  }

  // --- 歌单 ---

  async getPlaylists(): Promise<Playlist[]> {
    if (!this.host.hasMethod('n1ko.user.getPlaylists')) return []
    const { created, subscribed } = await this.host.call<{ created: SheetItem[]; subscribed: SheetItem[] }>('n1ko.user.getPlaylists')
    return [...(created ?? []), ...(subscribed ?? [])].map(s => mapSheetItem(s, this.serverId))
  }

  async getPlaylistDetail(playlistId: string): Promise<PlaylistDetail> {
    if (!this.host.hasMethod('getMusicSheetInfo')) throw new Error('Plugin does not support playlist detail')
    const rawSheet = getRawItem<SheetItem>(this.serverId, 'sheet', playlistId)
      ?? { platform: this.manifest.platform, id: playlistId, title: '' }
    const { songs, item: sheetItem } = await this.fetchAllDetailPages(
      page => this.host.call<MediaDetailResult<SheetItem>>('getMusicSheetInfo', rawSheet, page)
    )
    const playlist = mapSheetItem(sheetItem ?? rawSheet, this.serverId)
    return { ...playlist, songs, songCount: songs.length }
  }

  async createPlaylist(name: string, songIds: string[] = []): Promise<Playlist> {
    if (!this.host.hasMethod('n1ko.user.createPlaylist')) throw new Error('Plugin does not support creating playlists')
    const sheet = await this.host.call<SheetItem>('n1ko.user.createPlaylist', name)
    const playlist = mapSheetItem(sheet, this.serverId)
    if (songIds.length && this.host.hasMethod('n1ko.user.addToPlaylist')) {
      await this.host.call('n1ko.user.addToPlaylist', sheet, songIds.map(id => this.rawSong({ id })))
    }
    return playlist
  }

  async updatePlaylist(_playlistId: string, _name?: string, _comment?: string): Promise<void> {
    throw new Error('Plugin does not support renaming playlists')
  }

  async deletePlaylist(_playlistId: string): Promise<void> {
    throw new Error('Plugin does not support deleting playlists')
  }

  async addSongsToPlaylist(playlistId: string, songIds: string[]): Promise<void> {
    if (!this.host.hasMethod('n1ko.user.addToPlaylist')) throw new Error('Plugin does not support editing playlists')
    const rawSheet = getRawItem<SheetItem>(this.serverId, 'sheet', playlistId)
      ?? { platform: this.manifest.platform, id: playlistId, title: '' }
    await this.host.call('n1ko.user.addToPlaylist', rawSheet, songIds.map(id => this.rawSong({ id })))
  }

  /**
   * 调用方传下标（Subsonic 语义，沿用 Jellyfin 的翻译范式）：
   * 先拿歌单全量把下标翻译成歌曲，再回传整项给插件。
   */
  async removeSongsFromPlaylist(playlistId: string, songIndexes: number[]): Promise<void> {
    if (!songIndexes.length) return
    if (!this.host.hasMethod('n1ko.user.removeFromPlaylist')) throw new Error('Plugin does not support editing playlists')
    const detail = await this.getPlaylistDetail(playlistId)
    const items = songIndexes
      .map(i => detail.songs[i])
      .filter((s): s is Song => !!s)
      .map(s => this.rawSong(s))
    if (!items.length) {
      // 下标全部越界 = 调用方看到的列表与插件已经不一致，静默「成功」就是撒谎
      throw new Error('No matching playlist entries to remove')
    }
    const rawSheet = getRawItem<SheetItem>(this.serverId, 'sheet', playlistId)
      ?? { platform: this.manifest.platform, id: playlistId, title: '' }
    await this.host.call('n1ko.user.removeFromPlaylist', rawSheet, items)
  }

  // --- 收藏 ---

  async getStarred(): Promise<{ songs: Song[]; albums: Album[]; artists: Artist[] }> {
    if (!this.host.hasMethod('n1ko.user.getFavorites')) return { songs: [], albums: [], artists: [] }
    const first = await this.host.call<Paged<MusicItem>>('n1ko.user.getFavorites', 1)
    const songs = await this.fetchMusicPages(1, page => this.host.call<Paged<MusicItem>>('n1ko.user.getFavorites', page), first)
    return { songs, albums: [], artists: [] }
  }

  async star(id: string, type: 'song' | 'album' | 'artist'): Promise<void> {
    await this.setFavorite(id, type, true)
  }

  async unstar(id: string, type: 'song' | 'album' | 'artist'): Promise<void> {
    await this.setFavorite(id, type, false)
  }

  private async setFavorite(id: string, type: 'song' | 'album' | 'artist', liked: boolean): Promise<void> {
    if (!this.host.hasMethod('n1ko.user.setFavorite')) throw new Error('Plugin does not support favorites')
    const item = type === 'song'
      ? this.rawSong({ id })
      : type === 'album'
        ? (getRawItem<AlbumItem>(this.serverId, 'album', id) ?? { platform: this.manifest.platform, id, title: '' })
        : (getRawItem<ArtistItem>(this.serverId, 'artist', id) ?? { platform: this.manifest.platform, id, name: '' })
    await this.host.call('n1ko.user.setFavorite', item, liked)
  }

  // --- 元数据 / 封面 / 流派 ---

  async updateSongMetadata(_songId: string, _metadata: { title?: string; album?: string; artist?: string; year?: number; genre?: string; track?: number }): Promise<void> {
    throw new Error('Plugin does not support metadata editing')
  }

  async setLyrics(_songId: string, _lyrics: string): Promise<void> {
    throw new Error('Plugin does not support writing lyrics')
  }

  getCoverUrl(id: string, _size?: number): string {
    // 插件的 coverArt 本来就是 URL（PROTOCOL §5.2），原样返回
    return id
  }

  async getGenres(): Promise<Array<{ name: string; songCount: number; albumCount: number }>> {
    return []
  }

  // ===================================================
  // 可选方法：按 manifest capabilities + 沙箱回报的方法挂载
  // ===================================================

  capability(name: string): boolean {
    if (!this.manifest.capabilities.includes(name)) return false
    return true
  }

  getSourceCapabilities(): SourceCapabilities {
    const caps = new Set(this.manifest.capabilities)
    const has = (name: string) => caps.has(name) && this.methodExistsForCapability(name)
    return {
      search: has('search'),
      album: has('album'),
      artist: has('artist'),
      lyrics: has('lyrics'),
      userPlaylists: has('userPlaylists'),
      favorites: has('favorites'),
      playlistWrite: has('playlistWrite'),
      topLists: has('topLists'),
      recommendSheets: has('recommendSheets'),
      importSheet: has('importSheet'),
      libraryBrowse: false,
      radio: has('radio'),
    }
  }

  /** capability → 需要存在的沙箱方法（声明了但方法不存在按未声明处理） */
  private methodExistsForCapability(capability: string): boolean {
    switch (capability) {
      case 'search': return this.host.hasMethod('search')
      case 'album': return this.host.hasMethod('getAlbumInfo')
      case 'artist': return this.host.hasMethod('getArtistWorks')
      case 'lyrics': return this.host.hasMethod('getLyric')
      case 'userPlaylists': return this.host.hasMethod('n1ko.user.getPlaylists')
      case 'favorites': return this.host.hasMethod('n1ko.user.getFavorites')
      case 'playlistWrite': return this.host.hasMethod('n1ko.user.createPlaylist')
      case 'topLists': return this.host.hasMethod('getTopLists')
      case 'recommendSheets': return this.host.hasMethod('getRecommendSheetsByTag')
      case 'importSheet': return this.host.hasMethod('importMusicSheet')
      case 'radio': return this.host.hasMethod('getSimilarSongs')
      default: return false
    }
  }

  private mountOptionalMethods(): void {

    // 取流：n1ko.getMediaSource 优先于顶层同名方法（PROTOCOL §3）
    if (this.host.hasMethod('getMediaSource') || this.host.hasMethod('n1ko.getMediaSource')) {
      const resolve = async (songId: string, opts: {
        maxBitrate: number; quality: 'lossless' | 'high' | 'medium' | 'low'
      }) => {
        const raw = this.rawSong({ id: songId })
        const quality: PluginQuality = mapQuality(opts.quality, this.manifest.qualities)
        const method = this.host.hasMethod('n1ko.getMediaSource') ? 'n1ko.getMediaSource' : 'getMediaSource'
        const media = await this.host.call<{ url: string; expiresAt?: number; mimeType?: string }>(method, raw, quality)
        return { url: media.url, expiresAt: media.expiresAt, mimeType: media.mimeType }
      }
      this.resolveStreamUrl = resolve
    }

    if (this.capability('topLists') && this.host.hasMethod('getTopLists')) {
      this.getTopLists = async () => {
        const groups = await this.host.call<TopListGroup[]>('getTopLists')
        return (groups ?? []).map(g => ({
          title: g.title,
          items: (g.data ?? []).map(s => mapSheetItem(s, this.serverId)),
        }))
      }
      this.getTopListDetail = async (topListId: string, page: number) => {
        const raw = getRawItem<SheetItem>(this.serverId, 'sheet', topListId)
          ?? { platform: this.manifest.platform, id: topListId, title: '' }
        const detail = await this.host.call<MediaDetailResult<SheetItem>>('getTopListDetail', raw, page)
        return { isEnd: detail.isEnd, songs: (detail.musicList ?? []).map(m => mapMusicItem(m, this.serverId)) }
      }
    }

    if (this.capability('recommendSheets') && this.host.hasMethod('getRecommendSheetsByTag')) {
      this.getRecommendSheets = async (page: number) => {
        const paged = await this.host.call<Paged<SheetItem>>('getRecommendSheetsByTag', '', page)
        return { isEnd: paged.isEnd, items: (paged.data ?? []).map(s => mapSheetItem(s, this.serverId)) }
      }
    }
  }

  // ===================================================
  // 内部：原始项与分页
  // ===================================================

  /** 优先取缓存的原项；未命中回传最小项（插件自己兜底） */
  protected rawSong(seed: { id: string; title?: string; artist?: string }): MusicItem {
    return getRawItem<MusicItem>(this.serverId, 'song', seed.id)
      ?? minimalMusicItem(seed, this.manifest.platform)
  }

  /** 把分页接口拉全（isEnd 循环），上限 FETCH_ALL_CAP 防失控歌单拖死界面 */
  private async fetchMusicPages(
    firstPage: number,
    fetchPage: (page: number) => Promise<Paged<MusicItem>>,
    first?: Paged<MusicItem>
  ): Promise<Song[]> {
    const songs: Song[] = []
    let page = firstPage
    let current = first
    for (;;) {
      if (!current) current = await fetchPage(page)
      for (const item of current.data ?? []) {
        songs.push(mapMusicItem(item, this.serverId))
        if (songs.length >= FETCH_ALL_CAP) return songs
      }
      if (current.isEnd || !(current.data ?? []).length) return songs
      page += 1
      current = await fetchPage(page)
    }
  }

  private async fetchAllDetailPages<TItem>(
    fetchPage: (page: number) => Promise<MediaDetailResult<TItem>>
  ): Promise<{ songs: Song[]; item?: TItem }> {
    const songs: Song[] = []
    let page = 1
    let item: TItem | undefined
    for (;;) {
      const detail = await fetchPage(page)
      item = detail.item ?? item
      for (const music of detail.musicList ?? []) {
        songs.push(mapMusicItem(music, this.serverId))
        if (songs.length >= FETCH_ALL_CAP) return { songs, item }
      }
      if (detail.isEnd || !(detail.musicList ?? []).length) return { songs, item }
      page += 1
    }
  }
}

/** search(type='music') 的返回里混入坏形状时只挑 MusicItem 形状的 */
function isMusicItemShape(item: MusicItem | AlbumItem | ArtistItem | SheetItem): item is MusicItem {
  return typeof item === 'object' && item !== null && typeof (item as MusicItem).title !== 'undefined' && 'artist' in item
}
