/**
 * serverId 是跨源分域的根基（审计 高-4/高-5/中-14 都从它缺位开始）。
 * 每条从适配器出来的数据都必须带上所属 ServerConfig.id——漏一条，
 * 多源聚合时它就会打错服务器或命中别家的缓存。
 */
describe('mapper 必须填 serverId', () => {
  function makeAdapter() {
    const adapter = new SubsonicAdapter({
      url: 'https://example.test', username: 'u', token: 't', salt: 's', serverId: 'srv-a',
    })
    ;(adapter as unknown as { client: unknown }).client = {
      get: async () => ({
        data: {
          'subsonic-response': {
            status: 'ok',
            searchResult3: {
              song: [{ id: 's1', title: 'a', artist: 'x', album: 'b' }],
              album: [{ id: 'al1', name: 'b', artist: 'x' }],
              artist: [{ id: 'ar1', name: 'x' }],
            },
          },
        },
      }),
    }
    return adapter
  }

  it('searchAll 的歌曲 / 专辑 / 歌手都带 serverId', async () => {
    const { songs, albums, artists } = await makeAdapter().searchAll('q')
    expect(songs.every(s => s.serverId === 'srv-a')).toBe(true)
    expect(albums.every(a => a.serverId === 'srv-a')).toBe(true)
    expect(artists.every(a => a.serverId === 'srv-a')).toBe(true)
  })

  it('音源能力声明 libraryBrowse', () => {
    const caps = makeAdapter().getSourceCapabilities()
    expect(caps.libraryBrowse).toBe(true)
    expect(caps.search).toBe(true)
    expect(caps.topLists).toBe(false)
  })
})

/**
 * adapter 面对的是不受信任的服务器 JSON：任何一处字段形态不合预期
 * 都不该让整个 mapSong 抛错——那会连带把整页曲目的渲染打断。
 */
import { describe, expect, it } from 'vitest'
import { mapSongExtras, SubsonicAdapter } from '@/api/adapters/subsonic'

describe('mapSongExtras 的健壮性', () => {
  it('contributors 里混入 null / 标量时不抛错，只跳过坏元素', () => {
    expect(() => mapSongExtras({ contributors: [null] })).not.toThrow()
    expect(() => mapSongExtras({ contributors: ['nope', 42, undefined] })).not.toThrow()

    const ext = mapSongExtras({
      contributors: [
        null,
        { role: 'composer', artist: { id: 'a1', name: '坂本龍一' } },
        'garbage',
        { role: 'producer', name: 'Someone' },
      ],
    })
    expect(ext?.contributors).toHaveLength(2)
    expect(ext?.contributors?.[0]).toEqual({
      role: 'composer', subRole: undefined, name: '坂本龍一', artistId: 'a1',
    })
  })

  it('contributors 的 artist 不是对象时退回顶层 name', () => {
    const ext = mapSongExtras({ contributors: [{ role: 'engineer', artist: 'x', name: 'Bob' }] })
    expect(ext?.contributors?.[0].name).toBe('Bob')
    expect(ext?.contributors?.[0].artistId).toBeUndefined()
  })

  it('replayGain 是字符串或缺字段时不产生 NaN', () => {
    expect(mapSongExtras({ replayGain: 'loud' })?.replayGain).toBeUndefined()
    const ext = mapSongExtras({ replayGain: { trackGain: -7.5, albumPeak: 0.98 } })
    expect(ext?.replayGain).toEqual({
      trackGain: -7.5, albumGain: undefined, trackPeak: undefined,
      albumPeak: 0.98, fallbackGain: undefined,
    })
  })

  it('没有任何扩展字段时返回 undefined，而不是空对象', () => {
    expect(mapSongExtras({ id: '1', title: 'x' })).toBeUndefined()
    expect(mapSongExtras({ contributors: [], moods: [], isrc: [] })).toBeUndefined()
  })

  it('数值字段为 0 或非数字时不写入', () => {
    // Navidrome 对有损文件返回 bitDepth: 0，不该显示成 "0bit"
    const ext = mapSongExtras({ bitDepth: 0, samplingRate: 44100, channelCount: 'two' })
    expect(ext?.bitDepth).toBeUndefined()
    expect(ext?.samplingRate).toBe(44100)
    expect(ext?.channelCount).toBeUndefined()
  })
})

/**
 * 取消信号必须一路透到 axios 的请求配置里。
 *
 * 此前只有搜索接得住取消：翻页、切歌手、弱网下来回切页时，在途请求全都还在跑，
 * 既占着浏览器那 6 条同源连接，又让 cancelQueries 形同虚设。
 * 这里不测「取消发生了什么」，只钉住「signal 有没有被传下去」——
 * 断链就是从某个方法忘记转发开始的。
 */
describe('取消信号的透传', () => {
  function makeAdapter() {
    const calls: Array<{ url: string; config: { signal?: AbortSignal } }> = []
    const adapter = new SubsonicAdapter({
      url: 'https://example.test', username: 'u', token: 't', salt: 's', serverId: 'srv-a',
    })
    // 替掉真实的 axios 实例，只记录调用
    ;(adapter as unknown as { client: unknown }).client = {
      get: async (url: string, config: { signal?: AbortSignal }) => {
        calls.push({ url, config })
        // 带一个歌手：getArtistDetail 在服务器没返回歌手时会抛错，这里要走完整条路径
        return { data: { 'subsonic-response': { status: 'ok', artist: { id: 'x', name: 'n' } } } }
      },
    }
    return { adapter, calls }
  }

  const cases: Array<[string, (a: SubsonicAdapter, s: AbortSignal) => Promise<unknown>]> = [
    ['getSongs', (a, s) => a.getSongs({ signal: s })],
    ['getAlbums', (a, s) => a.getAlbums({ signal: s })],
    ['getAlbumDetail', (a, s) => a.getAlbumDetail('x', s)],
    ['getRecentAlbums', (a, s) => a.getRecentAlbums(10, s)],
    ['getRandomSongs', (a, s) => a.getRandomSongs(10, undefined, s)],
    ['getArtists', (a, s) => a.getArtists(undefined, s)],
    ['getArtistDetail', (a, s) => a.getArtistDetail('x', s)],
    ['getPlaylists', (a, s) => a.getPlaylists(s)],
    ['getPlaylistDetail', (a, s) => a.getPlaylistDetail('x', s)],
    ['getStarred', (a, s) => a.getStarred(s)],
    ['getGenres', (a, s) => a.getGenres(s)],
    ['searchAll', (a, s) => a.searchAll('q', s)],
  ]

  for (const [name, invoke] of cases) {
    it(`${name} 把 signal 交给 axios`, async () => {
      const { adapter, calls } = makeAdapter()
      const controller = new AbortController()
      await invoke(adapter, controller.signal)
      expect(calls.length).toBeGreaterThan(0)
      for (const call of calls) {
        expect(call.config.signal, `${name} 的 ${call.url} 漏了 signal`).toBe(controller.signal)
      }
    })
  }
})

/**
 * 分享能力必须问服务器，不能问适配器。
 *
 * Subsonic 系适配器一律实现了 createShare，所以「有没有这个方法」永远为真。
 * Navidrome 把四个分享端点绑在同一个 EnableSharing 开关上，关掉时一起回 501，
 * 所以 getShares 恰好在 createShare 会失败的时候失败。
 *
 * 最要紧的是**区分「服务器说没有」和「没问到服务器」**：后者一旦被当成前者，
 * react-query 会把它当成功结果缓存下来，一次网络抖动就能让分享入口消失半小时。
 */
describe('分享能力探测', () => {
  function makeAdapter(respond: (url: string) => unknown) {
    const calls: string[] = []
    const adapter = new SubsonicAdapter({
      url: 'https://example.test', username: 'u', token: 't', salt: 's', serverId: 'srv-a',
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

  const ok = (body: unknown) => ({ status: 200, data: { 'subsonic-response': body } })

  it('探的是 getShares —— 与 createShare 共用同一个开关的那个端点', async () => {
    const { adapter, calls } = makeAdapter(() => ok({ status: 'ok', shares: {} }))
    await adapter.probeShares()
    expect(calls).toEqual(['/getShares'])
  })

  it('服务器把分享关掉（501）时报告不支持', async () => {
    const { adapter } = makeAdapter(() => ({ status: 501, data: '' }))
    expect(await adapter.probeShares()).toBe(false)
  })

  it('端点根本不存在（404）时报告不支持', async () => {
    const { adapter } = makeAdapter(() => ({ status: 404, data: '' }))
    expect(await adapter.probeShares()).toBe(false)
  })

  it('分享开着但一条都还没建过时，报告支持', async () => {
    // 这是最容易被写错的一种：空列表不等于不支持
    const { adapter } = makeAdapter(() => ok({ status: 'ok', shares: {} }))
    expect(await adapter.probeShares()).toBe(true)
  })

  it('已有分享时报告支持', async () => {
    const { adapter } = makeAdapter(() => ok({
      status: 'ok', shares: { share: [{ id: '1', url: 'https://example.test/share/1' }] },
    }))
    expect(await adapter.probeShares()).toBe(true)
  })

  it('服务器回 Subsonic 层面的错误时也报告不支持', async () => {
    const { adapter } = makeAdapter(() => ok({
      status: 'failed', error: { code: 30, message: 'not implemented' },
    }))
    expect(await adapter.probeShares()).toBe(false)
  })

  /**
   * 下面这几条是这次修的核心：没问到服务器不是答案。
   * 必须抛出去，让 react-query 进入 error 态——那里才有重试和重挂载重取；
   * 一旦 resolve 成 false，它就成了「成功结果」，被缓存 30 分钟，
   * 而 NAS 唤醒、隧道重连、VPN 还没起来这类抖动恰恰都发生在启动那一刻。
   */
  describe('没问到服务器时不能当成「不支持」', () => {
    it('断网 / 超时要抛出去，而不是悄悄返回 false', async () => {
      const { adapter } = makeAdapter(() => new Error('Network Error'))
      await expect(adapter.probeShares()).rejects.toThrow('Network Error')
    })

    it('网关错误（502）要抛出去', async () => {
      const { adapter } = makeAdapter(() => ({ status: 502, data: '' }))
      await expect(adapter.probeShares()).rejects.toThrow('502')
    })

    it('认证过期（401）要抛出去——那是登录的问题，不是分享的问题', async () => {
      const { adapter } = makeAdapter(() => ({ status: 401, data: '' }))
      await expect(adapter.probeShares()).rejects.toThrow('401')
    })
  })
})

/**
 * 连不上时要能说清「是网络还是凭据」。
 *
 * ping() 把两者压成同一个 false，于是在别的设备上改过密码之后，
 * 横幅会说「检查网络连接」，而那个重试按钮永远救不回来——
 * 用户被指向一个根本不存在的问题。
 *
 * Subsonic 的坑在于：用户名密码错误是 HTTP 200 + error code 40，
 * 不是 401。只看状态码会把它误判成「一切正常」。
 */
describe('连接诊断', () => {
  function makeAdapter(respond: (url: string) => unknown) {
    const adapter = new SubsonicAdapter({
      url: 'https://example.test', username: 'u', token: 't', salt: 's', serverId: 'srv-a',
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
  const body = (b: unknown) => ({ status: 200, data: { 'subsonic-response': b } })

  it('一切正常时报 ok', async () => {
    expect(await makeAdapter(() => body({ status: 'ok' })).diagnose()).toBe('ok')
  })

  it('密码改了（200 + code 40）报 unauthorized，而不是 ok', async () => {
    const adapter = makeAdapter(() => body({
      status: 'failed', error: { code: 40, message: 'Wrong username or password' },
    }))
    expect(await adapter.diagnose()).toBe('unauthorized')
  })

  it('令牌类错误（code 41-44）同样算 unauthorized', async () => {
    for (const code of [41, 42, 43, 44]) {
      const adapter = makeAdapter(() => body({ status: 'failed', error: { code } }))
      expect(await adapter.diagnose()).toBe('unauthorized')
    }
  })

  it('断网报 unreachable', async () => {
    expect(await makeAdapter(() => new Error('Network Error')).diagnose()).toBe('unreachable')
  })

  it('网关错误报 unreachable，不误伤成凭据问题', async () => {
    expect(await makeAdapter(() => ({ status: 502, data: '' })).diagnose()).toBe('unreachable')
  })

  it('HTTP 401 报 unauthorized', async () => {
    expect(await makeAdapter(() => ({ status: 401, data: '' })).diagnose()).toBe('unauthorized')
  })

  it('其它 Subsonic 错误码不算凭据问题', async () => {
    const adapter = makeAdapter(() => body({ status: 'failed', error: { code: 70 } }))
    expect(await adapter.diagnose()).toBe('unreachable')
  })
})

// ── 复审 B16：offset 符号的适配器侧用例 ──
describe('OpenSubsonic structured lyrics 的 offset 符号（B16）', () => {
  const makeLyricsAdapter = (structured: unknown) => {
    const adapter = new SubsonicAdapter({
      url: 'https://example.test', username: 'u', token: 't', salt: 's', serverId: 'srv-a',
    })
    ;(adapter as unknown as { client: unknown }).client = {
      get: async (url: string) => {
        if (url.includes('/getLyricsBySongId')) {
          return { status: 200, data: { 'subsonic-response': { status: 'ok', lyricsList: structured } } }
        }
        throw new Error(`unexpected: ${url}`)
      },
    }
    return adapter
  }

  it('offset 正值 = 提前显示 → start 减去 offset（原来加号把提前唱成推后）', async () => {
    const adapter = makeLyricsAdapter({
      structuredLyrics: [{ synced: true, offset: 500, line: [{ start: 10_000, value: '词' }] }],
    })
    const lyrics = await adapter.getLyrics('s1')
    expect(lyrics?.lines[0].time).toBe(9_500)
  })

  it('offset 缺省不动时间', async () => {
    const adapter = makeLyricsAdapter({
      structuredLyrics: [{ synced: true, line: [{ start: 10_000, value: '词' }] }],
    })
    const lyrics = await adapter.getLyrics('s1')
    expect(lyrics?.lines[0].time).toBe(10_000)
  })
})

/**
 * 取歌词：「没问到服务器」不能当成「没有歌词」。
 *
 * react-query 会把 resolve 出来的 null 当成功结果缓存 30 分钟——NAS 刚唤醒、
 * 隧道还没通、令牌过期这类瞬时故障，此前都被两层 catch 吞成 null，
 * 界面就会老实地显示半小时「暂无歌词」。只有服务器明确答复了才算「没有」。
 */
describe('取歌词：失败与「没有」要分清', () => {
  const httpError = (status: number) =>
    Object.assign(new Error(`Request failed with status code ${status}`), {
      isAxiosError: true,
      response: { status },
    })
  const networkError = () =>
    Object.assign(new Error('Network Error'), { isAxiosError: true })
  const ok = (body: Record<string, unknown>) => ({
    status: 200,
    data: { 'subsonic-response': { status: 'ok', ...body } },
  })
  const failed = (code: number) => ({
    status: 200,
    data: { 'subsonic-response': { status: 'failed', error: { code, message: 'x' } } },
  })

  /** respond 按端点返回结果；返回 Error 则抛出（模拟 axios 对非 2xx 与断网的行为） */
  function makeAdapter(respond: (url: string) => unknown) {
    const calls: string[] = []
    const adapter = new SubsonicAdapter({
      url: 'https://example.test', username: 'u', token: 't', salt: 's', serverId: 'srv-a',
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

  it('断网要抛出去，而不是返回 null 让界面缓存「暂无歌词」', async () => {
    const { adapter } = makeAdapter(() => networkError())
    await expect(adapter.getLyrics('s1')).rejects.toThrow('Network Error')
  })

  it('401 / 403 / 429 / 5xx 同样抛出去', async () => {
    for (const status of [401, 403, 429, 500, 502, 503]) {
      const { adapter } = makeAdapter(() => httpError(status))
      await expect(adapter.getLyrics('s1')).rejects.toThrow(String(status))
    }
  })

  it('200 + 认证类错误码（40-44）抛出去——那是登录的问题，不是没有歌词', async () => {
    for (const code of [40, 41, 42, 43, 44]) {
      const { adapter } = makeAdapter(() => failed(code))
      await expect(adapter.getLyrics('s1')).rejects.toThrow()
    }
  })

  it('扩展接口断网时不降级去撞旧接口：直接抛', async () => {
    const { adapter, calls } = makeAdapter(url =>
      url.includes('/getLyricsBySongId') ? networkError() : ok({ lyrics: { value: '[00:01.00]词' } }))
    await expect(adapter.getLyrics('s1')).rejects.toThrow('Network Error')
    expect(calls).toEqual(['/getLyricsBySongId'])
  })

  it('服务器不认扩展接口（404）时降级到旧接口，旧接口有词就用旧接口的', async () => {
    const { adapter, calls } = makeAdapter(url =>
      url.includes('/getLyricsBySongId')
        ? httpError(404)
        : ok({ lyrics: { value: '[00:01.00]词' } }))
    const lyrics = await adapter.getLyrics('s1')
    expect(calls).toEqual(['/getLyricsBySongId', '/getLyrics'])
    expect(lyrics?.lines[0].text).toBe('词')
  })

  it('服务器明确回「没有」（旧接口空词 / 不存在 / 404）才返回 null', async () => {
    // 扩展接口无歌词列表 + 旧接口空词
    const empty = makeAdapter(url =>
      url.includes('/getLyricsBySongId') ? ok({ lyricsList: {} }) : ok({ lyrics: {} }))
    expect(await empty.adapter.getLyrics('s1')).toBeNull()

    // 两个接口都回 Subsonic「70 数据不存在」
    const notFound = makeAdapter(() => failed(70))
    expect(await notFound.adapter.getLyrics('s1')).toBeNull()

    // 旧服务器两个端点都没有（HTTP 404）
    const noEndpoint = makeAdapter(() => httpError(404))
    expect(await noEndpoint.adapter.getLyrics('s1')).toBeNull()
  })

  it('扩展接口没有、旧接口断网：抛，不是 null', async () => {
    const { adapter } = makeAdapter(url =>
      url.includes('/getLyricsBySongId') ? ok({ lyricsList: {} }) : networkError())
    await expect(adapter.getLyrics('s1')).rejects.toThrow('Network Error')
  })
})

/**
 * 歌手页：断网不能返回一个 id 为 'undefined' 的空壳——
 * 它会被当成功结果缓存 10 分钟，歌手页显示一个空白歌手。
 */
describe('getArtistDetail：失败要抛', () => {
  function makeAdapter(respond: (url: string) => unknown) {
    const adapter = new SubsonicAdapter({
      url: 'https://example.test', username: 'u', token: 't', salt: 's', serverId: 'srv-a',
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
  const ok = (body: Record<string, unknown>) => ({
    status: 200,
    data: { 'subsonic-response': { status: 'ok', ...body } },
  })

  it('/getArtist 断网时抛错，而不是返回空歌手', async () => {
    const adapter = makeAdapter(() => new Error('Network Error'))
    await expect(adapter.getArtistDetail('ar1')).rejects.toThrow('Network Error')
  })

  it('/getArtist 成功但没带歌手对象时抛错', async () => {
    const adapter = makeAdapter(() => ok({}))
    await expect(adapter.getArtistDetail('ar1')).rejects.toThrow()
  })

  it('/getArtist 成功时照常返回；附加信息（getArtistInfo2）失败不影响', async () => {
    const adapter = makeAdapter(url => {
      if (url.includes('/getArtistInfo2')) return new Error('Network Error')
      if (url.includes('/getArtist')) return ok({ artist: { id: 'ar1', name: '赵雷', album: [] } })
      return ok({})
    })
    const detail = await adapter.getArtistDetail('ar1')
    expect(detail.id).toBe('ar1')
    expect(detail.name).toBe('赵雷')
  })
})
