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
      url: 'https://example.test', username: 'u', token: 't', salt: 's',
    })
    // 替掉真实的 axios 实例，只记录调用
    ;(adapter as unknown as { client: unknown }).client = {
      get: async (url: string, config: { signal?: AbortSignal }) => {
        calls.push({ url, config })
        return { data: { 'subsonic-response': { status: 'ok' } } }
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
      url: 'https://example.test', username: 'u', token: 't', salt: 's',
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
