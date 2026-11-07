/**
 * WebDAV 目录解析与曲库拼装。
 *
 * 没有曲库服务的 NAS 只提供文件名和文件夹。
 * 这里把「直接放着音频的文件夹」当成专辑，它的上一级文件夹当成歌手。
 */

import type { AlbumDetail, ArtistDetail, Song } from '../types'

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

function splitTrack(filename: string): { track?: number; title: string } {
  const base = filename.replace(/\.[^.]+$/, '')
  const match = /^(\d{1,3})[\s._-]+(.+)$/.exec(base)
  if (!match) return { title: base }
  const track = Number(match[1])
  if (!Number.isFinite(track) || track <= 0) return { title: base }
  return { track, title: match[2] }
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
    const atRoot = sameResource(directory, rootDir)
    const albumName = atRoot ? '全部音乐' : folderName(directory)
    const parent = parentDirectory(directory)
    const artistName = atRoot || sameResource(parent, rootDir)
      ? (atRoot ? '未知歌手' : albumName)
      : folderName(parent)
    const artistId = `webdav-artist:${artistName}`
    const cover = options.covers.get(directory)
    const albumSongs = files
      .map(file => {
        const { track, title } = splitTrack(file.name)
        const ext = file.name.split('.').pop()?.toLowerCase()
        const lrc = options.lrcs.get(file.url)
        const song: Song = {
          id: file.url,
          title,
          artist: artistName,
          artistId,
          album: albumName,
          albumId: directory,
          coverArt: cover,
          duration: 0,
          size: file.size,
          track,
          suffix: ext,
          path: file.url,
          serverId: options.serverId,
        }
        if (lrc) lrcBySongId.set(file.url, lrc)
        return song
      })
      .sort((a, b) => (a.track ?? 9999) - (b.track ?? 9999) || collator.compare(a.title, b.title))

    songs.push(...albumSongs)
    albums.push({
      id: directory,
      name: albumName,
      artist: artistName,
      artistId,
      coverArt: cover,
      songCount: albumSongs.length,
      serverId: options.serverId,
      songs: albumSongs,
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
