/**
 * PluginAdapter（PLAN 1.3 验收）：用假 host 覆盖每个方法的映射与错误码翻译。
 * 沙箱真链路由阶段 1.6 的浏览器走查覆盖。
 */

import { describe, expect, it } from 'vitest'
import { PluginAdapter, type PluginHostLike } from './plugin'
import type { PluginManifest, Paged, MediaDetailResult, SheetItem, MusicItem, TopListGroup } from '@/plugins/types'
import { PluginCallError } from '@/plugins/host/PluginHost'

function makeManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: 'mock', name: 'Mock', version: '0.1.0', protocol: 1, platform: 'mock',
    entry: 'index.js', auth: { kind: 'qr' }, hosts: ['mock.test'],
    capabilities: ['search', 'lyrics', 'userPlaylists', 'favorites', 'playlistWrite', 'topLists', 'recommendSheets'],
    disclaimer: 'x',
    ...overrides,
  }
}

/** 假 host：按方法名路由到实现，未注册的方法 hasMethod=false */
function makeFakeHost(handlers: Record<string, (...args: unknown[]) => unknown> = {}): PluginHostLike {
  return {
    hasMethod: method => method in handlers,
    call: async <T>(method: string, ...args: unknown[]) => {
      const fn = handlers[method]
      if (!fn) throw new PluginCallError('not-found', `Method not found: ${method}`)
      return fn(...args) as T
    },
  }
}

const music = (id: string, title: string): MusicItem => ({
  platform: 'mock', id, title, artist: '艺人', album: '专辑', duration: 200, mid: `mid-${id}`,
})

describe('可选方法的挂载', () => {
  it('有 getMediaSource 才挂 resolveStreamUrl；没有就不定义（能力探测隐藏入口）', async () => {
    const withStream = new PluginAdapter({
      serverId: 'srv', manifest: makeManifest(),
      host: makeFakeHost({ getMediaSource: async () => ({ url: 'https://cdn.test/a.mp3', expiresAt: 12345 }) }),
    })
    expect(typeof withStream.resolveStreamUrl).toBe('function')

    const withoutStream = new PluginAdapter({ serverId: 'srv', manifest: makeManifest(), host: makeFakeHost() })
    expect(withoutStream.resolveStreamUrl).toBeUndefined()
  })

  it('声明了 capability 但沙箱没回报方法 → 按未声明处理（getSourceCapabilities 关掉）', () => {
    const manifest = makeManifest({ capabilities: ['search', 'userPlaylists'] })
    const onlySearch = new PluginAdapter({
      serverId: 'srv', manifest,
      host: makeFakeHost({ search: async () => ({ isEnd: true, data: [] }) }),
    })
    const caps = onlySearch.getSourceCapabilities()
    expect(caps.search).toBe(true)
    expect(caps.userPlaylists).toBe(false) // manifest 声明了但没有 n1ko.user.getPlaylists
    expect(caps.libraryBrowse).toBe(false)
  })

  it('manifest 未声明的能力即使方法存在也不开', () => {
    const adapter = new PluginAdapter({
      serverId: 'srv', manifest: makeManifest({ capabilities: [] }),
      host: makeFakeHost({ search: async () => ({ isEnd: true, data: [] }) }),
    })
    expect(adapter.getSourceCapabilities().search).toBe(false)
  })
})

describe('取流（resolveStreamUrl）', () => {
  it('回传缓存里的原始项（含插件私有字段），音质按 manifest 降档', async () => {
    const calls: Array<{ item: MusicItem | null; quality: string }> = []
    const adapter = new PluginAdapter({
      serverId: 'srv', manifest: makeManifest({ qualities: ['low', 'medium', 'high'] }),
      host: makeFakeHost({
        search: async () => ({ isEnd: true, data: [music('s1', '歌1')] }),
        getMediaSource: async (item, quality) => {
          calls.push({ item: item as MusicItem, quality: quality as string })
          return { url: `https://cdn.test/${(item as MusicItem).id}.mp3`, expiresAt: 99_999, mimeType: 'audio/mpeg' }
        },
      }),
    })
    // 先 search 让原始项进缓存
    await adapter.searchAll('歌1')
    const resolved = await adapter.resolveStreamUrl!('s1', { maxBitrate: 0, quality: 'lossless' })
    expect(resolved.url).toBe('https://cdn.test/s1.mp3')
    expect(resolved.expiresAt).toBe(99_999)
    expect(resolved.mimeType).toBe('audio/mpeg')
    // 私有字段 mid 原样回传；lossless 在 manifest 里没有 → 降到 high
    expect(calls[0].item).toMatchObject({ id: 's1', mid: 'mid-s1' })
    expect(calls[0].quality).toBe('high')
  })

  it('n1ko.getMediaSource 优先于顶层同名方法', async () => {
    const adapter = new PluginAdapter({
      serverId: 'srv', manifest: makeManifest(),
      host: makeFakeHost({
        getMediaSource: async () => ({ url: 'https://top.test/a.mp3' }),
        'n1ko.getMediaSource': async () => ({ url: 'https://n1ko.test/a.mp3' }),
      }),
    })
    const resolved = await adapter.resolveStreamUrl!('s1', { maxBitrate: 0, quality: 'high' })
    expect(resolved.url).toBe('https://n1ko.test/a.mp3')
  })

  it('缓存未命中时回传最小项（platform + id）', async () => {
    let received: MusicItem | null = null
    const adapter = new PluginAdapter({
      serverId: 'srv', manifest: makeManifest(),
      host: makeFakeHost({
        getMediaSource: async item => { received = item as MusicItem; return { url: 'https://x.test/b.mp3' } },
      }),
    })
    await adapter.resolveStreamUrl!('unknown-id', { maxBitrate: 0, quality: 'high' })
    expect(received).toEqual({ platform: 'mock', id: 'unknown-id', title: '', artist: '' })
  })

  it('同步 getStreamUrl 抛错（插件流必须异步解析）', () => {
    const adapter = new PluginAdapter({ serverId: 'srv', manifest: makeManifest(), host: makeFakeHost() })
    expect(() => adapter.getStreamUrl()).toThrow(/resolveStreamUrl/)
  })
})

describe('搜索与歌词', () => {
  it('searchAll 分型拉取并映射；专辑/歌手/歌单其中一型失败不拖垮其余', async () => {
    const adapter = new PluginAdapter({
      serverId: 'srv', manifest: makeManifest(),
      host: makeFakeHost({
        search: async (_q, _page, type) => {
          if (type === 'music') return { isEnd: true, data: [music('s1', '歌')] }
          if (type === 'album') return { isEnd: true, data: [{ platform: 'mock', id: 'a1', title: '专' }] }
          if (type === 'artist') return { isEnd: true, data: [{ platform: 'mock', id: 'ar1', name: '手' }] }
          return { isEnd: true, data: [{ platform: 'mock', id: 'p1', title: '单' }] }
        },
      }),
    })
    const result = await adapter.searchAll('歌')
    expect(result.songs[0]).toMatchObject({ id: 's1', serverId: 'srv' })
    expect(result.albums[0]).toMatchObject({ id: 'a1' })
    expect(result.artists[0]).toMatchObject({ id: 'ar1' })
    expect(result.playlists?.[0]).toMatchObject({ id: 'p1' })
  })

  it('getLyrics 走 getLyric 并解析 LRC', async () => {
    const adapter = new PluginAdapter({
      serverId: 'srv', manifest: makeManifest(),
      host: makeFakeHost({
        search: async () => ({ isEnd: true, data: [music('s1', '歌')] }),
        getLyric: async () => ({ rawLrc: '[00:01.00]第一行\n[00:05.00]第二行' }),
      }),
    })
    await adapter.searchAll('歌')
    const lyrics = await adapter.getLyrics('s1')
    expect(lyrics?.synced).toBe(true)
    expect(lyrics?.lines).toHaveLength(2)
    expect(lyrics?.lines[0]).toMatchObject({ time: 1000, text: '第一行' })
  })
})

describe('歌单', () => {
  it('getPlaylists 合并 created + subscribed', async () => {
    const adapter = new PluginAdapter({
      serverId: 'srv', manifest: makeManifest(),
      host: makeFakeHost({
        'n1ko.user.getPlaylists': async () => ({
          created: [{ platform: 'mock', id: 'p1', title: '我建的' }],
          subscribed: [{ platform: 'mock', id: 'p2', title: '我收藏的' }],
        }),
      }),
    })
    const playlists = await adapter.getPlaylists()
    expect(playlists.map(p => p.id)).toEqual(['p1', 'p2'])
    expect(playlists[0].serverId).toBe('srv')
  })

  it('getPlaylistDetail 分页拉全（isEnd 循环）', async () => {
    let pageCalls = 0
    const adapter = new PluginAdapter({
      serverId: 'srv', manifest: makeManifest(),
      host: makeFakeHost({
        'n1ko.user.getPlaylists': async () => ({ created: [{ platform: 'mock', id: 'p1', title: '单' }], subscribed: [] }),
        getMusicSheetInfo: async (_sheet, page): Promise<MediaDetailResult<SheetItem>> => {
          pageCalls += 1
          if (page === 1) return { isEnd: false, musicList: [music('a', 'A'), music('b', 'B')] }
          return { isEnd: true, musicList: [music('c', 'C')] }
        },
      }),
    })
    // 先 getPlaylists 让 sheet 原始项进缓存
    await adapter.getPlaylists()
    const detail = await adapter.getPlaylistDetail('p1')
    expect(detail.songs.map(s => s.id)).toEqual(['a', 'b', 'c'])
    expect(pageCalls).toBe(2)
    expect(detail.songCount).toBe(3)
  })

  it('removeSongsFromPlaylist 把下标翻译成原始项回传（Jellyfin 同款范式）', async () => {
    const removed: { sheet: SheetItem; items: MusicItem[] }[] = []
    const adapter = new PluginAdapter({
      serverId: 'srv', manifest: makeManifest(),
      host: makeFakeHost({
        'n1ko.user.getPlaylists': async () => ({ created: [{ platform: 'mock', id: 'p1', title: '单' }], subscribed: [] }),
        getMusicSheetInfo: async () => ({ isEnd: true, musicList: [music('a', 'A'), music('b', 'B'), music('c', 'C')] }),
        'n1ko.user.removeFromPlaylist': async (sheet, items) => {
          removed.push({ sheet: sheet as SheetItem, items: items as MusicItem[] })
        },
      }),
    })
    await adapter.getPlaylists()
    await adapter.removeSongsFromPlaylist('p1', [2, 0])
    expect(removed).toHaveLength(1)
    expect(removed[0].items.map(i => i.id)).toEqual(['c', 'a'])
    // 回传的是原始项（带 mid 私有字段），不是 App 的 Song
    expect(removed[0].items[0]).toMatchObject({ mid: 'mid-c' })
  })

  it('下标全部越界时抛错，不静默谎称已移除', async () => {
    const adapter = new PluginAdapter({
      serverId: 'srv', manifest: makeManifest(),
      host: makeFakeHost({
        'n1ko.user.getPlaylists': async () => ({ created: [{ platform: 'mock', id: 'p1', title: '单' }], subscribed: [] }),
        getMusicSheetInfo: async () => ({ isEnd: true, musicList: [music('a', 'A')] }),
        'n1ko.user.removeFromPlaylist': async () => {},
      }),
    })
    await adapter.getPlaylists()
    await expect(adapter.removeSongsFromPlaylist('p1', [99])).rejects.toThrow(/No matching/)
  })
})

describe('收藏与榜单', () => {
  it('getStarred 分页拉全收藏', async () => {
    const adapter = new PluginAdapter({
      serverId: 'srv', manifest: makeManifest(),
      host: makeFakeHost({
        'n1ko.user.getFavorites': async (page): Promise<Paged<MusicItem>> =>
          page === 1
            ? { isEnd: false, data: [music('a', 'A')] }
            : { isEnd: true, data: [music('b', 'B')] },
      }),
    })
    const starred = await adapter.getStarred()
    expect(starred.songs.map(s => s.id)).toEqual(['a', 'b'])
    expect(starred.albums).toEqual([])
  })

  it('star/unstar 回传原始项', async () => {
    const liked: Array<{ id: string; liked: boolean }> = []
    const adapter = new PluginAdapter({
      serverId: 'srv', manifest: makeManifest(),
      host: makeFakeHost({
        search: async () => ({ isEnd: true, data: [music('s1', '歌')] }),
        'n1ko.user.setFavorite': async (item, l) => { liked.push({ id: (item as MusicItem).id, liked: l as boolean }) },
      }),
    })
    await adapter.searchAll('歌')
    await adapter.star('s1', 'song')
    await adapter.unstar('s1', 'song')
    expect(liked).toEqual([{ id: 's1', liked: true }, { id: 's1', liked: false }])
  })

  it('getTopLists / getTopListDetail 按 capability 挂载并映射分组', async () => {
    const adapter = new PluginAdapter({
      serverId: 'srv', manifest: makeManifest(),
      host: makeFakeHost({
        getTopLists: async (): Promise<TopListGroup[]> => [
          { title: '飙升榜', data: [{ platform: 'mock', id: 't1', title: '榜一' }] },
        ],
        getTopListDetail: async (): Promise<MediaDetailResult<SheetItem>> =>
          ({ isEnd: true, musicList: [music('a', 'A')] }),
      }),
    })
    expect(typeof adapter.getTopLists).toBe('function')
    const groups = await adapter.getTopLists!()
    expect(groups[0].title).toBe('飙升榜')
    expect(groups[0].items[0]).toMatchObject({ id: 't1', serverId: 'srv' })
    const detail = await adapter.getTopListDetail!('t1', 1)
    expect(detail.songs[0].id).toBe('a')
  })
})

describe('错误码翻译', () => {
  it('沙箱的 PluginCallError 原样穿透（unauthorized 供登录横幅识别）', async () => {
    const adapter = new PluginAdapter({
      serverId: 'srv', manifest: makeManifest(),
      host: makeFakeHost({
        search: async () => { throw new PluginCallError('unauthorized', '登录已过期') },
      }),
    })
    const err = await adapter.searchAll('x').catch(e => e)
    expect(err).toBeInstanceOf(PluginCallError)
    expect((err as PluginCallError).code).toBe('unauthorized')
    expect((err as PluginCallError).message).toBe('登录已过期')
  })

  it('插件不支持的方法抛明确的 unsupported / 错误信息', async () => {
    const adapter = new PluginAdapter({ serverId: 'srv', manifest: makeManifest(), host: makeFakeHost() })
    await expect(adapter.getPlaylists()).resolves.toEqual([]) // 没挂 n1ko.user.getPlaylists → 空态
    await expect(adapter.deletePlaylist('x')).rejects.toThrow(/does not support/)
    await expect(adapter.updateSongMetadata('s1', { title: 'x' })).rejects.toThrow(/does not support/)
  })

  it('login 不接受账号密码（插件走 QR / Cookie 流程）', async () => {
    const adapter = new PluginAdapter({ serverId: 'srv', manifest: makeManifest(), host: makeFakeHost() })
    const result = await adapter.login('https://x', 'u', 'p')
    expect(result.success).toBe(false)
  })
})

describe('封面与能力声明', () => {
  it('getCoverUrl 原样返回 URL（插件的 coverArt 本来就是地址）', () => {
    const adapter = new PluginAdapter({ serverId: 'srv', manifest: makeManifest(), host: makeFakeHost() })
    expect(adapter.getCoverUrl('https://p.me/cover.jpg', 300)).toBe('https://p.me/cover.jpg')
  })
})
