/**
 * WebDAV 音源。
 *
 * 给没有 Navidrome / Jellyfin 的 NAS 用。打开设备的 WebDAV 服务后，
 * 填它的地址（例如 http://192.168.1.3:5005）和 NAS 自己的账号。
 *
 * 只在安卓原生壳里能用：WebView 里的 fetch 过不了 CORS，<audio> 和 <img> 也带不上账号。
 * 列目录、读标签和歌词走原生插件；封面走同源的 /_n1ko_dav/ 由原生代取；
 * 播歌走原生在 127.0.0.1 上开的口子（带一次性口令），FLAC 交给系统解码器。
 *
 * 曲库是自己扫出来的：第一次逐层列目录、逐首读文件头的标签，结果存进 IndexedDB。
 * 之后每次打开先把上次的曲库摆出来，再在后台重新列目录，只给新增和改过的文件读标签。
 */

import { log } from '@/lib/log'
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
  ListParams,
} from '../types'
import { parseLrc } from '@/utils/lrc'
import { t } from '@/i18n'
import {
  basenameKey,
  buildLibrary,
  directoryUrl,
  fileUrlOf,
  idOf,
  isAudioName,
  isCoverName,
  isLrcName,
  normalizeBase,
  parsePropfind,
  type DavEntry,
  type WebDavFile,
  type WebDavLibrary,
} from './webdavLibrary'
import { readAudioTags } from './audioTags'
import { queryClient } from '@/lib/queryClient'
import { toast } from '@/components/ui/use-toast'
import { readCacheEntry, writeCacheEntry } from '@/services/libraryCacheDb'
import { WebDavNative, webDavNativeAvailable, NATIVE_FLAC_PREFIX } from './webdavNative'

const PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:displayname/>
    <d:resourcetype/>
    <d:getcontentlength/>
    <d:getcontenttype/>
    <d:getlastmodified/>
    <d:getetag/>
  </d:prop>
</d:propfind>`

const MAX_DEPTH = 8
/** 曲库最多收这么多首。超了按路径挑排在前面的（见 finishListing），并提示一次。 */
const MAX_FILES = 10000
/**
 * 不进曲库的系统目录：「.」「#」开头的（.Trash、#recycle、#snapshot）之外，
 * 还有群晖的缩略图目录 @eaDir、威联通的回收站 @Recycle / 快照 @Recently-Snapshot、
 * 插在 NAS 上的 Windows 移动硬盘的回收站 $RECYCLE.BIN（里面是改了名的被删的歌）。
 */
const HIDDEN_DIRS = new Set(['@eadir', '@recycle', '@recently-snapshot', '$recycle.bin'])
/**
 * 读文件头时服务器明确说「这个文件读不了」的状态：当它没有标签，文件没变就不再读。
 * 其余失败（5xx、429、408、401/403、断网）都可能是临时的，留到下次扫描再读。
 */
const UNREADABLE_STATUS = new Set([404, 405, 410, 415, 416])
/** 已经提示过「曲库超过上限」的音源（本次运行内） */
const truncationNotified = new Set<string>()
/** 第一次扫描最多等这么久才摆出第一版曲库（整库读完就不用等） */
const FIRST_PUBLISH_WAIT_MS = 8000
/** 读标签时每读完这么多首，换上一版曲库 */
const TAG_PUBLISH_EVERY = 300
/** 封面经原生代取的同源前缀（android/…/WebDavProxy.java） */
const COVER_PREFIX = '/_n1ko_dav/'
const INDEX_VERSION = 1

interface WebDavOptions {
  url: string
  username: string
  password: string
  serverId: string
  musicPaths?: string
}

/** 存进 IndexedDB 的曲库。地址只存路径，换了 IP 也能接着用。 */
interface StoredIndex {
  v: number
  files: WebDavFile[]
  covers: Array<[string, string]>
  lrcs: Array<[string, string]>
}

interface ScanState {
  files: WebDavFile[]
  covers: Map<string, string>
  lrcs: Map<string, string>
}

/** 一次扫描过程中的东西，不存盘 */
interface ScanRun {
  state: ScanState
  /** 第一次扫描边列目录边读标签；重扫时为 null */
  tags: TagQueue | null
  seen: Set<string>
  /** 找到的音频文件总数，含超出上限、没收录的 */
  found: number
  /** 列不出来、跳过了的子文件夹 */
  skippedDirs: number
  /** 已经排进读标签队列的文件 */
  queued: Set<WebDavFile>
}

export class WebDavAdapter implements MusicServerAdapter {
  readonly type: ServerType = 'webdav'

  private base: string
  private username: string
  private password: string
  private readonly serverId: string
  private musicPaths: string
  private nativeReady: Promise<void> | null = null
  /** 原生播放口子的前缀：http://127.0.0.1:端口/play?t=口令&u= */
  private proxyPrefix = ''
  private indexPromise: Promise<WebDavLibrary> | null = null
  /** 已经能拿来显示的曲库。目录还在往下扫时，这里是已经扫到的那一部分。 */
  private published: WebDavLibrary | null = null
  /** 最近一次扫描（或上次存下）的原始文件表，重扫时拿来复用标签 */
  private lastScan: ScanState | null = null
  private firstReady: Promise<WebDavLibrary> | null = null
  private resolveFirst: ((library: WebDavLibrary) => void) | null = null
  private rejectFirst: ((err: unknown) => void) | null = null
  private lastRefresh = 0
  private scanning = false

  constructor(options: WebDavOptions) {
    this.base = normalizeBase(options.url)
    this.username = options.username
    this.password = options.password
    this.serverId = options.serverId
    this.musicPaths = options.musicPaths ?? ''
    if (this.password) void this.ensureNative().catch(() => {})
  }

  async login(url: string, username: string, password: string): Promise<AuthResult> {
    try {
      this.base = normalizeBase(url)
      this.username = username
      this.password = password
      this.nativeReady = null
      this.resetIndex()
      await this.ensureNative()
      await this.propfind(directoryUrl(this.base), 0)
      return { success: true, token: password, username }
    } catch (err) {
      return { success: false, token: '', error: this.loginMessage(err) }
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.propfind(directoryUrl(this.base), 0)
      return true
    } catch {
      return false
    }
  }

  async diagnose(): Promise<'ok' | 'unauthorized' | 'unreachable'> {
    try {
      await this.propfind(directoryUrl(this.base), 0)
      return 'ok'
    } catch (err) {
      if (err instanceof WebDavFailure && err.kind === 'auth') return 'unauthorized'
      return 'unreachable'
    }
  }

  getSourceCapabilities(): SourceCapabilities {
    return {
      search: true,
      album: true,
      artist: true,
      lyrics: true,
      userPlaylists: false,
      favorites: false,
      playlistWrite: false,
      topLists: false,
      recommendSheets: false,
      recommendSongs: false,
      importSheet: false,
      libraryBrowse: true,
      radio: false,
    }
  }

  async getSongs(params: ListParams = {}): Promise<PageResult<Song>> {
    const library = await this.library(params.signal)
    return paginate(library.songs, params)
  }

  async getSong(songId: string): Promise<Song | null> {
    const library = await this.library()
    const id = normalizeId(songId)
    return library.songs.find(song => song.id === id) ?? null
  }

  async searchAll(query: string, signal?: AbortSignal): Promise<SearchResult> {
    const library = await this.library(signal)
    const needle = query.trim().toLowerCase()
    if (!needle) return { songs: [], albums: [], artists: [] }
    const hit = (value: string | undefined) => (value ?? '').toLowerCase().includes(needle)
    return {
      songs: library.songs.filter(song => hit(song.title) || hit(song.artist) || hit(song.album)).slice(0, 100),
      albums: library.albums.filter(album => hit(album.name) || hit(album.artist)).slice(0, 40),
      artists: library.artists.filter(artist => hit(artist.name)).slice(0, 40),
    }
  }

  getStreamUrl(songId: string): string {
    const target = this.fileUrl(songId)
    return this.proxyPrefix ? this.proxyPrefix + encodeURIComponent(target) : target
  }

  async resolveStreamUrl(songId: string): Promise<{ url: string; mimeType?: string }> {
    await this.ensureNative()
    const target = this.fileUrl(songId)
    if (!webDavNativeAvailable()) return { url: target }
    const path = new URL(target).pathname.toLowerCase()
    // WebView 的 audio 不解 FLAC，交给系统解码器（audio/hybridAudio）
    if (path.endsWith('.flac')) return { url: NATIVE_FLAC_PREFIX + target, mimeType: 'audio/flac' }
    return { url: this.proxyPrefix + encodeURIComponent(target) }
  }

  async getLyrics(songId: string): Promise<Lyrics | null> {
    const library = await this.library()
    const lrcId = library.lrcBySongId.get(normalizeId(songId))
    if (!lrcId) return null
    const text = await this.getText(this.fileUrl(lrcId))
    const lines = parseLrc(text)
    if (!lines.length) return null
    return { songId, lines, synced: lines.some(line => line.time > 0) }
  }

  async scrobble(): Promise<void> {}

  async getAlbums(params: ListParams = {}): Promise<PageResult<Album>> {
    const library = await this.library(params.signal)
    return paginate(library.albums, params)
  }

  async getAlbumDetail(albumId: string, signal?: AbortSignal): Promise<AlbumDetail> {
    const library = await this.library(signal)
    const album = library.albums.find(item => item.id === albumId)
    if (!album) throw new WebDavFailure(t('webdav.error.noAlbum'), 'http')
    return album
  }

  async getRecentAlbums(size = 20, signal?: AbortSignal): Promise<Album[]> {
    const library = await this.library(signal)
    return library.recentAlbums.slice(0, size)
  }

  async getRandomSongs(size = 30, _musicFolderId?: string, signal?: AbortSignal): Promise<Song[]> {
    const library = await this.library(signal)
    return shuffle(library.songs).slice(0, size)
  }

  async getArtists(_musicFolderId?: string, signal?: AbortSignal): Promise<Artist[]> {
    const library = await this.library(signal)
    return library.artists
  }

  async getArtistDetail(artistId: string, signal?: AbortSignal): Promise<ArtistDetail> {
    const library = await this.library(signal)
    const artist = library.artists.find(item => item.id === artistId)
    if (!artist) throw new WebDavFailure(t('webdav.error.noArtist'), 'http')
    return artist
  }

  async getArtistSongs(artist: { id?: string; name: string }, count = 20): Promise<Song[]> {
    const library = await this.library()
    const found = artist.id
      ? library.artists.find(item => item.id === artist.id)
      : library.artists.find(item => item.name === artist.name)
    return (found?.songs ?? []).slice(0, count)
  }

  async getPlaylists(): Promise<Playlist[]> {
    return []
  }

  async getPlaylistDetail(): Promise<PlaylistDetail> {
    throw new WebDavFailure(t('webdav.error.noPlaylists'), 'http')
  }

  async createPlaylist(): Promise<Playlist> {
    throw new WebDavFailure(t('webdav.error.noPlaylists'), 'http')
  }

  async deletePlaylist(): Promise<void> {
    throw new WebDavFailure(t('webdav.error.noPlaylists'), 'http')
  }

  async addSongsToPlaylist(): Promise<void> {
    throw new WebDavFailure(t('webdav.error.noPlaylists'), 'http')
  }

  async removeSongsFromPlaylist(): Promise<void> {
    throw new WebDavFailure(t('webdav.error.noPlaylists'), 'http')
  }

  async getStarred(): Promise<{ songs: Song[]; albums: Album[]; artists: Artist[] }> {
    return { songs: [], albums: [], artists: [] }
  }

  /**
   * 封面是文件夹里的 cover.jpg 一类。安卓上改成同源的 /_n1ko_dav/{协议}/{主机}{路径}，
   * 由原生补上账号去取，并按 size 缩小（NAS 上的封面常常几千像素，列表里几十张就是几十 MB）。
   * 同源还有一个好处：取色（artLight）读得到像素。
   */
  getCoverUrl(id: string, size?: number): string {
    if (!id) return ''
    const target = new URL(this.fileUrl(id))
    if (!webDavNativeAvailable() || typeof location === 'undefined') return target.toString()
    const scheme = target.protocol.replace(':', '')
    const sized = size ? `?s=${Math.round(size)}` : ''
    return `${location.origin}${COVER_PREFIX}${scheme}/${encodeURIComponent(target.host)}${target.pathname}${sized}`
  }

  /** 锁屏 / 通知栏的封面由原生插件自己下载，不经过 WebView，走播放口子 */
  getNativeCoverUrl(id: string, size = 256): string {
    if (!id || !this.proxyPrefix) return ''
    return `${this.proxyPrefix}${encodeURIComponent(this.fileUrl(id))}&s=${Math.round(size)}`
  }

  async getGenres(): Promise<Array<{ name: string; songCount: number; albumCount: number }>> {
    return []
  }

  /** 设置页的「扫描曲库」：重新列一遍目录，没变的文件不再读标签 */
  async startScan(): Promise<void> {
    if (this.scanning) return
    if (!this.indexPromise) {
      this.ensureScan()
      return
    }
    void this.scan(this.lastScan).catch(() => {
      // 连不上时保留现有的曲库
    })
  }

  async getScanStatus(): Promise<{ scanning: boolean; count?: number } | null> {
    return { scanning: this.scanning, count: this.published?.songs.length }
  }

  /** 曲目 / 封面 / 歌词 id → 当前地址上的文件 */
  private fileUrl(id: string): string {
    return fileUrlOf(this.base, id)
  }

  private library(signal?: AbortSignal): Promise<WebDavLibrary> {
    if (signal?.aborted) return Promise.reject(abortError())
    if (this.published) return Promise.resolve(this.published)
    this.ensureScan()
    return this.firstReady ?? this.indexPromise ?? Promise.reject(new Error(t('webdav.error.notScanned')))
  }

  private resetIndex(): void {
    this.indexPromise = null
    this.published = null
    this.lastScan = null
    this.firstReady = null
    this.resolveFirst = null
    this.rejectFirst = null
  }

  private ensureScan(): void {
    if (this.indexPromise) return
    this.firstReady = new Promise((resolve, reject) => {
      this.resolveFirst = resolve
      this.rejectFirst = reject
    })
    // 不把某一次页面请求的 signal 传进去：离开页面会 abort，
    // 整库扫描不该因此作废，下次进来还得从头列目录。
    this.indexPromise = this.loadAndScan().catch(err => {
      this.indexPromise = null
      this.rejectFirst?.(err)
      this.resolveFirst = null
      this.rejectFirst = null
      throw err
    })
  }

  /** 先摆出上次存下的曲库，再在后台重扫 */
  private async loadAndScan(): Promise<WebDavLibrary> {
    const cached = await this.readIndex()
    if (cached) {
      this.lastScan = cached
      this.publish(cached, true)
    }
    try {
      return await this.scan(cached)
    } catch (err) {
      // 连不上 NAS 时，上次的曲库照样能浏览（播放要等连上）
      if (this.published) return this.published
      throw err
    }
  }

  private async scan(previous: ScanState | null): Promise<WebDavLibrary> {
    this.scanning = true
    let firstPublish: ReturnType<typeof setTimeout> | undefined
    try {
      const state: ScanState = { files: [], covers: new Map(), lrcs: new Map() }
      /*
       * 第一次扫（盘上还没有曲库）：边列目录边读标签，读好的歌才摆出来，而且第一版尽量等整库读完再给
       * （最多等 FIRST_PUBLISH_WAIT_MS）。首页的每日推荐拿第一版算、存一整天：
       * 按文件名先摆出来，它记下的是「01 · 合辑 · 0:00」；摆得太早，它只从头几首里挑。
       * 已经有曲库在显示时，扫完再整体换掉，不拿扫了一半的结果去替换它。
       */
      let lastBuild = 0
      const startedAt = Date.now()
      const tags = previous ? null : new TagQueue(file => this.readTags(file), () => {
        const now = Date.now()
        if (!this.published && now - startedAt < FIRST_PUBLISH_WAIT_MS) return
        if (this.published && now - lastBuild < 1000) return
        lastBuild = now
        this.publish(state, false, true)
      })
      if (tags) {
        firstPublish = setTimeout(() => { if (!this.published) this.publish(state, false, true) }, FIRST_PUBLISH_WAIT_MS)
      }
      const run: ScanRun = { state, tags, seen: new Set(), found: 0, skippedDirs: 0, queued: new Set() }
      for (const root of this.scanRoots()) {
        const listed = await this.tryInfinity(root)
        if (listed) this.ingest(root, listed, run)
        else await this.walk(root, 0, run)
      }
      this.finishListing(run)
      if (tags) {
        await tags.drain()
        this.lastScan = state
        const library = this.publish(state, true)
        void this.writeIndex(state)
        this.scanning = false
        return library
      }
      reuseTags(state.files, previous?.files ?? [])
      this.lastScan = state
      const listed = this.publish(state, true)
      const pending = state.files.filter(file => !file.tagsRead)
      if (!pending.length) {
        void this.writeIndex(state)
        this.scanning = false
        return listed
      }
      // 标签要逐首读文件头。隔着 Tailscale 这会比列目录还久，
      // 不能挡着全部歌曲先出来。读一批换一版，读完存盘。
      void this.enrichTags(pending, state).finally(() => {
        this.publish(state, true)
        void this.writeIndex(state)
        this.scanning = false
      })
      return listed
    } catch (err) {
      this.scanning = false
      throw err
    } finally {
      clearTimeout(firstPublish)
    }
  }

  /**
   * 把目前扫到的文件收成曲库。第一批立刻交给正在等的页面，之后节流刷新。
   * onlyRead：只收已经读过标签的（第一次扫描的中途）。
   */
  private publish(state: ScanState, final: boolean, onlyRead = false): WebDavLibrary {
    const library = buildLibrary({
      serverId: this.serverId,
      root: this.base,
      files: onlyRead ? state.files.filter(file => file.tagsRead) : state.files,
      covers: state.covers,
      lrcs: state.lrcs,
    })
    const first = this.published == null
    this.published = library
    if (first && this.resolveFirst) {
      this.resolveFirst(library)
      this.resolveFirst = null
      this.rejectFirst = null
      return library
    }
    const now = Date.now()
    if (!final && now - this.lastRefresh < 1200) return library
    this.lastRefresh = now
    // 扫到一半只刷列表；扫完（或标签读完）连首页的随机推荐、最近添加一起换掉，
    // 不然那里一直是按文件名猜的歌名和 0:00 的时长
    queryClient.invalidateQueries({
      predicate: query => {
        const key = query.queryKey
        if (!Array.isArray(key) || typeof key[0] !== 'string') return false
        const owner = key[0].split('@', 1)[0]
        if (owner !== this.serverId) return false
        return final || key[1] === 'songs' || key[1] === 'albums' || key[1] === 'artists'
      },
    })
    return library
  }

  /**
   * 留空就扫连接地址；填了就只扫这几处，避免把照片和下载目录也走一遍。
   * 「/音乐/流行」按连接地址往下找；已经写全了连接地址那一段的也认。
   */
  private scanRoots(): string[] {
    const lines = this.musicPaths.split(/[\n,，]/).map(line => line.trim()).filter(Boolean)
    if (!lines.length) return [directoryUrl(this.base)]
    const base = new URL(directoryUrl(this.base))
    return lines.map(line => {
      if (/^https?:\/\//i.test(line)) return directoryUrl(line)
      const path = new URL(line.startsWith('/') ? line : `/${line}`, base.origin).pathname
      if (path === base.pathname.replace(/\/$/, '') || path.startsWith(base.pathname)) {
        return directoryUrl(base.origin + path)
      }
      return directoryUrl(new URL(path.replace(/^\/+/, ''), base).toString())
    })
  }

  /** 一个请求拿整棵树。服务器不支持或只回了一层时，退回逐层扫描。 */
  private async tryInfinity(root: string): Promise<DavEntry[] | null> {
    try {
      const entries = parsePropfind(await this.propfind(root, 'infinity'), root)
      if (!entries.some(entry => nestedUnder(root, entry.url))) return null
      return entries
    } catch {
      return null
    }
  }

  private ingest(root: string, entries: DavEntry[], run: ScanRun): void {
    const { state } = run
    const lrcByDir = new Map<string, Map<string, string>>()
    const added: WebDavFile[] = []
    for (const entry of entries) {
      if (entry.collection) continue
      // 逐层走时，回收站、@eaDir 这类目录整个不进去；一次拿整棵树时只看文件自己的名字不够，
      // 要看它相对扫描根的每一段路径，层数也按逐层走的上限算，两条路收出来的才一样
      const segments = relativeSegments(root, entry.url) ?? [entry.name]
      if (segments.length - 1 > MAX_DEPTH) continue
      if (isHiddenName(entry.name) || segments.some(isHiddenName)) continue
      const dir = parentDir(entry.url)
      if (isCoverName(entry.name)) {
        if (!state.covers.has(dir)) state.covers.set(dir, entry.url)
      } else if (isLrcName(entry.name)) {
        const bucket = lrcByDir.get(dir) ?? new Map<string, string>()
        bucket.set(basenameKey(entry.name), entry.url)
        lrcByDir.set(dir, bucket)
      } else if (isAudioName(entry.name)) {
        added.push(fileOf(entry, dir))
      }
    }
    for (const file of added) {
      const lrc = lrcByDir.get(file.directory)?.get(basenameKey(file.name))
      if (lrc) state.lrcs.set(file.url, lrc)
    }
    this.addFiles(run, added)
  }

  private async walk(dirUrl: string, depth: number, run: ScanRun): Promise<void> {
    const { state, seen } = run
    if (depth > MAX_DEPTH || seen.has(dirUrl)) return
    seen.add(dirUrl)
    let body: string
    try {
      body = await this.propfind(dirUrl, 1)
    } catch (err) {
      // 扫描根列不出来（账号不对、路径填错）要原样报给用户。
      // 子文件夹没权限（403）或服务器在这一处出错（500）只跳过它，别让一个文件夹拖垮整次扫描。
      // 连不上（network）是 NAS 整个掉线了：接着扫只会拿一份残缺的曲库覆盖上次的，照旧上抛。
      if (depth === 0 || !(err instanceof WebDavFailure) || err.kind === 'network') throw err
      run.skippedDirs += 1
      return
    }
    let entries: DavEntry[]
    try {
      entries = parsePropfind(body, dirUrl)
    } catch (err) {
      // 服务器回来的这一份列表解析不了（畸形的 href、越界的字符实体）：同样只跳过这个子文件夹
      if (depth === 0) throw err
      run.skippedDirs += 1
      return
    }
    const subdirs: string[] = []
    const folderFiles: WebDavFile[] = []
    const folderLrc = new Map<string, string>()
    for (const entry of entries) {
      if (isHiddenName(entry.name)) continue
      if (entry.collection) {
        subdirs.push(entry.url)
        continue
      }
      if (isCoverName(entry.name)) {
        if (!state.covers.has(dirUrl)) state.covers.set(dirUrl, entry.url)
      } else if (isLrcName(entry.name)) {
        folderLrc.set(basenameKey(entry.name), entry.url)
      } else if (isAudioName(entry.name)) {
        folderFiles.push(fileOf(entry, dirUrl))
      }
    }
    for (const file of folderFiles) {
      const lrc = folderLrc.get(basenameKey(file.name))
      if (lrc) state.lrcs.set(file.url, lrc)
    }
    this.addFiles(run, folderFiles)
    await mapPool(subdirs, 6, dir => this.walk(dir, depth + 1, run))
  }

  /**
   * 收下列出来的音频文件。超过 MAX_FILES 时不在半路停：6 路并发下哪个文件夹先回来不一定，
   * 停在半路，每次扫描留下的就是不同的一万首。先都记着，列完再按路径挑（finishListing）。
   */
  private addFiles(run: ScanRun, files: WebDavFile[]): void {
    const { state, tags } = run
    run.found += files.length
    const toRead: WebDavFile[] = []
    for (const file of files) {
      state.files.push(file)
      // 超出上限的先不读标签，列完挑定了再补读，免得白读一堆最后不收的
      if (tags && run.queued.size < MAX_FILES) {
        run.queued.add(file)
        toRead.push(file)
      }
    }
    if (toRead.length) tags?.push(toRead)
    // 远超上限的大库：排在后面的已经不可能入选，先扔掉，内存不跟着库一起涨
    if (state.files.length > MAX_FILES * 2) state.files = firstByPath(state.files)
  }

  /** 列完目录：超了上限就按路径挑出排在前面的那些，并告诉用户一次 */
  private finishListing(run: ScanRun): void {
    const { state, tags } = run
    if (run.skippedDirs) {
      log.warn('webdav', `有 ${run.skippedDirs} 个子文件夹列不出来（没权限或服务器出错），这次跳过`)
    }
    if (run.found <= MAX_FILES) return
    state.files = firstByPath(state.files)
    const kept = new Set(state.files.map(file => file.url))
    for (const url of [...state.lrcs.keys()]) {
      if (!kept.has(url)) state.lrcs.delete(url)
    }
    if (tags) tags.push(state.files.filter(file => !run.queued.has(file)))
    // 每个音源每次运行只说一次：之后的每次重扫结果都一样，再弹就成了打扰
    if (truncationNotified.has(this.serverId)) return
    truncationNotified.add(this.serverId)
    toast({
      title: t('webdav.scan.truncated', { found: run.found, count: state.files.length, limit: MAX_FILES }),
    })
  }

  /** 重扫时给新增和改过的文件读标签。读一批换一版、存一次盘。 */
  private async enrichTags(files: WebDavFile[], state: ScanState): Promise<void> {
    let done = 0
    await mapPool(files, 6, async file => {
      await this.readTags(file)
      done += 1
      if (done % TAG_PUBLISH_EVERY === 0) {
        this.publish(state, false)
        void this.writeIndex(state)
      }
    })
  }

  /** 读一首歌开头的标签和时长。读不到就留空，后面用文件名。 */
  private async readTags(file: WebDavFile): Promise<void> {
    try {
      let bytes = await this.readHeader(file.url, 65536)
      if (!bytes) {
        // 服务器明确说读不了这个文件（404 / 416 之类），当它没有标签
        file.tagsRead = true
        return
      }
      let tags = readAudioTags(bytes, { fileSize: file.size })
      let complete = true
      if (tags.bytesNeeded && tags.bytesNeeded > bytes.length && (!file.size || bytes.length < file.size)) {
        try {
          const more = await this.readHeader(file.url, tags.bytesNeeded)
          if (more) {
            bytes = more
            tags = readAudioTags(bytes, { fileSize: file.size })
          }
        } catch {
          // 补读那一下碰上临时错误：先用第一次读到的，不标已读，下次扫描再补全
          complete = false
        }
      }
      file.tagTitle = tags.title
      file.tagArtist = tags.artist
      file.tagAlbumArtist = tags.albumArtist
      file.tagAlbum = tags.album
      file.tagTrack = tags.track
      file.tagDuration = tags.duration
      if (complete) file.tagsRead = true
    } catch {
      // 这一首这次没读到（NAS 忙得回 503 / 429、断网之类），不标已读，下次扫描再试；文件名和文件夹还能用
    }
  }

  /**
   * 读文件开头 length 个字节。
   * 返回 null：服务器明确说这个文件读不了（UNREADABLE_STATUS）。其余失败都抛出，留到下次扫描再读。
   */
  private async readHeader(url: string, length: number): Promise<Uint8Array | null> {
    const want = Math.min(Math.max(length, 1), 262144)
    await this.ensureNative()
    if (webDavNativeAvailable()) {
      const result = await WebDavNative.getRange({ url, length: want })
      if (result.status !== 200 && result.status !== 206) return headerFailure(result.status)
      if (!result.body) return null
      return decodeBase64(result.body)
    }
    const response = await fetch(url, {
      headers: {
        Authorization: basicAuth(this.username, this.password),
        Range: `bytes=0-${want - 1}`,
      },
    })
    if (!response.ok) {
      void response.body?.cancel().catch(() => {})
      return headerFailure(response.status)
    }
    return readPrefix(response, want)
  }

  private indexKey(): string {
    return `webdav-index:${this.serverId}`
  }

  private async readIndex(): Promise<ScanState | null> {
    try {
      const entry = await readCacheEntry<StoredIndex>(this.indexKey())
      const stored = entry?.value
      if (!stored || stored.v !== INDEX_VERSION || !Array.isArray(stored.files) || !stored.files.length) return null
      const at = (path: string) => fileUrlOf(this.base, path)
      return {
        files: stored.files.map(file => ({ ...file, url: at(file.url), directory: at(file.directory) })),
        covers: new Map(stored.covers.map(([dir, cover]) => [at(dir), at(cover)])),
        lrcs: new Map(stored.lrcs.map(([file, lrc]) => [at(file), at(lrc)])),
      }
    } catch {
      return null
    }
  }

  private async writeIndex(state: ScanState): Promise<void> {
    const value: StoredIndex = {
      v: INDEX_VERSION,
      files: state.files.map(file => ({ ...file, url: idOf(file.url), directory: idOf(file.directory) })),
      covers: [...state.covers].map(([dir, cover]) => [idOf(dir), idOf(cover)]),
      lrcs: [...state.lrcs].map(([file, lrc]) => [idOf(file), idOf(lrc)]),
    }
    await writeCacheEntry(this.indexKey(), this.serverId, value)
  }

  private async ensureNative(): Promise<void> {
    if (!webDavNativeAvailable()) return
    if (!this.nativeReady) {
      this.nativeReady = WebDavNative.configure({
        baseUrl: this.base,
        username: this.username,
        password: this.password,
      }).then(result => {
        this.proxyPrefix = result.proxy
      }).catch(err => {
        this.nativeReady = null
        throw err
      })
    }
    await this.nativeReady
  }

  private async propfind(url: string, depth: number | 'infinity'): Promise<string> {
    await this.ensureNative()
    if (webDavNativeAvailable()) {
      try {
        const result = await WebDavNative.propfind({ url, depth })
        return this.readDav(result.status, result.body)
      } catch (err) {
        if (err instanceof WebDavFailure) throw err
        const detail = err instanceof Error ? err.message : ''
        throw new WebDavFailure(detail, 'network')
      }
    }
    let response: Response
    try {
      response = await fetch(url, {
        method: 'PROPFIND',
        headers: {
          Depth: String(depth),
          Authorization: basicAuth(this.username, this.password),
          'Content-Type': 'application/xml; charset=utf-8',
        },
        body: PROPFIND_BODY,
      })
    } catch {
      throw new WebDavFailure('', 'network')
    }
    return this.readDav(response.status, await response.text())
  }

  private async getText(url: string): Promise<string> {
    await this.ensureNative()
    if (webDavNativeAvailable()) {
      const result = await WebDavNative.getText({ url })
      if (result.status === 401 || result.status === 403) throw new WebDavFailure(t('webdav.error.auth'), 'auth')
      if (result.status < 200 || result.status >= 300) throw new WebDavFailure(t('webdav.error.lyrics'), 'http')
      return result.body
    }
    const response = await fetch(url, { headers: { Authorization: basicAuth(this.username, this.password) } })
    if (!response.ok) throw new WebDavFailure(t('webdav.error.lyrics'), 'http')
    return response.text()
  }

  private readDav(status: number, body: string): string {
    if (status === 401 || status === 403) throw new WebDavFailure(t('webdav.error.auth'), 'auth')
    if (status !== 207 && status !== 200) throw new WebDavFailure(t('webdav.error.status', { status }), 'http')
    return body
  }

  private loginMessage(err: unknown): string {
    if (err instanceof WebDavFailure) {
      if (err.kind === 'auth') return t('webdav.error.auth')
      if (err.kind === 'network') {
        if (!webDavNativeAvailable()) return t('webdav.error.browser')
        return err.message
          ? t('webdav.error.unreachableDetail', { detail: err.message })
          : t('webdav.error.unreachable')
      }
      return err.message
    }
    if (err instanceof TypeError) return t('webdav.error.badUrl')
    return t('webdav.error.generic')
  }
}

class WebDavFailure extends Error {
  constructor(message: string, readonly kind: 'auth' | 'network' | 'http') {
    super(message)
  }
}

/** 第一次扫描时边列目录边读标签：同时最多读 limit 首，每读完一首回调一次 */
class TagQueue {
  private queue: WebDavFile[] = []
  private running = 0
  private waiting: Array<() => void> = []

  constructor(
    private readonly read: (file: WebDavFile) => Promise<void>,
    private readonly onRead: () => void,
    private readonly limit = 6,
  ) {}

  push(files: WebDavFile[]): void {
    this.queue.push(...files)
    this.pump()
  }

  /** 列目录结束后调用：等手上和排着的都读完 */
  drain(): Promise<void> {
    if (!this.running && !this.queue.length) return Promise.resolve()
    return new Promise(resolve => this.waiting.push(resolve))
  }

  private pump(): void {
    while (this.running < this.limit) {
      const file = this.queue.shift()
      if (!file) break
      this.running += 1
      void this.read(file).finally(() => {
        this.running -= 1
        this.onRead()
        this.pump()
        if (!this.running && !this.queue.length) this.waiting.splice(0).forEach(resolve => resolve())
      })
    }
  }
}

/** 旧测试版把整条文件地址当 id，统一成路径 */
function normalizeId(id: string): string {
  return /^https?:\/\//i.test(id) ? idOf(id) : id
}

function fileOf(entry: DavEntry, directory: string): WebDavFile {
  return {
    url: entry.url,
    name: entry.name,
    directory,
    size: entry.size,
    modified: entry.modified,
    etag: entry.etag,
  }
}

/** 文件没变（etag 一样，或大小和修改时间都一样）就沿用上次读到的标签 */
function reuseTags(files: WebDavFile[], previous: WebDavFile[]): void {
  if (!previous.length) return
  const byUrl = new Map(previous.map(file => [file.url, file]))
  for (const file of files) {
    const old = byUrl.get(file.url)
    if (!old?.tagsRead) continue
    const same = file.etag && old.etag
      ? file.etag === old.etag
      : file.size === old.size && file.modified === old.modified
    if (!same) continue
    file.tagTitle = old.tagTitle
    file.tagArtist = old.tagArtist
    file.tagAlbumArtist = old.tagAlbumArtist
    file.tagAlbum = old.tagAlbum
    file.tagTrack = old.tagTrack
    file.tagDuration = old.tagDuration
    file.tagsRead = true
  }
}

function basicAuth(username: string, password: string): string {
  const raw = `${username}:${password}`
  const bytes = new TextEncoder().encode(raw)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `Basic ${btoa(binary)}`
}

function paginate<T>(items: T[], params: ListParams): PageResult<T> {
  const offset = params.offset ?? 0
  const size = params.size ?? items.length
  return {
    items: items.slice(offset, offset + size),
    total: items.length,
    offset,
    size,
  }
}

function shuffle<T>(items: T[]): T[] {
  const copy = items.slice()
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = copy[i]
    copy[i] = copy[j]
    copy[j] = tmp
  }
  return copy
}

function abortError(): Error {
  return new DOMException('The operation was aborted.', 'AbortError')
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

function parentDir(fileUrl: string): string {
  const url = new URL(fileUrl)
  const path = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname
  const slash = path.lastIndexOf('/')
  url.pathname = slash <= 0 ? '/' : path.slice(0, slash + 1)
  return url.toString()
}

/** 隐藏文件、回收站、NAS 的系统目录 */
function isHiddenName(name: string): boolean {
  return name.startsWith('.') || name.startsWith('#') || HIDDEN_DIRS.has(name.toLowerCase())
}

/**
 * 文件相对扫描根的各段路径（解码后，最后一段是文件名）。不在根下面时返回 null。
 * 按段解码后再比：服务器回的编码（大小写、哪些字符编码）不一定和填的地址一样。
 */
function relativeSegments(root: string, entryUrl: string): string[] | null {
  const decoded = (pathname: string) => pathname.split('/').filter(Boolean).map(part => {
    try {
      return decodeURIComponent(part)
    } catch {
      return part
    }
  })
  const base = decoded(new URL(directoryUrl(root)).pathname)
  const parts = decoded(new URL(entryUrl).pathname)
  if (parts.length <= base.length || base.some((part, i) => part !== parts[i])) return null
  return parts.slice(base.length)
}

/** 按地址排序后留前 MAX_FILES 首：同一个库每次挑出来的是同一批，而且是整个文件夹整个文件夹地留 */
function firstByPath(files: WebDavFile[]): WebDavFile[] {
  return files
    .slice()
    .sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0))
    .slice(0, MAX_FILES)
}

function headerFailure(status: number): null {
  if (UNREADABLE_STATUS.has(status)) return null
  throw new WebDavFailure(t('webdav.error.status', { status }), 'http')
}

/**
 * 只读响应开头 want 个字节就停。
 * 有的服务器不认 Range，照样回 200 和整首歌：arrayBuffer() 会把几十 MB 的 FLAC 整个下载下来，
 * 6 路并发读标签时带宽和内存一起被吃光。读够了就 cancel，连接随之断开。
 */
async function readPrefix(response: Response, want: number): Promise<Uint8Array> {
  const reader = response.body?.getReader()
  // 有的壳把 fetch 换成了自己的实现，响应没有可读流：退回整块读再截。
  // 不能当成「读到 0 个字节」——那会被记成「这首歌没有标签」，文件不变就再也不读了
  if (!reader) return new Uint8Array(await response.arrayBuffer()).subarray(0, want)
  const out = new Uint8Array(want)
  let filled = 0
  try {
    while (filled < want) {
      const { done, value } = await reader.read()
      if (done) break
      const take = Math.min(value.length, want - filled)
      out.set(value.subarray(0, take), filled)
      filled += take
    }
  } finally {
    void reader.cancel().catch(() => {})
  }
  return out.subarray(0, filled)
}

function nestedUnder(root: string, entryUrl: string): boolean {
  const base = new URL(directoryUrl(root)).pathname.replace(/\/+$/, '')
  const path = new URL(entryUrl).pathname.replace(/\/+$/, '')
  const rest = path.startsWith(base) ? path.slice(base.length) : ''
  return rest.split('/').filter(Boolean).length > 1
}

async function mapPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  if (!items.length) return
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      await fn(items[index])
    }
  })
  await Promise.all(workers)
}
