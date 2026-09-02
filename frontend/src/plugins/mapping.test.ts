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

describe('实体映射', () => {
  it('MusicItem → Song：平台字段对位，插件私有字段进原始缓存', () => {
    const raw: MusicItem = {
      platform: 'netease', id: '347230', title: '海阔天空', artist: 'Beyond',
      artistId: 'ar-1', album: '乐与怒', albumId: 'al-1',
      artwork: 'https://p.me/cover.jpg', duration: 326, isrc: 'HK-A1-93-00001',
      vip: false, mid: 'MUSIC_abc123', fee: 8,
    }
    const song = mapMusicItem(raw, 'srv-plugin')
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
    const song = mapMusicItem({ platform: 'x', id: '1', title: 't', artist: 'a', vip: true }, 'srv')
    expect(song.ext?.vip).toBe(true)
  })

  it('AlbumItem / ArtistItem / SheetItem 对位', () => {
    expect(mapAlbumItem({ platform: 'x', id: 'a1', title: '专辑', artist: '歌手', date: '2023-06-01' }, 'srv'))
      .toMatchObject({ id: 'a1', name: '专辑', artist: '歌手', year: 2023, serverId: 'srv' })
    expect(mapArtistItem({ platform: 'x', id: 'ar1', name: '李荣浩' }, 'srv'))
      .toMatchObject({ id: 'ar1', name: '李荣浩', serverId: 'srv' })
    expect(mapSheetItem({ platform: 'x', id: 'p1', title: '歌单', worksNum: 66, createUser: 'n1ko' }, 'srv'))
      .toMatchObject({ id: 'p1', name: '歌单', songCount: 66, owner: 'n1ko', serverId: 'srv' })
  })

  it('缺 duration 时填 0（PROTOCOL §5.2），缺 artwork 不造 URL', () => {
    const song = mapMusicItem({ platform: 'x', id: '1', title: 't', artist: 'a' }, 'srv')
    expect(song.duration).toBe(0)
    expect(song.coverArt).toBeUndefined()
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
