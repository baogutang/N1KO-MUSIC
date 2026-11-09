import { describe, expect, it } from 'vitest'
import { JellyfinAdapter } from '@/api/adapters/jellyfin'

/** serverId 必填是跨源分域的根基（审计 高-4/高-5/中-14），mapper 漏填必须在测试里暴露 */
describe('mapper 必须填 serverId', () => {
  function makeAdapter() {
    const adapter = new JellyfinAdapter({
      url: 'https://jf.test', token: 't', userId: 'user1', serverId: 'srv-jf',
    })
    ;(adapter as unknown as { client: unknown }).client = {
      get: async () => ({
        data: {
          Items: [{ Id: 'item1', Name: 'a', Album: 'b', RunTimeTicks: 0 }],
          TotalRecordCount: 1,
        },
      }),
    }
    return adapter
  }

  it('getSongs 的每首歌都带 serverId', async () => {
    const page = await makeAdapter().getSongs()
    expect(page.items.length).toBeGreaterThan(0)
    expect(page.items.every(s => s.serverId === 'srv-jf')).toBe(true)
  })

  it('音源能力声明 libraryBrowse', () => {
    const caps = makeAdapter().getSourceCapabilities()
    expect(caps.libraryBrowse).toBe(true)
    expect(caps.search).toBe(true)
    expect(caps.topLists).toBe(false)
  })
})

/**
 * 从歌单移除：调用方传的是下标（沿用 Subsonic 的语义），
 * 而 Jellyfin 的 EntryIds 要的是 PlaylistItemId——条目自己的 GUID。
 *
 * 此前把下标当 GUID 发过去：匹配不到任何条目，服务端原样保存并返回 204，
 * 界面提示「已移除」而歌一直都在。这是最坏的一种失败——它撒谎。
 */
describe('Jellyfin 从歌单移除', () => {
  function makeAdapter(items: Array<{ PlaylistItemId: string }>) {
    const calls: Array<{ url: string; params: Record<string, unknown> }> = []
    const adapter = new JellyfinAdapter({
      url: 'https://jf.test', token: 't', userId: 'user1', serverId: 'srv-jf',
    })
    ;(adapter as unknown as { client: unknown }).client = {
      get: async () => ({ data: { Items: items } }),
      delete: async (url: string, config: { params: Record<string, unknown> }) => {
        calls.push({ url, params: config.params })
        return { data: null }
      },
    }
    return { adapter, calls }
  }

  const items = [
    { PlaylistItemId: 'guid-a' },
    { PlaylistItemId: 'guid-b' },
    { PlaylistItemId: 'guid-c' },
  ]

  it('把下标翻译成 PlaylistItemId，而不是原样发下标', async () => {
    const { adapter, calls } = makeAdapter(items)
    await adapter.removeSongsFromPlaylist('pl1', [1])
    expect(calls).toHaveLength(1)
    expect(calls[0].params.EntryIds).toBe('guid-b')
    // 关键：不能是 "1"
    expect(calls[0].params.EntryIds).not.toBe('1')
  })

  it('一次删多首时按下标从大到小，避免删完前面的让后面全部前移', async () => {
    const { adapter, calls } = makeAdapter(items)
    await adapter.removeSongsFromPlaylist('pl1', [0, 2])
    expect(calls[0].params.EntryIds).toBe('guid-c,guid-a')
  })

  it('下标越界时抛错，而不是静默返回让界面谎称已删除', async () => {
    const { adapter, calls } = makeAdapter(items)
    await expect(adapter.removeSongsFromPlaylist('pl1', [99])).rejects.toThrow()
    expect(calls).toHaveLength(0)
  })

  it('空下标列表不发请求', async () => {
    const { adapter, calls } = makeAdapter(items)
    await adapter.removeSongsFromPlaylist('pl1', [])
    expect(calls).toHaveLength(0)
  })
})

/**
 * 复审 B16：Start 缺失时 time 落 0 而不是 NaN。
 * NaN 进 sort 会让整首歌词的行序变成未定义。
 */
describe('Jellyfin 歌词行的 Start 缺失（B16）', () => {
  it('缺 Start / 非数值 Start → time 为 0，不产生 NaN', async () => {
    const adapter = new JellyfinAdapter({
      url: 'https://jf.test', token: 't', userId: 'user1', serverId: 'srv-jf',
    })
    ;(adapter as unknown as { client: unknown }).client = {
      get: async () => ({
        data: {
          Lyrics: [
            { Start: 100_000_000, Text: '正常行' },
            { Text: '缺 Start' },
            { Start: 'not-a-number' as unknown, Text: '坏 Start' },
          ],
        },
      }),
    }
    const lyrics = await adapter.getLyrics('song1')
    const times = lyrics?.lines.map(l => l.time) ?? []
    expect(times).toEqual([10_000, 0, 0])
    expect(times.every(Number.isFinite)).toBe(true)
  })
})

/**
 * 取歌词：「没问到服务器」不能当成「没有歌词」（与 Subsonic 同一条规矩）。
 * 此前一个裸 catch 把断网、401、5xx 全吞成 null，被缓存 30 分钟。
 */
describe('Jellyfin 取歌词：失败与「没有」要分清', () => {
  const httpError = (status: number) =>
    Object.assign(new Error(`Request failed with status code ${status}`), {
      isAxiosError: true,
      response: { status },
    })
  const networkError = () =>
    Object.assign(new Error('Network Error'), { isAxiosError: true })

  function makeAdapter(respond: (url: string) => unknown) {
    const calls: string[] = []
    const adapter = new JellyfinAdapter({
      url: 'https://jf.test', token: 't', userId: 'user1', serverId: 'srv-jf',
    })
    ;(adapter as unknown as { client: unknown }).client = {
      get: async (url: string) => {
        calls.push(url)
        const result = respond(url)
        if (result instanceof Error) throw result
        return result
      },
    }
    return { adapter, calls }
  }

  it('断网要抛出去', async () => {
    const { adapter } = makeAdapter(() => networkError())
    await expect(adapter.getLyrics('s1')).rejects.toThrow('Network Error')
  })

  it('401 / 403 / 429 / 5xx 要抛出去', async () => {
    for (const status of [401, 403, 429, 500, 503]) {
      const { adapter } = makeAdapter(() => httpError(status))
      await expect(adapter.getLyrics('s1')).rejects.toThrow(String(status))
    }
  })

  it('服务器明确回 404 才是「没有」：两个端点都 404 → null', async () => {
    const { adapter, calls } = makeAdapter(() => httpError(404))
    expect(await adapter.getLyrics('s1')).toBeNull()
    expect(calls).toHaveLength(2)
  })

  it('成功但歌词为空 → null', async () => {
    const { adapter } = makeAdapter(() => ({ data: { Lyrics: [] } }))
    expect(await adapter.getLyrics('s1')).toBeNull()
  })

  it('主端点 404、内嵌 LRC 端点有词：用内嵌的', async () => {
    const { adapter } = makeAdapter(url =>
      url.startsWith('/Audio/') ? httpError(404) : { data: '[00:01.00]词' })
    const lyrics = await adapter.getLyrics('s1')
    expect(lyrics?.lines[0].text).toBe('词')
  })

  it('主端点 404、内嵌端点断网：抛，不是 null', async () => {
    const { adapter } = makeAdapter(url =>
      url.startsWith('/Audio/') ? httpError(404) : networkError())
    await expect(adapter.getLyrics('s1')).rejects.toThrow('Network Error')
  })
})

/**
 * 歌手页：取不到歌手就抛，不返回一个 id 为 'undefined' 的空壳（会被缓存 10 分钟）。
 */
describe('Jellyfin getArtistDetail：失败要抛', () => {
  function makeAdapter(respond: (url: string) => unknown) {
    const adapter = new JellyfinAdapter({
      url: 'https://jf.test', token: 't', userId: 'user1', serverId: 'srv-jf',
    })
    ;(adapter as unknown as { client: unknown }).client = {
      get: async (url: string) => {
        const result = respond(url)
        if (result instanceof Error) throw result
        return result
      },
    }
    return adapter
  }

  it('断网时抛错', async () => {
    const adapter = makeAdapter(() => new Error('Network Error'))
    await expect(adapter.getArtistDetail('ar1')).rejects.toThrow('Network Error')
  })

  it('服务器 200 但没带歌手本体（无 Id）时抛错，而不是造一个空壳', async () => {
    const adapter = makeAdapter(url =>
      url.startsWith('/Items/') ? { data: {} } : { data: { Items: [] } })
    await expect(adapter.getArtistDetail('ar1')).rejects.toThrow()
  })

  it('正常返回时带上 id 与简介', async () => {
    const adapter = makeAdapter(url =>
      url.startsWith('/Items/')
        ? { data: { Id: 'ar1', Name: '赵雷', Overview: '歌手' } }
        : { data: { Items: [] } })
    const detail = await adapter.getArtistDetail('ar1')
    expect(detail.id).toBe('ar1')
    expect(detail.biography).toBe('歌手')
  })
})

/**
 * 歌手列表：此前写死 Limit 500，超出的歌手静默丢失——资料库大一点
 * 歌手页就缺人，而且没有任何提示。要分页取全。
 */
describe('Jellyfin getArtists 分页取全', () => {
  type Call = { url: string; params: { StartIndex?: number; Limit?: number } }

  function makeAdapter(total: number, opts: { reportTotal?: boolean } = {}) {
    const { reportTotal = true } = opts
    const calls: Call[] = []
    const adapter = new JellyfinAdapter({
      url: 'https://jf.test', token: 't', userId: 'user1', serverId: 'srv-jf',
    })
    ;(adapter as unknown as { client: unknown }).client = {
      get: async (url: string, config: { params: Call['params'] }) => {
        calls.push({ url, params: config.params })
        const start = config.params.StartIndex ?? 0
        const limit = config.params.Limit ?? total
        const items = Array.from(
          { length: Math.max(0, Math.min(limit, total - start)) },
          (_, i) => ({ Id: `ar${start + i}`, Name: `歌手${start + i}` }),
        )
        return { data: { Items: items, ...(reportTotal ? { TotalRecordCount: total } : {}) } }
      },
    }
    return { adapter, calls }
  }

  it('超过一页的歌手全部取回（此前只拿到 500 个）', async () => {
    const { adapter, calls } = makeAdapter(1200)
    const artists = await adapter.getArtists()
    expect(artists).toHaveLength(1200)
    expect(new Set(artists.map(a => a.id)).size).toBe(1200)
    expect(calls.map(c => c.params.StartIndex)).toEqual([0, 500, 1000])
  })

  it('刚好整页时按 TotalRecordCount 停，不多发一个空页', async () => {
    const { adapter, calls } = makeAdapter(1000)
    expect(await adapter.getArtists()).toHaveLength(1000)
    expect(calls).toHaveLength(2)
  })

  it('服务器不报总数时，见到不满一页就停', async () => {
    const { adapter, calls } = makeAdapter(700, { reportTotal: false })
    expect(await adapter.getArtists()).toHaveLength(700)
    expect(calls).toHaveLength(2)
  })

  it('小库只发一次请求', async () => {
    const { adapter, calls } = makeAdapter(30)
    expect(await adapter.getArtists()).toHaveLength(30)
    expect(calls).toHaveLength(1)
  })

  it('服务器一直吐满页时有总上限（20000），不会死循环', async () => {
    const { adapter, calls } = makeAdapter(1_000_000, { reportTotal: false })
    const artists = await adapter.getArtists()
    expect(artists).toHaveLength(20_000)
    expect(calls).toHaveLength(40)
  })

  it('中途某页失败要抛出去，不返回截断的列表', async () => {
    const adapter = new JellyfinAdapter({
      url: 'https://jf.test', token: 't', userId: 'user1', serverId: 'srv-jf',
    })
    let n = 0
    ;(adapter as unknown as { client: unknown }).client = {
      get: async () => {
        n++
        if (n === 2) throw new Error('Network Error')
        return { data: { Items: Array.from({ length: 500 }, (_, i) => ({ Id: `a${i}`, Name: 'x' })), TotalRecordCount: 900 } }
      },
    }
    await expect(adapter.getArtists()).rejects.toThrow('Network Error')
  })
})
