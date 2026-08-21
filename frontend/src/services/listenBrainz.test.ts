import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  buildListen, buildPlayingNow, qualifiesAsListen, submitListens,
  validateToken, trimPending, MAX_PENDING_LISTENS,
} from './listenBrainz'
import type { Song } from '@/api/types'

function song(overrides: Partial<Song> = {}): Song {
  return {
    id: 's1',
    title: 'Weightless',
    artist: 'Marconi Union',
    album: 'Ambient Transmissions',
    duration: 480,
    track: 3,
    ...overrides,
  } as Song
}

afterEach(() => { vi.unstubAllGlobals() })

describe('qualifiesAsListen', () => {
  it('过半就算', () => {
    expect(qualifiesAsListen(101, 200)).toBe(true)
    expect(qualifiesAsListen(99, 200)).toBe(false)
  })

  it('长曲目满 4 分钟即可，不必真听一半', () => {
    expect(qualifiesAsListen(240, 3600)).toBe(true)
  })

  it('时长未知时只认 4 分钟', () => {
    expect(qualifiesAsListen(239, 0)).toBe(false)
    expect(qualifiesAsListen(240, 0)).toBe(true)
  })
})

describe('buildListen', () => {
  it('listened_at 用开始播放的秒级时间戳', () => {
    const listen = buildListen(song(), 1_700_000_000_500)!
    expect(listen.listened_at).toBe(1_700_000_000)
  })

  it('缺歌手或曲名就不提交，而不是发一条残缺记录', () => {
    expect(buildListen(song({ artist: '' }), Date.now())).toBeNull()
    expect(buildListen(song({ title: '   ' }), Date.now())).toBeNull()
  })

  it('带上时长（毫秒）、轨号和客户端标识', () => {
    const info = buildListen(song(), Date.now())!.track_metadata.additional_info!
    expect(info.duration_ms).toBe(480_000)
    expect(info.tracknumber).toBe(3)
    expect(info.media_player).toBe('N1KO MUSIC')
  })

  it('有 MBID 就带上，让服务端精确匹配录音', () => {
    const withMbid = song() as Song & { musicBrainzId?: string }
    withMbid.musicBrainzId = 'abc-123'
    expect(buildListen(withMbid, Date.now())!.track_metadata.additional_info!.recording_mbid)
      .toBe('abc-123')
  })

  it('空专辑名不写成空串', () => {
    expect(buildListen(song({ album: '  ' }), Date.now())!.track_metadata.release_name)
      .toBeUndefined()
  })
})

describe('buildPlayingNow', () => {
  it('不带 listened_at——带了会被拒收', () => {
    const payload = buildPlayingNow(song())!
    expect('listened_at' in payload).toBe(false)
    expect(payload.track_metadata.track_name).toBe('Weightless')
  })
})

describe('submitListens', () => {
  function stubFetch(status: number, body = '') {
    const spy = vi.fn(async () => new Response(body, { status }))
    vi.stubGlobal('fetch', spy)
    return spy
  }

  const listen = { listened_at: 1, track_metadata: { artist_name: 'A', track_name: 'B' } }

  it('成功返回 ok', async () => {
    stubFetch(200, '{}')
    expect(await submitListens('https://lb.test', 'tok', [listen], 'single')).toEqual({ ok: true })
  })

  it('token 为空时不发请求', async () => {
    const spy = stubFetch(200)
    const result = await submitListens('https://lb.test', '  ', [listen], 'single')
    expect(result.ok).toBe(false)
    expect(spy).not.toHaveBeenCalled()
  })

  it('空列表直接算成功，不发请求', async () => {
    const spy = stubFetch(200)
    expect(await submitListens('https://lb.test', 'tok', [], 'single')).toEqual({ ok: true })
    expect(spy).not.toHaveBeenCalled()
  })

  it('401 不重试——重试只会一直撞墙', async () => {
    stubFetch(401, 'bad token')
    const result = await submitListens('https://lb.test', 'tok', [listen], 'single')
    expect(result).toMatchObject({ ok: false, retryable: false })
  })

  it('400 不重试', async () => {
    stubFetch(400, 'invalid')
    expect(await submitListens('https://lb.test', 'tok', [listen], 'single'))
      .toMatchObject({ ok: false, retryable: false })
  })

  it('429 和 5xx 值得重试', async () => {
    stubFetch(429)
    expect(await submitListens('https://lb.test', 'tok', [listen], 'single'))
      .toMatchObject({ ok: false, retryable: true })
    stubFetch(503)
    expect(await submitListens('https://lb.test', 'tok', [listen], 'single'))
      .toMatchObject({ ok: false, retryable: true })
  })

  it('网络异常值得重试', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    expect(await submitListens('https://lb.test', 'tok', [listen], 'single'))
      .toMatchObject({ ok: false, retryable: true, message: 'offline' })
  })

  it('端点地址末尾多余的斜杠不会拼出双斜杠', async () => {
    const spy = stubFetch(200, '{}')
    await submitListens('https://lb.test///', 'tok', [listen], 'single')
    expect(spy.mock.calls[0][0]).toBe('https://lb.test/1/submit-listens')
  })

  it('Authorization 头用 Token 前缀', async () => {
    const spy = stubFetch(200, '{}')
    await submitListens('https://lb.test', ' tok ', [listen], 'single')
    expect(spy.mock.calls[0][1].headers.Authorization).toBe('Token tok')
  })
})

describe('validateToken', () => {
  it('走专用校验接口，不靠提交假记录来试', async () => {
    const spy = vi.fn(async () => new Response(
      JSON.stringify({ valid: true, user_name: 'niko' }), { status: 200 }
    ))
    vi.stubGlobal('fetch', spy)
    expect(await validateToken('https://lb.test', 'tok'))
      .toEqual({ valid: true, userName: 'niko', message: undefined })
    expect(spy.mock.calls[0][0]).toBe('https://lb.test/1/validate-token')
  })

  it('网络失败时返回无效而不是抛错', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('dns') }))
    expect(await validateToken('https://lb.test', 'tok')).toEqual({ valid: false, message: 'dns' })
  })
})

describe('trimPending', () => {
  it('未超上限原样返回', () => {
    const list = [{ listened_at: 1, track_metadata: { artist_name: 'A', track_name: 'B' } }]
    expect(trimPending(list)).toBe(list)
  })

  it('超上限时丢最旧的，留最近的', () => {
    const list = Array.from({ length: MAX_PENDING_LISTENS + 5 }, (_, i) => ({
      listened_at: i, track_metadata: { artist_name: 'A', track_name: `T${i}` },
    }))
    const trimmed = trimPending(list)
    expect(trimmed).toHaveLength(MAX_PENDING_LISTENS)
    expect(trimmed[trimmed.length - 1].listened_at).toBe(MAX_PENDING_LISTENS + 4)
    expect(trimmed[0].listened_at).toBe(5)
  })
})
