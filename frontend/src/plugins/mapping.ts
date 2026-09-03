/**
 * MusicFree 形状 → App 统一类型的映射（PROTOCOL §5.2）。
 *
 * 纯函数 + 一个原始项缓存：插件私有字段（mid、fee 等）不能丢——下次调用
 * getMediaSource / getLyric 这类「要整项」的方法时得原样回传。缓存未命中时
 * 按 { platform, id } 最小项回传，让插件自己兜底。
 */

import type { Album, Artist, Playlist, Song } from '@/api/types'
import type { AlbumItem, ArtistItem, MusicItem, SheetItem } from './types'

// ===================================================
// 原始项缓存（LRU，key = serverId:kind:id）
// ===================================================

export type RawKind = 'song' | 'album' | 'artist' | 'sheet'

const RAW_CACHE_MAX = 2000
const rawCache = new Map<string, unknown>()

function rawKey(serverId: string, kind: RawKind, id: string): string {
  return `${serverId}:${kind}:${id}`
}

export function putRawItem(serverId: string, kind: RawKind, id: string, raw: unknown): void {
  const key = rawKey(serverId, kind, id)
  // Map 的 LRU：命中先删再插，尾部永远是最近使用的
  rawCache.delete(key)
  rawCache.set(key, raw)
  if (rawCache.size > RAW_CACHE_MAX) {
    const oldest = rawCache.keys().next().value
    if (oldest !== undefined) rawCache.delete(oldest)
  }
}

export function getRawItem<T>(serverId: string, kind: RawKind, id: string): T | null {
  const key = rawKey(serverId, kind, id)
  const hit = rawCache.get(key)
  if (hit === undefined) return null
  rawCache.delete(key)
  rawCache.set(key, hit)
  return hit as T
}

/** 缓存未命中时的最小回传项（PROTOCOL §5.2） */
export function minimalMusicItem(item: Pick<Song, 'id'>, platform: string): MusicItem {
  return { platform, id: item.id, title: '', artist: '' }
}

// ===================================================
// 实体映射
// ===================================================

export function mapMusicItem(item: MusicItem, serverId: string): Song {
  const song: Song = {
    id: String(item.id),
    title: String(item.title ?? ''),
    artist: String(item.artist ?? ''),
    artistId: item.artistId ? String(item.artistId) : undefined,
    album: String(item.album ?? ''),
    albumId: item.albumId ? String(item.albumId) : undefined,
    // 插件的 coverArt 直接就是 URL；不是 URL 时（如私有字段）交给原始缓存侧处理
    coverArt: typeof item.artwork === 'string' ? item.artwork : undefined,
    duration: Number(item.duration) || 0,
    serverId,
    // VIP 曲（当前账号无权）：曲目行直接标 VIP，播放失败时用户能对上原因
    ...(item.vip ? { vip: true } : {}),
    ext: item.vip ? { ...songExtras(item), vip: true } : songExtras(item),
  }
  putRawItem(serverId, 'song', song.id, item)
  return song
}

function songExtras(item: MusicItem): { vip?: boolean; isrc?: string[] } | undefined {
  const isrc = typeof item.isrc === 'string' && item.isrc ? [item.isrc] : undefined
  if (!isrc && !item.vip) return undefined
  const ext: { vip?: boolean; isrc?: string[] } = {}
  if (item.vip) ext.vip = true
  if (isrc) ext.isrc = isrc
  return ext
}

export function mapAlbumItem(item: AlbumItem, serverId: string): Album {
  const album: Album = {
    id: String(item.id),
    name: String(item.title ?? ''),
    artist: String(item.artist ?? ''),
    artistId: item.artistId ? String(item.artistId) : undefined,
    coverArt: typeof item.artwork === 'string' ? item.artwork : undefined,
    year: item.date ? Number(String(item.date).slice(0, 4)) || undefined : undefined,
    serverId,
  }
  putRawItem(serverId, 'album', album.id, item)
  return album
}

export function mapArtistItem(item: ArtistItem, serverId: string): Artist {
  const artist: Artist = {
    id: String(item.id),
    name: String(item.name ?? ''),
    coverArt: typeof item.avatar === 'string' ? item.avatar : undefined,
    serverId,
    sortIndex: pinyinInitial(item.name ?? ''),
  }
  putRawItem(serverId, 'artist', artist.id, item)
  return artist
}

export function mapSheetItem(item: SheetItem, serverId: string): Playlist {
  const playlist: Playlist = {
    id: String(item.id),
    name: String(item.title ?? ''),
    coverArt: typeof item.artwork === 'string' ? item.artwork : undefined,
    songCount: item.worksNum ? Number(item.worksNum) : undefined,
    owner: typeof item.createUser === 'string' ? item.createUser : undefined,
    serverId,
  }
  putRawItem(serverId, 'sheet', playlist.id, item)
  return playlist
}

// ===================================================
// 归位字母（Artist.sortIndex，PROTOCOL §5.2「宿主按名称首字符生成」）
// ===================================================

/**
 * 名称的归位字母：拉丁名按首字母（大小写不敏感）；其余（中日文、数字、
 * 符号）归 '#'——'#' 组内部由调用方用 Intl.Collator('zh…pinyin') 排序，
 * 拼音顺序仍然正确。
 *
 * 为什么不做全量拼音首字母：Node 与浏览器的 ICU 都把汉字整体排在拉丁
 * 之前（collator 边界法拿不到字母段），经典「边界字」表法依赖 GB2312
 * 编码序而 JS 拿不到 GBK 码位，全量准确的拼音首字母需要一张数据表。
 * 阶段 1 插件音源不走歌手浏览页（libraryBrowse=false），'#' 分组够用；
 * 阶段 3 网易云的中文歌手进入聚合视图时再补正式表（见 DECISIONS.md）。
 */
export function pinyinInitial(name: string): string {
  const trimmed = (name ?? '').trim()
  const first = trimmed[0]
  if (!first) return '#'
  if (/[a-z]/i.test(first)) return first.toUpperCase()
  return '#'
}

// ===================================================
// 音质映射（PROTOCOL §5.3）
// ===================================================

export type PluginQuality = 'low' | 'standard' | 'high' | 'super'

const APP_TO_PLUGIN: Record<'lossless' | 'high' | 'medium' | 'low', PluginQuality> = {
  low: 'low',
  medium: 'standard',
  high: 'high',
  lossless: 'super',
}

/** 档位从高到低，用于「插件没有该档位时降到有的最高档」 */
const PLUGIN_TIER_ORDER: PluginQuality[] = ['super', 'high', 'standard', 'low']

/**
 * App 音质档 → MusicFree quality。
 * available 为插件 manifest 声明的档位（App 档名）；未声明视为全档可用。
 */
export function mapQuality(
  quality: 'lossless' | 'high' | 'medium' | 'low',
  available?: Array<'low' | 'medium' | 'high' | 'lossless'>
): PluginQuality {
  const wanted = APP_TO_PLUGIN[quality]
  if (!available?.length) return wanted
  const pluginTiers = available.map(a => APP_TO_PLUGIN[a])
  if (pluginTiers.includes(wanted)) return wanted
  // 降到有的最高档：从 wanted 起向下找
  const wantedIndex = PLUGIN_TIER_ORDER.indexOf(wanted)
  for (let i = wantedIndex; i < PLUGIN_TIER_ORDER.length; i++) {
    if (pluginTiers.includes(PLUGIN_TIER_ORDER[i])) return PLUGIN_TIER_ORDER[i]
  }
  return 'low'
}
