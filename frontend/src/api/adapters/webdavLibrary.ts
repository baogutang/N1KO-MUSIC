/**
 * WebDAV 目录解析与曲库拼装。
 *
 * 歌名、歌手、专辑优先用文件里的标签，其次用「歌手 - 歌名」这种文件名。
 * 两样都没有时，才用文件夹名兜底。
 *
 * 曲目 / 封面 / 歌词的 id 是文件在服务器上的路径（URL 的 pathname，保持服务器给的编码），
 * 不带主机。NAS 换了 IP 或端口，只改服务器地址就行：队列、历史、歌单、缓存里的 id 都不用动，
 * 用到时再拼上当前地址（fileUrlOf）。id 里也就不会带着局域网地址被分享、同步或发给歌词接口。
 */

import type { AlbumDetail, ArtistDetail, Song } from '../types'
import { parseAudioFilename } from './audioTags'

const AUDIO_EXT = new Set([
  'mp3', 'flac', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'oga', 'aiff', 'aif', 'alac',
])

const COVER_NAMES = new Set([
  'cover.jpg', 'cover.jpeg', 'cover.png', 'cover.webp',
  'folder.jpg', 'folder.jpeg', 'folder.png', 'folder.webp',
  'front.jpg', 'front.jpeg', 'front.png',
  'album.jpg', 'albumart.jpg',
])

export interface DavEntry {
  url: string
  name: string
  collection: boolean
  size?: number
  contentType?: string
  /** 服务器给的最后修改时间（毫秒），没有就是 undefined */
  modified?: number
  etag?: string
}

export interface WebDavFile {
  url: string
  name: string
  /** 所在目录，带结尾斜杠 */
  directory: string
  size?: number
  modified?: number
  etag?: string
  tagTitle?: string
  tagArtist?: string
  tagAlbumArtist?: string
  tagAlbum?: string
  tagTrack?: number
  /** 从文件头算出的时长（秒） */
  tagDuration?: number
  /** 标签读过了（读不到也算），下次扫描文件没变就不再读 */
  tagsRead?: boolean
}

export interface WebDavLibrary {
  songs: Song[]
  albums: AlbumDetail[]
  artists: ArtistDetail[]
  /** 按修改时间从新到旧 */
  recentAlbums: AlbumDetail[]
  /** 曲目 id → 同目录同名 .lrc 的 id */
  lrcBySongId: Map<string, string>
}

export function isAudioName(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return AUDIO_EXT.has(ext)
}

export function isCoverName(name: string): boolean {
  return COVER_NAMES.has(name.toLowerCase())
}

export function isLrcName(name: string): boolean {
  return name.toLowerCase().endsWith('.lrc')
}

/** 连上之前先把用户填的地址收成不带结尾斜杠的 origin+path */
export function normalizeBase(input: string): string {
  const url = new URL(input.trim())
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('只支持 http 或 https')
  }
  url.hash = ''
  url.search = ''
  if (url.pathname !== '/' && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '')
  }
  return url.toString().replace(/\/$/, '')
}

export function directoryUrl(baseOrDir: string): string {
  return baseOrDir.endsWith('/') ? baseOrDir : `${baseOrDir}/`
}

/** 文件地址 → id：只留路径，保持服务器给的编码（同一个文件永远是同一个 id） */
export function idOf(fileUrl: string): string {
  return new URL(fileUrl).pathname
}

/**
 * id → 当前服务器上的地址。
 * 也认旧版留下的完整地址（PR #38 合并前的测试版本把整条 URL 当 id），只换成当前的主机。
 */
export function fileUrlOf(base: string, id: string): string {
  const origin = new URL(base).origin
  if (/^https?:\/\//i.test(id)) {
    const old = new URL(id)
    return origin + id.slice(old.origin.length)
  }
  return origin + (id.startsWith('/') ? id : `/${id}`)
}

/** 给人看的路径（解码后），也是歌词 / 封面接口里的 {path} */
export function displayPath(id: string): string {
  try {
    return decodeURI(id)
  } catch {
    return id
  }
}

function pathKey(url: URL): string {
  const raw = url.pathname.replace(/\/+$/, '') || '/'
  try {
    return decodeURI(raw)
  } catch {
    return raw
  }
}

export function sameResource(a: string, b: string): boolean {
  const left = new URL(a)
  const right = new URL(b)
  return left.origin === right.origin && pathKey(left) === pathKey(right)
}

function decodeXml(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&')
}

function tagText(block: string, tag: string): string | null {
  const re = new RegExp(`<(?:[\\w.-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?${tag}>`, 'i')
  const match = re.exec(block)
  if (!match) return null
  return decodeXml(match[1].trim())
}

function lastSegment(url: string): string {
  const parts = new URL(url).pathname.split('/').filter(Boolean)
  const raw = parts[parts.length - 1] ?? ''
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/**
 * 解析一次 Depth:1 的 PROPFIND。当前目录自己那条会被丢掉。
 */
export function parsePropfind(xml: string, requestUrl: string): DavEntry[] {
  const blocks = xml.split(/<(?:[\w.-]+:)?response\b/i).slice(1)
  const entries: DavEntry[] = []
  for (const raw of blocks) {
    const block = raw.split(/<\/(?:[\w.-]+:)?response>/i)[0] ?? raw
    const href = tagText(block, 'href')
    if (!href) continue
    let url: string
    try {
      url = new URL(href, requestUrl).toString()
    } catch {
      continue
    }
    if (sameResource(url, requestUrl)) continue
    const collection = /<(?:[\w.-]+:)?collection\b/i.test(block) || href.endsWith('/')
    const name = tagText(block, 'displayname') || lastSegment(url)
    const length = Number(tagText(block, 'getcontentlength'))
    const contentType = tagText(block, 'getcontenttype') ?? undefined
    const modified = Date.parse(tagText(block, 'getlastmodified') ?? '')
    const etag = tagText(block, 'getetag') ?? undefined
    entries.push({
      url: collection ? directoryUrl(url) : url.replace(/\/$/, ''),
      name,
      collection,
      size: Number.isFinite(length) && length > 0 ? length : undefined,
      contentType: contentType || undefined,
      modified: Number.isFinite(modified) ? modified : undefined,
      etag: etag || undefined,
    })
  }
  return entries
}

function parentDirectory(directory: string): string {
  const url = new URL(directory)
  const parts = url.pathname.split('/').filter(Boolean)
  parts.pop()
  url.pathname = parts.length ? `/${parts.join('/')}/` : '/'
  return url.toString()
}

function folderName(directory: string): string {
  return lastSegment(directory) || '全部音乐'
}

function text(value: string | undefined): string {
  const trimmed = value?.trim() ?? ''
  return trimmed
}

/** 标签和文件名都没有时，才用文件夹。上一级是歌手，当前文件夹是专辑。 */
function folderFallback(directory: string, rootDir: string): { artist: string; album: string } {
  const atRoot = sameResource(directory, rootDir)
  const album = atRoot ? '全部音乐' : folderName(directory)
  const parent = parentDirectory(directory)
  const artist = atRoot || sameResource(parent, rootDir)
    ? (atRoot ? '未知歌手' : album)
    : folderName(parent)
  return { artist, album }
}

const collator = new Intl.Collator('zh-CN', { numeric: true })

function dirOf(id: string): string {
  return id.slice(0, id.lastIndexOf('/') + 1)
}

/**
 * 把扫到的音频文件收成歌曲、专辑、歌手。
 * root 是用户填的 WebDAV 根，用来判断「上一级是不是已经到根」。
 * covers 是目录 → 封面文件地址，lrcs 是音频文件地址 → 同名 .lrc 地址。
 *
 * 专辑按「专辑歌手 + 专辑名」归组：合辑里每首歌的歌手不同，但专辑歌手（TPE2 / ALBUMARTIST）相同，
 * 不这样分，一张合辑会被拆成十几张只有一首歌的专辑。没有专辑歌手时用歌曲自己的歌手。
 */
export function buildLibrary(options: {
  serverId: string
  root: string
  files: WebDavFile[]
  covers: Map<string, string>
  lrcs: Map<string, string>
}): WebDavLibrary {
  const rootDir = directoryUrl(options.root)
  const songs: Song[] = []
  const lrcBySongId = new Map<string, string>()
  const modifiedBySong = new Map<string, number>()
  const albumGroups = new Map<string, { albumArtist: string; songs: Song[] }>()

  for (const file of options.files) {
    const named = parseAudioFilename(file.name)
    const place = folderFallback(file.directory, rootDir)
    const title = text(file.tagTitle) || named.title || '未命名'
    const artist = text(file.tagArtist) || named.artist || place.artist
    const albumArtist = text(file.tagAlbumArtist) || artist
    const album = text(file.tagAlbum) || named.album || place.album
    const cover = options.covers.get(file.directory)
    const id = idOf(file.url)
    const albumId = `webdav-album:${albumArtist}::${album}`
    const song: Song = {
      id,
      title,
      artist,
      artistId: `webdav-artist:${artist}`,
      album,
      albumId,
      coverArt: cover ? idOf(cover) : undefined,
      duration: file.tagDuration && file.tagDuration > 0 ? Math.round(file.tagDuration) : 0,
      size: file.size,
      track: file.tagTrack || named.track,
      suffix: file.name.split('.').pop()?.toLowerCase(),
      path: displayPath(id),
      serverId: options.serverId,
    }
    const lrc = options.lrcs.get(file.url)
    if (lrc) lrcBySongId.set(id, idOf(lrc))
    if (file.modified) modifiedBySong.set(id, file.modified)
    songs.push(song)
    const group = albumGroups.get(albumId)
    if (group) group.songs.push(song)
    else albumGroups.set(albumId, { albumArtist, songs: [song] })
  }

  const albums: AlbumDetail[] = []
  const newestByAlbum = new Map<string, number>()
  for (const [id, group] of albumGroups) {
    const list = group.songs
    // 分碟放在 CD1 / CD2 子目录里时，先按目录排，碟内再按曲目号
    list.sort((a, b) => collator.compare(dirOf(a.id), dirOf(b.id)) || (a.track ?? 9999) - (b.track ?? 9999) || collator.compare(a.title, b.title))
    const first = list[0]
    const duration = list.reduce((sum, song) => sum + (song.duration || 0), 0)
    albums.push({
      id,
      name: first.album,
      artist: group.albumArtist,
      artistId: `webdav-artist:${group.albumArtist}`,
      // 分碟的专辑可能只有某一张碟的目录里放了封面
      coverArt: list.find(song => song.coverArt)?.coverArt,
      songCount: list.length,
      duration: duration || undefined,
      serverId: options.serverId,
      songs: list,
    })
    newestByAlbum.set(id, list.reduce((newest, song) => Math.max(newest, modifiedBySong.get(song.id) ?? 0), 0))
  }
  albums.sort((a, b) => collator.compare(a.artist, b.artist) || collator.compare(a.name, b.name))

  // 歌手页：做专辑歌手的专辑，加上自己唱的歌（合辑里的那一首也算）
  const byArtist = new Map<string, { name: string; albums: AlbumDetail[]; songs: Song[] }>()
  const entry = (name: string) => {
    const id = `webdav-artist:${name}`
    let found = byArtist.get(id)
    if (!found) {
      found = { name, albums: [], songs: [] }
      byArtist.set(id, found)
    }
    return found
  }
  for (const album of albums) {
    const owner = entry(album.artist)
    owner.albums.push(album)
    for (const song of album.songs) {
      entry(song.artist).songs.push(song)
      if (song.artist !== album.artist) owner.songs.push(song)
    }
  }

  const artists: ArtistDetail[] = []
  for (const [id, item] of byArtist) {
    artists.push({
      id,
      name: item.name,
      albumCount: item.albums.length,
      coverArt: item.albums.find(album => album.coverArt)?.coverArt ?? item.songs.find(song => song.coverArt)?.coverArt,
      serverId: options.serverId,
      albums: item.albums,
      songs: item.songs,
      topSongs: item.songs.slice(0, 10),
    })
  }
  artists.sort((a, b) => collator.compare(a.name, b.name))

  // 「最近添加」：按专辑里最新那首歌的修改时间。服务器不给时间就保持原来的顺序。
  const recentAlbums = albums
    .map((album, index) => ({ album, index, at: newestByAlbum.get(album.id) ?? 0 }))
    .sort((a, b) => b.at - a.at || a.index - b.index)
    .map(item => item.album)

  return { songs, albums, artists, recentAlbums, lrcBySongId }
}

/** 同目录 .lrc 用「去掉扩展名」对上音频文件，大小写不敏感 */
export function basenameKey(filename: string): string {
  return filename.replace(/\.[^.]+$/, '').toLowerCase()
}
