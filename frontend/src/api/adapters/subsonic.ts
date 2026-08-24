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
  SongExtras,
  Contributor,
  ReplayGainInfo,
  ServerCapabilities,
} from '../types'

/** Subsonic 协议要求的客户端标识 */
const CLIENT_NAME = 'N1KO-MUSIC'

/**
 * 每次认证生成一个新的随机 salt。
 * 旧实现用 Math.random()，不是加密安全随机源，削弱了 token 认证本身的意义。
 */
function randomSalt(): string {
  const bytes = new Uint8Array(16)
  const crypto = globalThis.crypto
  if (crypto?.getRandomValues) {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

function numberOr(value: unknown): number | undefined {
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

/**
 * 提取 OpenSubsonic 在 Child 响应上早就返回、旧 mapSong 一律丢弃的字段。
 *
 * 全部可选，服务器不返就是 undefined，对应的 UI 直接不渲染。
 * 返回 undefined 而不是空对象，避免给每首歌都挂一个没用的对象。
 */
export function mapSongExtras(s: Record<string, unknown>): SongExtras | undefined {
  const ext: SongExtras = {}

  const rg = s.replayGain as Record<string, unknown> | undefined
  if (rg && typeof rg === 'object') {
    const gain: ReplayGainInfo = {
      trackGain: numberOr(rg.trackGain),
      albumGain: numberOr(rg.albumGain),
      trackPeak: numberOr(rg.trackPeak),
      albumPeak: numberOr(rg.albumPeak),
      fallbackGain: numberOr(rg.fallbackGain),
    }
    if (Object.values(gain).some(v => v !== undefined)) ext.replayGain = gain
  }

  const bitDepth = numberOr(s.bitDepth)
  if (bitDepth) ext.bitDepth = bitDepth
  const samplingRate = numberOr(s.samplingRate)
  if (samplingRate) ext.samplingRate = samplingRate
  const channelCount = numberOr(s.channelCount)
  if (channelCount) ext.channelCount = channelCount
  const bpm = numberOr(s.bpm)
  if (bpm) ext.bpm = bpm

  if (Array.isArray(s.contributors)) {
    const contributors = (s.contributors as unknown[])
      .map((raw): Contributor | null => {
        // 服务器返回的是不受信任的 JSON：数组里出现 null、字符串或数字都不该让
        // 整个 mapSong 抛错——那会连带把整页曲目渲染打断。
        if (!raw || typeof raw !== 'object') return null
        const c = raw as Record<string, unknown>
        const artist = (c.artist && typeof c.artist === 'object')
          ? c.artist as Record<string, unknown>
          : undefined
        const name = artist?.name ?? c.name
        if (!name) return null
        return {
          role: String(c.role || ''),
          subRole: c.subRole ? String(c.subRole) : undefined,
          name: String(name),
          artistId: artist?.id ? String(artist.id) : undefined,
        }
      })
      .filter((c): c is Contributor => c !== null)
    if (contributors.length) ext.contributors = contributors
  }

  if (s.displayArtist) ext.displayArtist = String(s.displayArtist)
  if (s.displayComposer) ext.displayComposer = String(s.displayComposer)
  if (Array.isArray(s.moods) && s.moods.length) ext.moods = s.moods.map(String)
  if (Array.isArray(s.isrc) && s.isrc.length) ext.isrc = s.isrc.map(String)
  if (s.musicBrainzId) ext.musicBrainzId = String(s.musicBrainzId)
  if (s.comment) ext.comment = String(s.comment)

  const bookmark = numberOr(s.bookmarkPosition)
  if (bookmark) ext.bookmarkPosition = bookmark

  return Object.keys(ext).length ? ext : undefined
}

/** 歌手详情里最多预取多少张专辑的曲目，其余留给专辑页按需加载 */
const MAX_ARTIST_ALBUM_FETCH = 40
/** 并发上限。浏览器同源连接只有 6 条，超出只会排队并挤掉封面请求。 */
const ARTIST_ALBUM_CONCURRENCY = 4

/** 带并发上限的 map，保持输入顺序 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await fn(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

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
      // Subsonic 的多值参数是「同名重复」形式（id=a&id=b），而 axios 默认序列化成
      // id[]=a&id[]=b，服务端只会当成一个叫 "id[]" 的未知参数整批忽略。
      // 受影响的不只是新加的 savePlayQueue / createShare，还有既有的
      // createPlaylist(songId) 与 updatePlaylist(songIdToAdd / songIndexToRemove)——
      // 「新建歌单时带上歌曲」和「批量加入歌单」此前一直是静默失败的。
      paramsSerializer: { indexes: null },
    })
  }

  /** 构建 Subsonic API 公共参数 */
  private buildParams(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      u: this.username,
      t: this.token,
      s: this.salt,
      v: '1.16.1',
      c: CLIENT_NAME,
      f: 'json',
      ...extra,
    }
  }

  /**
   * 发送 Subsonic API 请求（GET）。
   * signal 用于在组件卸载 / 快速切页时取消在途请求——此前完全没有取消能力，
   * 连点搜索会堆积请求，后到的旧响应还可能覆盖新结果。
   */
  private async request<T>(
    endpoint: string,
    params: Record<string, unknown> = {},
    signal?: AbortSignal
  ): Promise<T> {
    const response = await this.client.get<SubsonicResponse<T>>(endpoint, {
      params: this.buildParams(params),
      signal,
    })
    const data = response.data['subsonic-response']
    if (data.status === 'failed') {
      throw new Error(data.error?.message || 'Subsonic API error')
    }
    return data as T
  }

  /** 发送 Subsonic API 请求（POST，用于修改类操作） */
  private async postRequest<T>(endpoint: string, params: Record<string, unknown> = {}): Promise<T> {
    const response = await this.client.post<SubsonicResponse<T>>(endpoint, null, {
      params: this.buildParams(params),
    })
    const data = response.data['subsonic-response']
    if (data.status === 'failed') {
      throw new Error(data.error?.message || 'Subsonic API error')
    }
    return data as T
  }

  async login(url: string, username: string, password: string): Promise<AuthResult> {
    const salt = randomSalt()
    const token = md5(password + salt)
    const testUrl = url.replace(/\/$/, '')

    try {
      const resp = await axios.get(`${testUrl}/rest/ping`, {
        params: { u: username, t: token, s: salt, v: '1.16.1', c: CLIENT_NAME, f: 'json' },
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

  /**
   * Subsonic 把「用户名或密码错误」表达为 HTTP 200 + error code 40，
   * 而不是 401，所以必须看响应体，不能只看状态码。
   */
  async diagnose(): Promise<'ok' | 'unauthorized' | 'unreachable'> {
    try {
      const response = await this.client.get<SubsonicResponse<unknown>>('/ping', {
        params: this.buildParams({}),
        validateStatus: () => true,
      })
      if (response.status === 401 || response.status === 403) return 'unauthorized'
      if (response.status >= 400) return 'unreachable'
      const data = response.data?.['subsonic-response']
      if (data?.status === 'ok') return 'ok'
      // 40 = wrong username or password，41/42/43/44 是各种令牌/API key 问题
      const code = data?.error?.code
      if (typeof code === 'number' && code >= 40 && code <= 44) return 'unauthorized'
      return 'unreachable'
    } catch {
      return 'unreachable'
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
      suffix: s.suffix ? String(s.suffix) : undefined,
      ext: mapSongExtras(s),
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
    const size = params.size ?? 50
    const offset = params.offset ?? 0
    // OpenSubsonic 约定：search3 的 query 传空字符串（query=""）表示返回全部内容，
    // 配合 songCount/songOffset 分页即可遍历整个曲库。
    // 注意不能传 "*"：Navidrome 会把它当作普通全文检索词，匹配不到任何歌曲，导致列表为空。
    const data = await this.request<{
      searchResult3?: { song?: unknown[]; totalMatched?: number }
    }>('/search3', {
      query: '',
      songCount: size,
      albumCount: 0,
      artistCount: 0,
      songOffset: offset,
      musicFolderId: params.musicFolderId,
    }, params.signal)
    const result = data.searchResult3 ?? {}
    const songs = ((result.song ?? []) as Record<string, unknown>[]).map(this.mapSong.bind(this))
    return {
      items: songs,
      total: result.totalMatched != null ? Number(result.totalMatched) : undefined,
      offset,
      size: songs.length,
    }
  }

  async getSong(songId: string): Promise<Song | null> {
    try {
      const data = await this.request<{ song?: Record<string, unknown> }>('/getSong', { id: songId })
      if (!data.song) return null
      return this.mapSong(data.song)
    } catch {
      return null
    }
  }

  async searchAll(query: string, signal?: AbortSignal): Promise<SearchResult> {
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
    }, signal)
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

  getStreamUrl(
    songId: string,
    maxBitrate: number,
    format: string = '',
    contentType?: string,
    path?: string,
    suffix?: string
  ): string {
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

    const ct = (contentType ?? '').toLowerCase()
    const p = (path ?? '').replace(/\\/g, '/').toLowerCase()
    const suf = (suffix ?? '').toLowerCase().replace(/^\./, '')
    // 路径任意位置出现 .dsf / .dff（不仅限于结尾）；suffix 单独传，避免队列里的 Song 丢 path 后漏判
    const hasDsdExt = /\.(dsf|dff|dsd)(\?|#|$)/i.test(p)
    const hasDsdSuffix = suf === 'dsf' || suf === 'dff' || suf === 'dsd'
    const isDsdFamily =
      hasDsdSuffix ||
      hasDsdExt ||
      ct.includes('dsf') ||
      ct.includes('dsd') ||
      ct.includes('dff')

    // 优先使用调用方指定的格式（如 opus 回退）
    // 否则：有损(maxBitrate>0)转码 mp3
    // 无损(maxBitrate=0)对 DSF/DSD 转码为 flac（浏览器无法解码原生 DSD 容器）
    if (format) {
      streamParams.format = format
    } else if (maxBitrate > 0) {
      streamParams.format = 'mp3'
    } else if (isDsdFamily) {
      streamParams.format = 'flac'
    }

    const params = new URLSearchParams(streamParams)
    return `${this.baseUrl}/rest/stream?${params.toString()}`
  }

  /**
   * Navidrome 等实现有时在 JSON 里给出完整公开地址 `.../share/img/{jwt}`，
   * 该路径在部分部署下会 404；Subsonic 标准 `getCoverArt?id={jwt}` 更稳定。
   */
  private normalizeCoverArtId(raw: string): string {
    const id = raw.trim()
    const fromAnywhere = id.match(/\/share\/img\/([^/?#]+)/)
    if (fromAnywhere) {
      try {
        return decodeURIComponent(fromAnywhere[1])
      } catch {
        return fromAnywhere[1]
      }
    }
    try {
      const u = new URL(id)
      const m = u.pathname.match(/\/share\/img\/([^/]+)/)
      if (m) {
        try {
          return decodeURIComponent(m[1])
        } catch {
          return m[1]
        }
      }
    } catch {
      // 非绝对 URL，保持原样（一般为 Subsonic coverArt id）
    }
    return id
  }

  getCoverUrl(id: string, size = 300): string {
    const coverId = this.normalizeCoverArtId(id)
    // getCoverArt 返回二进制图片，不需要 f（API 响应格式）参数
    const { f: _, ...authParams } = this.buildParams()
    const params = new URLSearchParams({
      id: coverId,
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
      musicFolderId: params.musicFolderId,
    }, params.signal)
    const albums = ((data.albumList2 as Record<string, unknown[]> | undefined)?.album ?? []) as Record<string, unknown>[]
    return { items: albums.map(this.mapAlbum.bind(this)), offset: params.offset ?? 0, size: albums.length }
  }

  async getAlbumDetail(albumId: string, signal?: AbortSignal): Promise<AlbumDetail> {
    // 两个请求并行：唱片说明是附加信息，不该让曲目列表多等一个往返。
    // getAlbumInfo 内部已吞掉错误，失败只是拿不到说明。
    const [data, info] = await Promise.all([
      this.request<{ album?: Record<string, unknown> }>('/getAlbum', { id: albumId }, signal),
      this.getAlbumInfo(albumId, signal),
    ])
    const album = (data.album ?? {}) as Record<string, unknown>
    const songs = ((album.song ?? []) as Record<string, unknown>[]).map(this.mapSong.bind(this))
    return { ...this.mapAlbum(album), songs, ...(info ?? {}) }
  }

  async getRecentAlbums(size = 20, signal?: AbortSignal): Promise<Album[]> {
    const data = await this.getAlbums({ type: 'newest', size, signal })
    return data.items
  }

  async getRandomSongs(size = 50, musicFolderId?: string, signal?: AbortSignal): Promise<Song[]> {
    const data = await this.request<{ randomSongs?: { song?: unknown[] } }>(
      '/getRandomSongs', { size, musicFolderId }, signal
    )
    const songs = ((data.randomSongs as Record<string, unknown[]> | undefined)?.song ?? []) as Record<string, unknown>[]
    return songs.map(this.mapSong.bind(this))
  }

  /**
   * 定向候选：老版本 Subsonic 服务器可能未实现这几个接口，
   * 失败时返回空数组，由推荐逻辑回退到随机候选。
   */
  private async songListEndpoint(
    path: string,
    params: Record<string, unknown>,
    container: string
  ): Promise<Song[]> {
    try {
      const data = await this.request<Record<string, { song?: unknown[] }>>(path, params)
      const songs = (data[container]?.song ?? []) as Record<string, unknown>[]
      return songs.map(this.mapSong.bind(this))
    } catch {
      return []
    }
  }

  async getArtistSongs(artist: { id?: string; name: string }, count = 30): Promise<Song[]> {
    if (!artist.name) return []
    return this.songListEndpoint('/getTopSongs', { artist: artist.name, count }, 'topSongs')
  }

  async getGenreSongs(genre: string, count = 30): Promise<Song[]> {
    if (!genre) return []
    return this.songListEndpoint('/getSongsByGenre', { genre, count }, 'songsByGenre')
  }

  async getSimilarSongs(songId: string, count = 30): Promise<Song[]> {
    if (!songId) return []
    return this.songListEndpoint('/getSimilarSongs2', { id: songId, count }, 'similarSongs2')
  }

  async getArtists(musicFolderId?: string, signal?: AbortSignal): Promise<Artist[]> {
    const data = await this.request<{
      artists?: { index?: Array<{ artist?: unknown[] }> }
    }>('/getArtists', { musicFolderId }, signal)
    const indexes = (data.artists as Record<string, unknown> | undefined)?.index as Array<Record<string, unknown>> | undefined ?? []
    const artists: Artist[] = []
    for (const index of indexes) {
      // 桶名就是服务端算好的索引字母，顺手带上，前端不必再猜一遍拼音
      const letter = typeof index.name === 'string' ? index.name : undefined
      const list = (index.artist ?? []) as Record<string, unknown>[]
      artists.push(...list.map(item => ({ ...this.mapArtist(item), sortIndex: letter })))
    }
    return artists
  }

  async getArtistDetail(artistId: string, signal?: AbortSignal): Promise<ArtistDetail> {
    // Phase 1: 基本信息（并行）
    const [artistData, infoData] = await Promise.allSettled([
      this.request<{ artist?: Record<string, unknown> }>('/getArtist', { id: artistId }, signal),
      this.request<{ artistInfo2?: Record<string, unknown> }>('/getArtistInfo2', { id: artistId }, signal),
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
      ? this.request<{ topSongs?: { song?: unknown[] } }>('/getTopSongs', { artist: artistName, count: 50 }, signal)
          .catch(() => null)
      : Promise.resolve(null)
    // 每张专辑一次 /getAlbum。多产歌手会一次打出几十个请求，
    // 而浏览器同源连接只有 6 条——请求排队反而拖慢首屏，也会挤掉封面。
    // 这里用并发池限流；专辑很多时只取前若干张，其余按需在专辑页加载。
    const [topSongsResult, albumResults] = await Promise.all([
      topSongsPromise,
      mapWithConcurrency(
        albums.slice(0, MAX_ARTIST_ALBUM_FETCH),
        ARTIST_ALBUM_CONCURRENCY,
        a => this.request<{ album?: Record<string, unknown> }>('/getAlbum', { id: a.id }, signal)
          .catch(() => null)
      ),
    ])

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

  async getPlaylists(signal?: AbortSignal): Promise<Playlist[]> {
    const data = await this.request<{ playlists?: { playlist?: unknown[] } }>('/getPlaylists', {}, signal)
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
      readonly: p.readonly === true,
      validUntil: p.validUntil ? String(p.validUntil) : undefined,
    }))
  }

  async getPlaylistDetail(playlistId: string, signal?: AbortSignal): Promise<PlaylistDetail> {
    const data = await this.request<{ playlist?: Record<string, unknown> }>('/getPlaylist', { id: playlistId }, signal)
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
      readonly: pl.readonly === true,
      validUntil: pl.validUntil ? String(pl.validUntil) : undefined,
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
    await this.postRequest('/updatePlaylist', { playlistId, name, comment })
  }

  async deletePlaylist(playlistId: string): Promise<void> {
    await this.request('/deletePlaylist', { id: playlistId })
  }

  async addSongsToPlaylist(playlistId: string, songIds: string[]): Promise<void> {
    await this.postRequest('/updatePlaylist', { playlistId, songIdToAdd: songIds })
  }

  async removeSongsFromPlaylist(playlistId: string, songIndexes: number[]): Promise<void> {
    await this.postRequest('/updatePlaylist', { playlistId, songIndexToRemove: songIndexes })
  }

  async getStarred(signal?: AbortSignal): Promise<{ songs: Song[]; albums: Album[]; artists: Artist[] }> {
    const data = await this.request<{
      starred2?: { song?: unknown[]; album?: unknown[]; artist?: unknown[] }
    }>('/getStarred2', {}, signal)
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

  async updateSongMetadata(songId: string, metadata: { title?: string; album?: string; artist?: string; year?: number; genre?: string; track?: number }): Promise<void> {
    const params: Record<string, unknown> = { id: songId }

    // Navidrome /updateMediaAnnotation 对歌曲只支持以下字段：
    // title（标题）、year（年代）、genre（流派）、track（音轨号）
    // album / artist 参数会被静默忽略（它们是实体关联，不是元数据），
    // 若用户确实需要修改专辑/歌手，需通过专辑详情页或歌手详情页操作。
    if (metadata.title !== undefined) {
      params.title = metadata.title
    }
    if (metadata.year !== undefined) {
      params.year = metadata.year
    }
    if (metadata.genre !== undefined) {
      params.genre = metadata.genre
    }
    if (metadata.track !== undefined) {
      params.track = metadata.track
    }

    console.debug('[Subsonic] updateMediaAnnotation params:', params)
    const result = await this.postRequest('/updateMediaAnnotation', params)
    console.debug('[Subsonic] updateMediaAnnotation result:', result)
  }

  async setLyrics(songId: string, lyrics: string): Promise<void> {
    // 线上参数名必须是 lyrics。此前写成了 o3ics（一次全局替换把 "lyr" 换成了 "o3"
    // 留下的痕迹，同源问题还有 o3icCacheStore），服务端只会当成未知参数忽略，
    // 于是「保存歌词」永远静默失败。
    try {
      await this.postRequest('/setLyrics', { id: songId, lyrics })
    } catch (err) {
      console.error('[Subsonic] setLyrics failed:', err)
      throw err
    }
  }

  async getGenres(signal?: AbortSignal): Promise<Array<{ name: string; songCount: number; albumCount: number }>> {
    const data = await this.request<{
      genres?: { genre?: unknown[] }
    }>('/getGenres', {}, signal)
    const genres = ((data.genres as Record<string, unknown[]> | undefined)?.genre ?? []) as Record<string, unknown>[]
    return genres.map(g => ({
      name: String(g.value || g.name || ''),
      songCount: Number(g.songCount) || 0,
      albumCount: Number(g.albumCount) || 0,
    }))
  }

  // ===================================================
  // 服务端早已提供、此前从未调用的能力
  // ===================================================

  /**
   * 跨设备续播。Subsonic API 1.12.0 起就有，Navidrome 已实现，此前全仓零引用。
   * 对「服务器在家、人在外面」的播放器，这是最贴题的一个能力。
   */
  async savePlayQueue(songIds: string[], currentId: string, positionMs: number): Promise<void> {
    if (!songIds.length) return
    await this.postRequest('/savePlayQueue', {
      id: songIds,
      current: currentId,
      position: Math.max(0, Math.round(positionMs)),
    })
  }

  async getPlayQueue(): Promise<{
    songs: Song[]; currentId?: string; positionMs: number; changedBy?: string
  } | null> {
    const data = await this.request<{ playQueue?: Record<string, unknown> }>('/getPlayQueue')
    const pq = data.playQueue
    if (!pq) return null
    const entries = ((pq.entry ?? []) as Record<string, unknown>[]).map(this.mapSong.bind(this))
    if (!entries.length) return null
    return {
      songs: entries,
      currentId: pq.current ? String(pq.current) : undefined,
      positionMs: numberOr(pq.position) ?? 0,
      changedBy: pq.changedBy ? String(pq.changedBy) : undefined,
    }
  }

  /** 长音轨断点：DJ set、现场整轨、整乐章 */
  async createBookmark(songId: string, positionMs: number, comment?: string): Promise<void> {
    await this.postRequest('/createBookmark', {
      id: songId,
      position: Math.max(0, Math.round(positionMs)),
      comment,
    })
  }

  async getBookmarks(): Promise<Array<{ song: Song; positionMs: number; comment?: string }>> {
    const data = await this.request<{ bookmarks?: { bookmark?: unknown[] } }>('/getBookmarks')
    const list = ((data.bookmarks as Record<string, unknown[]> | undefined)?.bookmark ?? []) as Record<string, unknown>[]
    return list
      .filter(b => b.entry)
      .map(b => ({
        song: this.mapSong(b.entry as Record<string, unknown>),
        positionMs: numberOr(b.position) ?? 0,
        comment: b.comment ? String(b.comment) : undefined,
      }))
  }

  async deleteBookmark(songId: string): Promise<void> {
    await this.postRequest('/deleteBookmark', { id: songId })
  }

  /** 评分写回。userRating 早已映射并展示，此前只缺这一半。 */
  async setRating(id: string, rating: number): Promise<void> {
    const clamped = Math.max(0, Math.min(5, Math.round(rating)))
    await this.postRequest('/setRating', { id, rating: clamped })
  }

  /** 专辑说明 / 乐评，用于「唱片说明」内页 */
  async getAlbumInfo(albumId: string, signal?: AbortSignal): Promise<{
    notes?: string; musicBrainzId?: string; externalUrl?: string
  } | null> {
    try {
      const data = await this.request<{ albumInfo?: Record<string, unknown> }>('/getAlbumInfo2', { id: albumId }, signal)
      const info = data.albumInfo
      if (!info) return null
      const notes = info.notes ? String(info.notes) : undefined
      const musicBrainzId = info.musicBrainzId ? String(info.musicBrainzId) : undefined
      const externalUrl = info.lastFmUrl ? String(info.lastFmUrl) : undefined
      if (!notes && !musicBrainzId && !externalUrl) return null
      return { notes, musicBrainzId, externalUrl }
    } catch {
      return null
    }
  }

  /** 多音乐库：很多人把有声书 / 白噪声单独放一个库 */
  async getMusicFolders(): Promise<Array<{ id: string; name: string }>> {
    try {
      const data = await this.request<{ musicFolders?: { musicFolder?: unknown[] } }>('/getMusicFolders')
      const list = ((data.musicFolders as Record<string, unknown[]> | undefined)?.musicFolder ?? []) as Record<string, unknown>[]
      return list.map(f => ({ id: String(f.id), name: String(f.name || f.id) }))
    } catch {
      return []
    }
  }

  async getNowPlaying(): Promise<Array<{
    username: string; playerName?: string; minutesAgo?: number; song: Song
  }>> {
    try {
      const data = await this.request<{ nowPlaying?: { entry?: unknown[] } }>('/getNowPlaying')
      const list = ((data.nowPlaying as Record<string, unknown[]> | undefined)?.entry ?? []) as Record<string, unknown>[]
      return list.map(e => ({
        username: String(e.username || ''),
        playerName: e.playerName ? String(e.playerName) : undefined,
        minutesAgo: numberOr(e.minutesAgo),
        song: this.mapSong(e),
      }))
    } catch {
      return []
    }
  }

  async createShare(
    ids: string[],
    options: { description?: string; expiresAt?: number } = {}
  ): Promise<{ id: string; url: string }> {
    const data = await this.postRequest<{ shares?: { share?: unknown[] } }>('/createShare', {
      id: ids,
      description: options.description,
      expires: options.expiresAt,
    })
    const share = (((data.shares as Record<string, unknown[]> | undefined)?.share ?? [])[0] ?? {}) as Record<string, unknown>
    return { id: String(share.id ?? ''), url: String(share.url ?? '') }
  }

  /**
   * 服务器到底开没开分享。
   *
   * 不能靠「适配器有没有 createShare 这个方法」来判断——Subsonic 系适配器永远有，
   * 于是关掉了分享的服务器上入口照样出现，点下去才 501。
   *
   * 关键在于把两件事分开：
   *
   * - **服务器回答了「没有」**（501/404，或 200 带一个 failed body）→ 返回 false，
   *   这是一个可以缓存的结论。
   * - **压根没问到服务器**（断网、超时、502、认证过期）→ **抛出去**。
   *   这不是答案，是没拿到答案。把它当成 false 会被 react-query 当作成功结果缓存下来，
   *   于是 NAS 刚唤醒、隧道刚重连那一下的抖动，会让一台分享明明开着的服务器
   *   在接下来半小时里都没有分享入口。抛出去才能走正常的重试与重取。
   *
   * 因此这里绕开 request()——它把 501 和断网都变成同一种 Error，分不出来。
   */
  async probeShares(): Promise<boolean> {
    const response = await this.client.get<SubsonicResponse<unknown>>('/getShares', {
      params: this.buildParams({}),
      // 501 要作为「答案」拿到手，而不是变成异常
      validateStatus: () => true,
    })
    // 这两个状态码的含义是「这个端点不在这台服务器上」，是确定的否定答案
    if (response.status === 501 || response.status === 404) return false
    if (response.status >= 400) {
      throw new Error(`getShares probe failed with status ${response.status}`)
    }
    return response.data?.['subsonic-response']?.status === 'ok'
  }

  async getShares(): Promise<Array<{
    id: string; url: string; description?: string; expiresAt?: number; visitCount?: number
  }>> {
    try {
      const data = await this.request<{ shares?: { share?: unknown[] } }>('/getShares')
      const list = ((data.shares as Record<string, unknown[]> | undefined)?.share ?? []) as Record<string, unknown>[]
      return list.map(s => ({
        id: String(s.id),
        url: String(s.url || ''),
        description: s.description ? String(s.description) : undefined,
        expiresAt: s.expires ? Date.parse(String(s.expires)) || undefined : undefined,
        visitCount: numberOr(s.visitCount),
      }))
    } catch {
      return []
    }
  }

  async deleteShare(shareId: string): Promise<void> {
    await this.postRequest('/deleteShare', { id: shareId })
  }

  /** 往 NAS 丢了新专辑之后，不必再开服务器后台 */
  async startScan(): Promise<void> {
    await this.postRequest('/startScan')
  }

  async getScanStatus(): Promise<{ scanning: boolean; count?: number; folderCount?: number } | null> {
    try {
      const data = await this.request<{ scanStatus?: Record<string, unknown> }>('/getScanStatus')
      const s = data.scanStatus
      if (!s) return null
      return {
        scanning: !!s.scanning,
        count: numberOr(s.count),
        folderCount: numberOr(s.folderCount),
      }
    } catch {
      return null
    }
  }

  /**
   * 能力协商。此前对可选能力是 try/catch-and-hope，
   * 结果是 UI 上摆着一堆点了没反应的入口。
   */
  async getServerCapabilities(): Promise<ServerCapabilities> {
    const caps: ServerCapabilities = { openSubsonic: false, extensions: {} }
    try {
      const pong = await this.request<Record<string, unknown>>('/ping')
      caps.openSubsonic = !!pong.openSubsonic
      caps.serverVersion = pong.serverVersion ? String(pong.serverVersion) : undefined
      caps.serverType = pong.type ? String(pong.type) : undefined
    } catch {
      return caps
    }
    if (!caps.openSubsonic) return caps
    try {
      const data = await this.request<{ openSubsonicExtensions?: unknown[] }>('/getOpenSubsonicExtensions')
      for (const raw of (data.openSubsonicExtensions ?? []) as Record<string, unknown>[]) {
        const name = raw.name ? String(raw.name) : ''
        if (!name) continue
        caps.extensions[name] = Array.isArray(raw.versions)
          ? (raw.versions as unknown[]).map(v => Number(v)).filter(Number.isFinite)
          : []
      }
    } catch {
      // 扩展清单拿不到不影响 openSubsonic 判定
    }
    return caps
  }
}

/**
 * 解析 LRC 格式歌词文本
 * 支持标准 LRC 和增强 LRC 格式
 *
 * LRC 元数据标签格式：`[tag:value]` 或 `[tag]`
 * 支持的标签：id, ar, ti, al, by, hash, sign, qq, total, offset, lang, length 等
 * 这些标签会被过滤掉，不作为歌词文本输出
 */
export function parseLrcText(text: string): LyricLine[] {
  if (!text?.trim()) return []

  const lines: LyricLine[] = []

  // [offset:±毫秒] 全局偏移：LRC 约定正值表示歌词提前显示（时间戳减去偏移），与 useLyrics.parseLrc 保持一致
  const offsetMatch = /\[offset:\s*([+-]?\d+)\s*\]/i.exec(text)
  const lrcOffset = offsetMatch ? parseInt(offsetMatch[1]) : 0

  // LRC 元数据标签正则：匹配 [tag] 或 [tag:value] 格式
  // 注意 [^\]] 的反斜杠不可省：JS 里 [^]] 会被解析为「任意字符 + 字面 ]」，导致多字符元数据值（如 [ar:周杰伦]）漏过滤
  const metaTagRegex = /^\[(?:id|ar|ti|al|by|hash|sign|qq|total|offset|lang|length|desc|album|artist|title|author|maker|version|re|ve|encoding|file|rcv|usr|uid|msid|msas|mscv|msp|msu|cap|cta|cla|cla2|com|tag|instrument|role|track|lrcx)\s*(?::[^\]]*)?\]$/i

  // 标准时间戳正则
  const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/g
  const rows = text.split('\n')

  for (const row of rows) {
    const trimmed = row.trim()
    if (!trimmed) continue

    // 跳过 LRC 元数据标签行（如 [id:xxx], [ar:歌手], [ti:标题] 等）
    if (metaTagRegex.test(trimmed)) {
      continue
    }

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

    // 无时间戳的纯文本行
    if (times.length === 0) {
      lines.push({ time: 0, text: lyricText })
      continue
    }

    // 区分两种多时间戳格式：
    // 1) 重复副歌简写：所有时间标签连续出现在行首（[t1][t2]歌词），每个标签各生成一行
    // 2) 卡拉OK逐字标签：时间标签内联在文字之间（如 "有[01:02.40]一[01:02.60]点[01:02.79]"，
    //    行首可能没有标签），整行只生成一条记录，时间取该行最早的时间戳
    // 行首标签之间允许空白（如 "[00:12.34] [01:45.00]text" 的重复副歌简写）
    const leadingTags = /^(?:\[\d{2}:\d{2}\.\d{2,3}\]\s*)+/.exec(trimmed)
    const leadingCount = leadingTags ? (leadingTags[0].match(/\[/g) ?? []).length : 0

    if (leadingCount === times.length) {
      for (const time of times) {
        lines.push({ time: Math.max(0, time - lrcOffset), text: lyricText })
      }
    } else {
      const earliest = Math.min(...times)
      lines.push({ time: Math.max(0, earliest - lrcOffset), text: lyricText })
    }
  }

  return lines.sort((a, b) => a.time - b.time)
}
