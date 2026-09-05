/**
 * MusicFree → App 映射的纯函数部分（PLAN 1.3）。
 */

import { describe, expect, it } from 'vitest'
import {
  getRawItem,
  mapAlbumItem,
  mapArtistItem,
  mapMusicItem,
  mapQuality,
  mapSheetItem,
  minimalMusicItem,
  pinyinInitial,
  putRawItem,
} from './mapping'
import type { MusicItem, SheetItem } from './types'

/** 测试用的 manifest hosts（封面地址必须命中它才留得下来） */
const HOSTS = ['p.me', '*.music.126.net']

describe('实体映射', () => {
  it('MusicItem → Song：平台字段对位，插件私有字段进原始缓存', () => {
    const raw: MusicItem = {
      platform: 'netease', id: '347230', title: '海阔天空', artist: 'Beyond',
      artistId: 'ar-1', album: '乐与怒', albumId: 'al-1',
      artwork: 'https://p.me/cover.jpg', duration: 326, isrc: 'HK-A1-93-00001',
      vip: false, mid: 'MUSIC_abc123', fee: 8,
    }
    const song = mapMusicItem(raw, 'srv-plugin', HOSTS)
    expect(song).toMatchObject({
      id: '347230', title: '海阔天空', artist: 'Beyond',
      album: '乐与怒', coverArt: 'https://p.me/cover.jpg',
      duration: 326, serverId: 'srv-plugin',
    })
    expect(song.ext?.isrc).toEqual(['HK-A1-93-00001'])
    // 私有字段原样保留在缓存里，调用 getMediaSource 时回传
    expect(getRawItem<MusicItem>('srv-plugin', 'song', '347230')).toMatchObject({ mid: 'MUSIC_abc123', fee: 8 })
  })

  it('vip 曲映射进 ext.vip（界面据此标灰）', () => {
    const song = mapMusicItem({ platform: 'x', id: '1', title: 't', artist: 'a', vip: true }, 'srv', HOSTS)
    expect(song.ext?.vip).toBe(true)
  })

  it('AlbumItem / ArtistItem / SheetItem 对位', () => {
    expect(mapAlbumItem({ platform: 'x', id: 'a1', title: '专辑', artist: '歌手', date: '2023-06-01' }, 'srv', HOSTS))
      .toMatchObject({ id: 'a1', name: '专辑', artist: '歌手', year: 2023, serverId: 'srv' })
    expect(mapArtistItem({ platform: 'x', id: 'ar1', name: '李荣浩' }, 'srv', HOSTS))
      .toMatchObject({ id: 'ar1', name: '李荣浩', serverId: 'srv' })
    expect(mapSheetItem({ platform: 'x', id: 'p1', title: '歌单', worksNum: 66, createUser: 'n1ko' }, 'srv', HOSTS))
      .toMatchObject({ id: 'p1', name: '歌单', songCount: 66, owner: 'n1ko', serverId: 'srv' })
  })

  it('缺 duration 时填 0（PROTOCOL §5.2），缺 artwork 不造 URL', () => {
    const song = mapMusicItem({ platform: 'x', id: '1', title: 't', artist: 'a' }, 'srv', HOSTS)
    expect(song.duration).toBe(0)
    expect(song.coverArt).toBeUndefined()
  })
})

describe('封面地址过 manifest hosts 白名单', () => {
  it('白名单外的封面丢弃：拼了凭据的地址不会进 <img>', () => {
    const song = mapMusicItem({
      platform: 'x', id: '9', title: 't', artist: 'a',
      artwork: 'https://evil.example.com/c.jpg?c=MUSIC_U%3Dsecret',
    }, 'srv', HOSTS)
    expect(song.coverArt).toBeUndefined()
    // 原始项照旧整项入缓存（回传插件时要原样带回，只是不进界面）
    expect(getRawItem<MusicItem>('srv', 'song', '9')?.artwork).toContain('evil.example.com')
  })

  it('白名单内的封面原样保留（一级子域通配同样算数）', () => {
    expect(mapMusicItem({
      platform: 'x', id: '10', title: 't', artist: 'a', artwork: 'https://m804.music.126.net/c.jpg',
    }, 'srv', HOSTS).coverArt).toBe('https://m804.music.126.net/c.jpg')
  })

  it('javascript: 不进封面；data: 只放行几 KB 以内的小图', () => {
    expect(mapMusicItem({
      platform: 'x', id: '11', title: 't', artist: 'a', artwork: 'javascript:alert(1)',
    }, 'srv', HOSTS).coverArt).toBeUndefined()
    // 小图（占位 SVG 那种）放行：离线的 Mock 音源靠它出封面
    const tiny = 'data:image/png;base64,AAAA'
    expect(mapMusicItem({
      platform: 'x', id: '12', title: 't', artist: 'a', artwork: tiny,
    }, 'srv', HOSTS).coverArt).toBe(tiny)
    // 大图不放行：封面会随歌曲落进听歌历史，几 MB 的串能把存储撑爆
    expect(mapMusicItem({
      platform: 'x', id: '13', title: 't', artist: 'a', artwork: 'data:image/png;base64,' + 'A'.repeat(9000),
    }, 'srv', HOSTS).coverArt).toBeUndefined()
  })

  it('专辑 / 歌手 / 歌单三种封面走同一道判定', () => {
    expect(mapAlbumItem({ platform: 'x', id: 'a2', title: 'A', artwork: 'https://evil.test/x.jpg' }, 'srv', HOSTS).coverArt)
      .toBeUndefined()
    expect(mapArtistItem({ platform: 'x', id: 'ar2', name: 'B', avatar: 'https://evil.test/x.jpg' }, 'srv', HOSTS).coverArt)
      .toBeUndefined()
    expect(mapSheetItem({ platform: 'x', id: 'p2', title: 'C', artwork: 'https://p.me/ok.jpg' }, 'srv', HOSTS).coverArt)
      .toBe('https://p.me/ok.jpg')
  })

  it('hosts 为空数组时封面全丢（必填语义，与 hostFetch 一致）', () => {
    expect(mapMusicItem({
      platform: 'x', id: '13', title: 't', artist: 'a', artwork: 'https://p.me/c.jpg',
    }, 'srv', []).coverArt).toBeUndefined()
  })
})

describe('原始项缓存', () => {
  it('未命中返回 null；最小项只有 platform + id', () => {
    expect(getRawItem('srv', 'song', 'nope')).toBeNull()
    expect(minimalMusicItem({ id: '42' }, 'netease')).toEqual({ platform: 'netease', id: '42', title: '', artist: '' })
  })

  it('同 key 覆盖写入', () => {
    putRawItem('srv2', 'sheet', 'p1', { title: 'v1' } as SheetItem)
    putRawItem('srv2', 'sheet', 'p1', { title: 'v2' } as SheetItem)
    expect(getRawItem<{ title: string }>('srv2', 'sheet', 'p1')?.title).toBe('v2')
  })

  it('serverId 分域：两个音源同 id 不串', () => {
    putRawItem('srv-a', 'song', '1042', { title: '来自A' } as MusicItem)
    putRawItem('srv-b', 'song', '1042', { title: '来自B' } as MusicItem)
    expect(getRawItem<{ title: string }>('srv-a', 'song', '1042')?.title).toBe('来自A')
    expect(getRawItem<{ title: string }>('srv-b', 'song', '1042')?.title).toBe('来自B')
  })
})

describe('音质映射（PROTOCOL §5.3）', () => {
  it('四档对位：medium→standard、lossless→super', () => {
    expect(mapQuality('low')).toBe('low')
    expect(mapQuality('medium')).toBe('standard')
    expect(mapQuality('high')).toBe('high')
    expect(mapQuality('lossless')).toBe('super')
  })

  it('插件没有该档位时降到有的最高档', () => {
    // 只到 high：lossless → high
    expect(mapQuality('lossless', ['low', 'medium', 'high'])).toBe('high')
    // 只到 lossless：所有档都在
    expect(mapQuality('medium', ['low', 'medium', 'high', 'lossless'])).toBe('standard')
    // 只有 low：lossless → low
    expect(mapQuality('lossless', ['low'])).toBe('low')
  })
})

describe('pinyinInitial', () => {
  it('英文名按首字母归位', () => {
    expect(pinyinInitial('Beyond')).toBe('B')
    expect(pinyinInitial('coldplay')).toBe('C')
  })

  it('中文与数字、符号、空名暂归 #（正式拼音表阶段 3 补，见 DECISIONS.md）', () => {
    expect(pinyinInitial('李荣浩')).toBe('#')
    expect(pinyinInitial('1M')).toBe('#')
    expect(pinyinInitial('...')).toBe('#')
    expect(pinyinInitial('')).toBe('#')
  })
})
