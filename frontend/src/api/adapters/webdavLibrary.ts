/**
 * WebDAV 目录解析与曲库拼装。
 *
 * 歌名、歌手、专辑优先用文件里的标签，其次用「歌手 - 歌名」这种文件名。
 * 两样都没有时，才用文件夹名兜底。
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
}

export interface WebDavFile {
  url: string
  name: string
  /** 所在目录，带结尾斜杠 */
  directory: string
  size?: number
  tagTitle?: string
  tagArtist?: string
  tagAlbum?: string
  tagTrack?: number
}

export interface WebDavLibrary {
  songs: Song[]
  albums: AlbumDetail[]
  artists: ArtistDetail[]
  /** 歌曲 URL → 同目录同名 .lrc */
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

/**
 * 曲目 id 就是文件地址。服务器换了 IP 之后，队列和缓存里还会留着旧主机。
 * 路径不动，只把主机换成当前这台，否则原生播放器会当成「不是这台服务器的文件」拒绝。
 */
export function retargetFileUrl(fileUrl: string, base: string): string {
  if (!fileUrl.startsWith('http://') && !fileUrl.startsWith('https://')) return fileUrl
  let file: URL
  let root: URL
  try {
    file = new URL(fileUrl)
    root = new URL(base)
  } catch {
    return fileUrl
  }
  if (file.origin === root.origin) return fileUrl
  // 只换主机，路径原样留下。URL.toString() 会把「音乐」重新编码，
  // 同一首歌就会变成另一个 id。
  if (fileUrl.startsWith(file.origin)) return root.origin + fileUrl.slice(file.origin.length)
  return fileUrl
}

/** 只替换指定旧基址，避免把别的网站的链接也改掉。 */
export function rewriteFileBase(value: string, from: string, to: string): string {
  if (!from || from === to || !value.startsWith(from)) return value
  if (value === from) return to
  const boundary = value.charAt(from.length)
  if (boundary === '/' || boundary === '?' || boundary === '#') return to + value.slice(from.length)
  return value
}

type WebDavSongFields = { id: string; path?: string; coverArt?: string }

/** 这首歌属于这台 WebDAV 时，把文件地址对齐到当前服务器。封面若在别的网站上则不动。 */
export function alignWebDavSong<T extends WebDavSongFields>(song: T, base: string): T {
  if (!song.id.startsWith('http://') && !song.id.startsWith('https://')) return song
  let oldOrigin = ''
  try {
    oldOrigin = new URL(song.id).origin
  } catch {
    return song
  }
  const id = retargetFileUrl(song.id, base)
  const path = song.path?.startsWith(oldOrigin) ? retargetFileUrl(song.path, base) : song.path
  const coverArt = song.coverArt?.startsWith(oldOrigin) ? retargetFileUrl(song.coverArt, base) : song.coverArt
  if (id === song.id && path === song.path && coverArt === song.coverArt) return song
  return { ...song, id, path, coverArt }
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
    entries.push({
      url: collection ? directoryUrl(url) : url.replace(/\/$/, ''),
      name,
      collection,
      size: Number.isFinite(length) && length > 0 ? length : undefined,
      contentType: contentType || undefined,
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

const collator = new Intl.Collator('zh-CN')

/**
 * 把扫到的音频文件收成歌曲、专辑、歌手。
 * root 是用户填的 WebDAV 根，用来判断「上一级是不是已经到根」。
 */
export function buildLibrary(options: {
  serverId: string
  root: string
  files: WebDavFile[]
  covers: Map<string, string>
  lrcs: Map<string, string>
}): WebDavLibrary {
  const rootDir = directoryUrl(options.root)
  const byAlbum = new Map<string, WebDavFile[]>()
  for (const file of options.files) {
    const list = byAlbum.get(file.directory) ?? []
    list.push(file)
    byAlbum.set(file.directory, list)
  }

  const albums: AlbumDetail[] = []
  const songs: Song[] = []
  const lrcBySongId = new Map<string, string>()

  for (const [directory, files] of byAlbum) {
    const cover = options.covers.get(directory)
    for (const file of files) {
      const named = parseAudioFilename(file.name)
      const place = folderFallback(directory, rootDir)
      const title = text(file.tagTitle) || named.title || '未命名'
      const artist = text(file.tagArtist) || named.artist || place.artist
      const album = text(file.tagAlbum) || named.album || place.album
      const track = file.tagTrack || named.track
      const lrc = options.lrcs.get(file.url)
      const song: Song = {
        id: file.url,
        title,
        artist,
        artistId: `webdav-artist:${artist}`,
        album,
        albumId: `webdav-album:${artist}::${album}`,
        coverArt: cover,
        duration: 0,
        size: file.size,
        track,
        suffix: file.name.split('.').pop()?.toLowerCase(),
        path: file.url,
        serverId: options.serverId,
      }
      if (lrc) lrcBySongId.set(file.url, lrc)
      songs.push(song)
    }
  }

  const albumGroups = new Map<string, Song[]>()
  for (const song of songs) {
    const key = song.albumId ?? song.album
    const list = albumGroups.get(key) ?? []
    list.push(song)
    albumGroups.set(key, list)
  }
  for (const group of albumGroups.values()) {
    group.sort((a, b) => (a.track ?? 9999) - (b.track ?? 9999) || collator.compare(a.title, b.title))
    const first = group[0]
    albums.push({
      id: first.albumId ?? first.album,
      name: first.album,
      artist: first.artist,
      artistId: first.artistId,
      coverArt: first.coverArt,
      songCount: group.length,
      serverId: options.serverId,
      songs: group,
    })
  }

  albums.sort((a, b) => collator.compare(a.artist, b.artist) || collator.compare(a.name, b.name))

  const byArtist = new Map<string, AlbumDetail[]>()
  for (const album of albums) {
    const key = album.artistId ?? album.artist
    const list = byArtist.get(key) ?? []
    list.push(album)
    byArtist.set(key, list)
  }

  const artists: ArtistDetail[] = []
  for (const artistAlbums of byArtist.values()) {
    const first = artistAlbums[0]
    const artistSongs = artistAlbums.flatMap(album => album.songs)
    artists.push({
      id: first.artistId ?? `webdav-artist:${first.artist}`,
      name: first.artist,
      albumCount: artistAlbums.length,
      coverArt: first.coverArt,
      serverId: options.serverId,
      albums: artistAlbums,
      songs: artistSongs,
      topSongs: artistSongs.slice(0, 10),
    })
  }
  artists.sort((a, b) => collator.compare(a.name, b.name))

  return { songs, albums, artists, lrcBySongId }
}

/** 同目录 .lrc 用「去掉扩展名」对上音频文件，大小写不敏感 */
export function basenameKey(filename: string): string {
  return filename.replace(/\.[^.]+$/, '').toLowerCase()
}
