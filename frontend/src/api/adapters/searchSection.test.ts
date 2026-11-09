/**
 * 搜索「加载更多」的适配器一半：searchAll 写死 20 首 / 10 张 / 10 位、没有后文；
 * searchSection 按 offset 取某一分区的下一批，并说明后面是不是还有。
 * 不支持分页的音源（WebDAV / 插件）不实现 searchSection，页面据此不画按钮。
 */
import { describe, expect, it } from 'vitest'
import { SubsonicAdapter } from '@/api/adapters/subsonic'
import { JellyfinAdapter } from '@/api/adapters/jellyfin'
import { EmbyAdapter } from '@/api/adapters/emby'
import { WebDavAdapter } from '@/api/adapters/webdav'

const many = <T,>(n: number, make: (i: number) => T) => Array.from({ length: n }, (_, i) => make(i))

describe('Subsonic search3 分页', () => {
  function makeAdapter(result: Record<string, unknown>) {
    const calls: Array<Record<string, unknown>> = []
    const adapter = new SubsonicAdapter({
      url: 'https://example.test', username: 'u', token: 't', salt: 's', serverId: 'srv-a',
    })
    ;(adapter as unknown as { client: unknown }).client = {
      get: async (_url: string, config: { params: Record<string, unknown> }) => {
        calls.push(config.params)
        return { data: { 'subsonic-response': { status: 'ok', searchResult3: result } } }
      },
    }
    return { adapter, calls }
  }

  it('searchAll 给满一页的分区标「后面可能还有」，不满的不标', async () => {
    const { adapter } = makeAdapter({
      song: many(20, i => ({ id: `s${i}`, title: 't' })),
      album: many(10, i => ({ id: `a${i}`, name: 'n' })),
      artist: many(3, i => ({ id: `r${i}`, name: 'n' })),
    })
    const res = await adapter.searchAll('q')
    expect(res.sectionHasMore).toEqual({ songs: true, albums: true, artists: false })
  })

  it('searchSection(songs, 20) 用 songOffset=20 向服务器要下一批，其余分区不要', async () => {
    const { adapter, calls } = makeAdapter({ song: many(20, i => ({ id: `s${20 + i}`, title: 't' })) })
    const res = await adapter.searchSection('q', 'songs', 20)
    expect(calls[0]).toMatchObject({ query: 'q', songOffset: 20, songCount: 20, albumCount: 0, artistCount: 0 })
    expect(res.items).toHaveLength(20)
    expect(res.items[0].serverId).toBe('srv-a')
    expect(res.hasMore).toBe(true)
  })

  it('albums / artists 各用各的偏移；返回不满一页就是到尾了', async () => {
    const { adapter, calls } = makeAdapter({
      album: many(4, i => ({ id: `a${i}`, name: 'n' })),
      artist: many(10, i => ({ id: `r${i}`, name: 'n' })),
    })
    const albums = await adapter.searchSection('q', 'albums', 10)
    expect(calls[0]).toMatchObject({ albumOffset: 10, albumCount: 10, songCount: 0, artistCount: 0 })
    expect(albums.items).toHaveLength(4)
    expect(albums.hasMore).toBe(false)

    const artists = await adapter.searchSection('q', 'artists', 10)
    expect(calls[1]).toMatchObject({ artistOffset: 10, artistCount: 10, songCount: 0, albumCount: 0 })
    expect(artists.hasMore).toBe(true)
  })
})

describe('Jellyfin / Emby 搜索分页', () => {
  function makeAdapter(Adapter: typeof JellyfinAdapter, itemsFor: (type: string) => unknown[]) {
    const calls: Array<Record<string, unknown>> = []
    const adapter = new Adapter({ url: 'https://jf.test', token: 't', userId: 'u1', serverId: 'srv-jf' })
    ;(adapter as unknown as { client: unknown }).client = {
      get: async (_url: string, config: { params: Record<string, unknown> }) => {
        calls.push(config.params)
        return { data: { Items: itemsFor(String(config.params.IncludeItemTypes)) } }
      },
    }
    return { adapter, calls }
  }
  const items = (type: string) =>
    type === 'Audio' ? many(20, i => ({ Id: `s${i}`, Name: 't', RunTimeTicks: 0 }))
      : type === 'MusicAlbum' ? many(10, i => ({ Id: `a${i}`, Name: 'n' }))
        : many(2, i => ({ Id: `r${i}`, Name: 'n' }))

  it.each([['Jellyfin', JellyfinAdapter], ['Emby', EmbyAdapter]] as const)('%s：searchAll 标出哪些分区还有后文', async (_n, Adapter) => {
    const { adapter } = makeAdapter(Adapter, items)
    const res = await adapter.searchAll('q')
    expect(res.sectionHasMore).toEqual({ songs: true, albums: true, artists: false })
  })

  it.each([['Jellyfin', JellyfinAdapter], ['Emby', EmbyAdapter]] as const)('%s：searchSection 用 StartIndex 接着取、只查那一类', async (_n, Adapter) => {
    const { adapter, calls } = makeAdapter(Adapter, items)
    const res = await adapter.searchSection('q', 'albums', 10)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ SearchTerm: 'q', IncludeItemTypes: 'MusicAlbum', StartIndex: 10, Limit: 10 })
    expect(res.items).toHaveLength(10)
    expect(res.items[0].serverId).toBe('srv-jf')
    expect(res.hasMore).toBe(true)
  })
})

describe('不支持分页的音源', () => {
  it('WebDAV 不实现 searchSection（页面据此不显示「加载更多」）', () => {
    expect('searchSection' in WebDavAdapter.prototype).toBe(false)
  })
})
