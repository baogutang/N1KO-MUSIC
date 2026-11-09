/**
 * WebDAV 音源。
 *
 * 给没有 Navidrome / Jellyfin 的 NAS 用。打开设备的 WebDAV 服务后，
 * 填它的地址（例如 http://192.168.1.3:5005）和 NAS 自己的账号。
 * 播放地址仍是文件的真实 URL，认证由安卓 WebView 拦截后补上。
 */

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
import {
  basenameKey,
  buildLibrary,
  directoryUrl,
  isAudioName,
  isCoverName,
  isLrcName,
  normalizeBase,
  parsePropfind,
  retargetFileUrl,
  type WebDavFile,
  type WebDavLibrary,
} from './webdavLibrary'
import { readAudioTags } from './audioTags'
import { Capacitor } from '@capacitor/core'
import { queryClient } from '@/lib/queryClient'
import { WebDavNative, webDavNativeAvailable, NATIVE_FLAC_PREFIX } from './webdavNative'

const PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:displayname/>
    <d:resourcetype/>
    <d:getcontentlength/>
    <d:getcontenttype/>
  </d:prop>
</d:propfind>`

const MAX_DEPTH = 8
const MAX_FILES = 10000

interface WebDavOptions {
  url: string
  username: string
  password: string
  serverId: string
  musicPaths?: string
}

export class WebDavAdapter implements MusicServerAdapter {
  readonly type: ServerType = 'webdav'

  private base: string
  private username: string
  private password: string
  private readonly serverId: string
  private musicPaths: string
  private nativeReady: Promise<void> | null = null
  private indexPromise: Promise<WebDavLibrary> | null = null
  /** 已经能拿来显示的曲库。目录还在往下扫时，这里是已经扫到的那一部分。 */
  private published: WebDavLibrary | null = null
  private firstReady: Promise<WebDavLibrary> | null = null
  private resolveFirst: ((library: WebDavLibrary) => void) | null = null
  private rejectFirst: ((err: unknown) => void) | null = null
  private lastRefresh = 0

  constructor(options: WebDavOptions) {
    this.base = normalizeBase(options.url)
    this.username = options.username
    this.password = options.password
    this.serverId = options.serverId
    this.musicPaths = options.musicPaths ?? ''
    if (this.password) void this.ensureNative()
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
    return library.songs.find(song => song.id === songId) ?? null
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
    void this.ensureNative()
    return retargetFileUrl(songId, this.base)
  }

  async resolveStreamUrl(songId: string): Promise<{ url: string; mimeType?: string }> {
    await this.ensureNative()
    const target = retargetFileUrl(songId, this.base)
    if (Capacitor.isNativePlatform()) {
      const path = target.split(/[?#]/, 1)[0] ?? target
      if (Capacitor.getPlatform() === 'android' && path.toLowerCase().endsWith('.flac')) {
        return { url: NATIVE_FLAC_PREFIX + target, mimeType: 'audio/flac' }
      }
      const streamed = await WebDavNative.streamUrl({ target })
      return { url: streamed.url }
    }
    return { url: target }
  }

  async getLyrics(songId: string): Promise<Lyrics | null> {
    const library = await this.library()
    const lrcUrl = library.lrcBySongId.get(songId)
    if (!lrcUrl) return null
    const text = await this.getText(lrcUrl)
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
    if (!album) throw new WebDavFailure('找不到这个专辑', 'http')
    return album
  }

  async getRecentAlbums(size = 20, signal?: AbortSignal): Promise<Album[]> {
    const library = await this.library(signal)
    return library.albums.slice(0, size)
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
    if (!artist) throw new WebDavFailure('找不到这个歌手', 'http')
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
    throw new WebDavFailure('WebDAV 没有服务端歌单', 'http')
  }

  async createPlaylist(): Promise<Playlist> {
    throw new WebDavFailure('WebDAV 不能在服务器上新建歌单', 'http')
  }

  async deletePlaylist(): Promise<void> {
    throw new WebDavFailure('WebDAV 不能在服务器上删除歌单', 'http')
  }

  async addSongsToPlaylist(): Promise<void> {
    throw new WebDavFailure('WebDAV 不能修改服务端歌单', 'http')
  }

  async removeSongsFromPlaylist(): Promise<void> {
    throw new WebDavFailure('WebDAV 不能修改服务端歌单', 'http')
  }

  async getStarred(): Promise<{ songs: Song[]; albums: Album[]; artists: Artist[] }> {
    return { songs: [], albums: [], artists: [] }
  }

  getCoverUrl(id: string): string {
    if (id.startsWith('http://') || id.startsWith('https://')) return id
    return ''
  }

  async getGenres(): Promise<Array<{ name: string; songCount: number; albumCount: number }>> {
    return []
  }

  private library(signal?: AbortSignal): Promise<WebDavLibrary> {
    if (signal?.aborted) return Promise.reject(abortError())
    if (this.published) return Promise.resolve(this.published)
    this.ensureScan()
    return this.firstReady ?? this.indexPromise ?? Promise.reject(new Error('曲库还没开始扫描'))
  }

  private resetIndex(): void {
    this.indexPromise = null
    this.published = null
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
    this.indexPromise = this.scan().catch(err => {
      this.indexPromise = null
      this.rejectFirst?.(err)
      this.resolveFirst = null
      this.rejectFirst = null
      throw err
    })
  }

  private async scan(): Promise<WebDavLibrary> {
    const files: WebDavFile[] = []
    const covers = new Map<string, string>()
    const lrcs = new Map<string, string>()
    const seen = new Set<string>()
    for (const root of this.scanRoots()) {
      const listed = await this.tryInfinity(root)
      if (listed) {
        this.ingest(listed, files, covers, lrcs)
        this.publish(files, covers, lrcs, false)
      } else {
        await this.walk(root, 0, files, covers, lrcs, seen)
      }
    }
    const listed = this.publish(files, covers, lrcs, true)
    // 标签要逐首读文件头。隔着 Tailscale 这会比列目录还久，
    // 不能挡着全部歌曲先出来。读完再换上带标签的那一版。
    void this.enrichTags(files).then(() => {
      this.publish(files, covers, lrcs, true)
    }).catch(() => {
      // 标签读不完也还有文件名和文件夹
    })
    return listed
  }

  /** 把目前扫到的文件收成曲库。第一批立刻交给正在等的页面，之后节流刷新。 */
  private publish(
    files: WebDavFile[],
    covers: Map<string, string>,
    lrcs: Map<string, string>,
    final: boolean,
  ): WebDavLibrary {
    const library = buildLibrary({
      serverId: this.serverId,
      root: this.base,
      files,
      covers,
      lrcs,
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
    queryClient.invalidateQueries({
      predicate: query => {
        const key = query.queryKey
        if (!Array.isArray(key) || typeof key[0] !== 'string') return false
        const owner = key[0].split('@', 1)[0]
        if (owner !== this.serverId) return false
        return key[1] === 'songs' || key[1] === 'albums' || key[1] === 'artists'
      },
    })
    return library
  }

  /** 留空就扫连接地址；填了就只扫这几处，避免把照片和下载目录也走一遍。 */
  private scanRoots(): string[] {
    const lines = this.musicPaths.split(/[\n,，]/).map(line => line.trim()).filter(Boolean)
    if (!lines.length) return [directoryUrl(this.base)]
    return lines.map(line => {
      if (/^https?:\/\//i.test(line)) return directoryUrl(line)
      const path = line.startsWith('/') ? line : `/${line}`
      return directoryUrl(new URL(path, directoryUrl(this.base)).toString())
    })
  }

  /** 一个请求拿整棵树。服务器不支持或只回了一层时，退回逐层扫描。 */
  private async tryInfinity(root: string): Promise<ReturnType<typeof parsePropfind> | null> {
    try {
      const entries = parsePropfind(await this.propfind(root, 'infinity'), root)
      if (!entries.some(entry => nestedUnder(root, entry.url))) return null
      return entries
    } catch {
      return null
    }
  }

  private ingest(
    entries: ReturnType<typeof parsePropfind>,
    files: WebDavFile[],
    covers: Map<string, string>,
    lrcs: Map<string, string>,
  ): void {
    const lrcByDir = new Map<string, Map<string, string>>()
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name.startsWith('#')) continue
      if (entry.collection) continue
      const dir = parentDir(entry.url)
      if (isCoverName(entry.name)) {
        if (!covers.has(dir)) covers.set(dir, entry.url)
      } else if (isLrcName(entry.name)) {
        const bucket = lrcByDir.get(dir) ?? new Map<string, string>()
        bucket.set(basenameKey(entry.name), entry.url)
        lrcByDir.set(dir, bucket)
      } else if (isAudioName(entry.name) && files.length < MAX_FILES) {
        files.push({ url: entry.url, name: entry.name, directory: dir, size: entry.size })
      }
    }
    for (const file of files) {
      const lrc = lrcByDir.get(file.directory)?.get(basenameKey(file.name))
      if (lrc) lrcs.set(file.url, lrc)
    }
  }

  private async walk(
    dirUrl: string,
    depth: number,
    files: WebDavFile[],
    covers: Map<string, string>,
    lrcs: Map<string, string>,
    seen: Set<string>,
  ): Promise<void> {
    if (depth > MAX_DEPTH || files.length >= MAX_FILES || seen.has(dirUrl)) return
    seen.add(dirUrl)
    const entries = parsePropfind(await this.propfind(dirUrl, 1), dirUrl)
    const subdirs: string[] = []
    const folderFiles: WebDavFile[] = []
    const folderLrc = new Map<string, string>()
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name.startsWith('#')) continue
      if (entry.collection) {
        subdirs.push(entry.url)
        continue
      }
      if (isCoverName(entry.name) && !covers.has(dirUrl)) covers.set(dirUrl, entry.url)
      else if (isLrcName(entry.name)) folderLrc.set(basenameKey(entry.name), entry.url)
      else if (isAudioName(entry.name)) {
        folderFiles.push({ url: entry.url, name: entry.name, directory: dirUrl, size: entry.size })
      }
    }
    for (const file of folderFiles) {
      files.push(file)
      const lrc = folderLrc.get(basenameKey(file.name))
      if (lrc) lrcs.set(file.url, lrc)
    }
    if (folderFiles.length) this.publish(files, covers, lrcs, false)
    await mapPool(subdirs, 8, dir => this.walk(dir, depth + 1, files, covers, lrcs, seen))
  }

  /** 读每首歌开头的标签。读不到就留空，后面用文件名。 */
  private async enrichTags(files: WebDavFile[]): Promise<void> {
    await mapPool(files, 8, async file => {
      try {
        let bytes = await this.readHeader(file.url, 65536)
        if (!bytes) return
        let tags = readAudioTags(bytes)
        if (tags.bytesNeeded && tags.bytesNeeded > bytes.length) {
          bytes = await this.readHeader(file.url, tags.bytesNeeded)
          if (bytes) tags = readAudioTags(bytes)
        }
        file.tagTitle = tags.title
        file.tagArtist = tags.artist
        file.tagAlbum = tags.album
        file.tagTrack = tags.track
      } catch {
        // 这一首没有标签，文件名和文件夹还能用
      }
    })
  }

  private async readHeader(url: string, length: number): Promise<Uint8Array | null> {
    const want = Math.min(Math.max(length, 1), 262144)
    await this.ensureNative()
    if (Capacitor.isNativePlatform()) {
      const result = await WebDavNative.getRange({ url, length: want })
      if (result.status !== 200 && result.status !== 206) return null
      if (!result.body) return null
      return decodeBase64(result.body)
    }
    const response = await fetch(url, {
      headers: {
        Authorization: basicAuth(this.username, this.password),
        Range: `bytes=0-${want - 1}`,
      },
    })
    if (!response.ok && response.status !== 206) return null
    return new Uint8Array(await response.arrayBuffer())
  }

  private async ensureNative(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return
    if (!this.nativeReady) {
      this.nativeReady = WebDavNative.configure({
        baseUrl: this.base,
        username: this.username,
        password: this.password,
      }).catch(err => {
        this.nativeReady = null
        throw err
      })
    }
    await this.nativeReady
  }

  private async propfind(url: string, depth: number | 'infinity'): Promise<string> {
    await this.ensureNative()
    if (Capacitor.isNativePlatform()) {
      try {
        const result = await WebDavNative.propfind({ url, depth })
        return this.readDav(result.status, result.body)
      } catch (err) {
        if (err instanceof WebDavFailure) throw err
        const detail = err instanceof Error ? err.message : '连不上'
        throw new WebDavFailure(detail || '连不上', 'network')
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
      throw new WebDavFailure('连不上', 'network')
    }
    return this.readDav(response.status, await response.text())
  }

  private async getText(url: string): Promise<string> {
    await this.ensureNative()
    if (webDavNativeAvailable()) {
      const result = await WebDavNative.getText({ url })
      if (result.status === 401 || result.status === 403) throw new WebDavFailure('账号或密码不对', 'auth')
      if (result.status < 200 || result.status >= 300) throw new WebDavFailure('读歌词失败', 'http')
      return result.body
    }
    const response = await fetch(url, { headers: { Authorization: basicAuth(this.username, this.password) } })
    if (!response.ok) throw new WebDavFailure('读歌词失败', 'http')
    return response.text()
  }

  private readDav(status: number, body: string): string {
    if (status === 401 || status === 403) throw new WebDavFailure('账号或密码不对', 'auth')
    if (status !== 207 && status !== 200) throw new WebDavFailure(`WebDAV ${status}`, 'http')
    return body
  }

  private loginMessage(err: unknown): string {
    if (err instanceof WebDavFailure) {
      if (err.kind === 'auth') return '账号或密码不对'
      if (err.kind === 'network') {
        const detail = err.message && err.message !== '连不上' ? `：${err.message}` : ''
        return Capacitor.isNativePlatform()
          ? `连不上这台 WebDAV${detail}。请确认地址能从这台设备访问，并且账号密码正确`
          : '浏览器跨域限制，无法直接连接 WebDAV。请使用安卓 App 连接。'
      }
    }
    if (err instanceof TypeError) return '地址不是一个有效的 http 链接'
    return '连接失败，请检查地址和账号密码'
  }
}

class WebDavFailure extends Error {
  constructor(message: string, readonly kind: 'auth' | 'network' | 'http') {
    super(message)
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
