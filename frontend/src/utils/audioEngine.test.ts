import { describe, expect, it } from 'vitest'
import {
  accumulateListenedDelta,
  buildLoadedKey,
  buildStreamCacheKey,
  DEFAULT_STREAM_TTL_MS,
  getFiniteDuration,
  isAtBufferedTail,
  isNearEndOfTrack,
  isPrematureEnd,
  isStreamExpired,
  parseLoadedKey,
  resolveStreamFromAdapter,
} from '@/utils/audioEngine'

function audioWithDuration(duration: number): Pick<HTMLAudioElement, 'duration'> {
  return { duration }
}

/** 用 [start, end] 区间数组伪造 TimeRanges */
function audioWithBuffer(ranges: Array<[number, number]>): Pick<HTMLAudioElement, 'buffered'> {
  return {
    buffered: {
      length: ranges.length,
      start: (i: number) => ranges[i][0],
      end: (i: number) => ranges[i][1],
    } as unknown as TimeRanges,
  }
}

describe('加载 key', () => {
  it('从右侧切分，含 @ 的 songId 不会被误当成音质', () => {
    const parsed = parseLoadedKey(buildLoadedKey('srv', 'a@b', 'mp3', 1))

    // 从左往右切会把 'b' 当成音质，进而把切歌误判成音质切换
    expect(parsed).toEqual({ base: 'srv:a@b', quality: 'mp3', version: '1' })
  })

  it('各种含 @ 的 songId 都能原样往返', () => {
    const ids = ['plain', 'a@b', 'music/a@b@c.flac', 'trailing@', '@leading']

    for (const id of ids) {
      expect(parseLoadedKey(buildLoadedKey('srv', id, 'lossless', 7))).toEqual({
        base: `srv:${id}`,
        quality: 'lossless',
        version: '7',
      })
    }
  })

  it('段数不足的 key 解析失败而不是给出错误切分', () => {
    expect(parseLoadedKey('plain')).toBeNull()
    expect(parseLoadedKey('srv:song@mp3')).toBeNull()
  })

  it('同曲同版本仅音质不同时，base 与 version 相同、quality 不同', () => {
    const before = parseLoadedKey(buildLoadedKey('srv', 'song@1', 'lossless', 4))
    const after = parseLoadedKey(buildLoadedKey('srv', 'song@1', 'high', 4))

    expect(after?.base).toBe(before?.base)
    expect(after?.version).toBe(before?.version)
    expect(after?.quality).not.toBe(before?.quality)
  })

  it('重播同一首歌会产生不同的 key', () => {
    expect(buildLoadedKey('srv', 'song', 'high', 1))
      .not.toBe(buildLoadedKey('srv', 'song', 'high', 2))
  })
})

describe('getFiniteDuration', () => {
  it('流媒体未缓冲完时的 Infinity 视为未知', () => {
    expect(getFiniteDuration(audioWithDuration(Number.POSITIVE_INFINITY))).toBeNull()
  })

  it('NaN、0 与负数都视为未知', () => {
    expect(getFiniteDuration(audioWithDuration(Number.NaN))).toBeNull()
    expect(getFiniteDuration(audioWithDuration(0))).toBeNull()
    expect(getFiniteDuration(audioWithDuration(-1))).toBeNull()
  })

  it('有效时长原样返回', () => {
    expect(getFiniteDuration(audioWithDuration(203.5))).toBe(203.5)
  })
})

describe('isAtBufferedTail', () => {
  it('完全没有缓冲区间时视为已到缓冲尾', () => {
    expect(isAtBufferedTail(audioWithBuffer([]), 30)).toBe(true)
  })

  it('后面还有充足缓冲时不算到尾', () => {
    expect(isAtBufferedTail(audioWithBuffer([[0, 120]]), 30)).toBe(false)
  })

  it('缓冲末端与当前位置的间隙小于阈值才算到尾', () => {
    expect(isAtBufferedTail(audioWithBuffer([[0, 10]]), 9.6)).toBe(true)
    expect(isAtBufferedTail(audioWithBuffer([[0, 10]]), 9.5)).toBe(false)
  })

  it('多段缓冲时只看最后一段的末端', () => {
    expect(isAtBufferedTail(audioWithBuffer([[0, 20], [100, 200]]), 30)).toBe(false)
  })

  it('读取 buffered 抛错时保守地判为已到尾', () => {
    const broken = {
      get buffered(): TimeRanges {
        throw new Error('InvalidStateError')
      },
    }
    expect(isAtBufferedTail(broken, 30)).toBe(true)
  })
})

describe('accumulateListenedDelta', () => {
  it('正常播放的小步前进按实际增量计入', () => {
    expect(accumulateListenedDelta(10, 10.25)).toBe(0.25)
  })

  it('第一次 timeupdate 没有前值时不计入', () => {
    // 前值哨兵是 -1，若少了这道判断，从 0 起播的第一帧会白送将近 1 秒
    expect(accumulateListenedDelta(-1, 0.5)).toBe(0)
    expect(accumulateListenedDelta(-1, 30)).toBe(0)
  })

  it('向前拖动进度条不计入，否则收听时长会被灌水', () => {
    expect(accumulateListenedDelta(10, 180)).toBe(0)
  })

  it('向后拖动进度条不计入，也不会产生负数', () => {
    expect(accumulateListenedDelta(180, 10)).toBe(0)
  })

  it('2 秒是计入上限，边界值本身不计入', () => {
    expect(accumulateListenedDelta(10, 11.99)).toBeCloseTo(1.99)
    expect(accumulateListenedDelta(10, 12)).toBe(0)
  })

  it('暂停期间时间不动，不产生收听时长', () => {
    expect(accumulateListenedDelta(42, 42)).toBe(0)
  })

  it('一整条含 seek 的时间线只累计真实播放的部分', () => {
    // 1.5 → 120 是用户拖动，跳过的 118.5 秒不该算听过
    const timeline = [0, 0.5, 1, 1.5, 120, 120.5, 121]
    let listened = 0
    let prev = -1
    for (const t of timeline) {
      listened += accumulateListenedDelta(prev, t)
      prev = t
    }

    expect(listened).toBeCloseTo(2.5)
  })
})

describe('isPrematureEnd', () => {
  it('距元数据时长还差很多时判为断流，而不是播完', () => {
    expect(isPrematureEnd(100, 300)).toBe(true)
  })

  it('正常播到结尾不判为断流', () => {
    expect(isPrematureEnd(295, 300)).toBe(false)
  })

  it('30 秒以下的短曲目不参与判定，避免把小样本误判成断流', () => {
    expect(isPrematureEnd(1, 25)).toBe(false)
    expect(isPrematureEnd(1, 29)).toBe(false)
    expect(isPrematureEnd(1, 30)).toBe(true)
  })

  it('播放位置未知时不判为断流', () => {
    expect(isPrematureEnd(0, 300)).toBe(false)
  })

  it('只差 20 秒或已过 90% 都按正常播完处理', () => {
    expect(isPrematureEnd(280, 300)).toBe(false)
    expect(isPrematureEnd(270, 300)).toBe(false)
  })

  it('元数据时长缺失时不判为断流，也不会被 0 除污染', () => {
    expect(isPrematureEnd(100, 0)).toBe(false)
    expect(isPrematureEnd(0, 0)).toBe(false)
  })
})

describe('isNearEndOfTrack', () => {
  it('剩余不到 6 秒时算已到结尾', () => {
    expect(isNearEndOfTrack(295, 300)).toBe(true)
    // 短曲目够不到 97% 分支，只能靠剩余秒数判定
    expect(isNearEndOfTrack(45, 50)).toBe(true)
    expect(isNearEndOfTrack(43, 50)).toBe(false)
  })

  it('长曲目播过 97% 即算到结尾，即使剩余仍有几十秒', () => {
    expect(isNearEndOfTrack(970, 1000)).toBe(true)
    expect(isNearEndOfTrack(960, 1000)).toBe(false)
  })

  it('曲目中段停滞不算到结尾，避免误跳下一首', () => {
    expect(isNearEndOfTrack(60, 300)).toBe(false)
  })

  it('时长不可靠时一律不算到结尾', () => {
    expect(isNearEndOfTrack(14, 15)).toBe(false)
    expect(isNearEndOfTrack(300, Number.POSITIVE_INFINITY)).toBe(false)
    expect(isNearEndOfTrack(10, 0)).toBe(false)
  })
})

describe('流地址缓存 key', () => {
  it('不含 playVersion：重播同一首命中同一 key，音质不同则不同', () => {
    expect(buildStreamCacheKey('srv', 'song', 'high'))
      .toBe(buildStreamCacheKey('srv', 'song', 'high'))
    expect(buildStreamCacheKey('srv', 'song', 'high'))
      .not.toBe(buildStreamCacheKey('srv', 'song', 'lossless'))
  })

  it('serverId 分域：两个服务器的同 id 歌曲不共享缓存', () => {
    expect(buildStreamCacheKey('srv-a', '1042', 'high'))
      .not.toBe(buildStreamCacheKey('srv-b', '1042', 'high'))
  })
})

describe('isStreamExpired', () => {
  const EXPIRES = 1_000_000

  it('过期前 margin 内即判死：压线取到的地址多半撑不到真正开播', () => {
    expect(isStreamExpired(EXPIRES, EXPIRES - 31_000)).toBe(false)
    expect(isStreamExpired(EXPIRES, EXPIRES - 30_000)).toBe(true)
    expect(isStreamExpired(EXPIRES, EXPIRES - 1)).toBe(true)
  })

  it('已过期的地址当然判死', () => {
    expect(isStreamExpired(EXPIRES, EXPIRES + 1)).toBe(true)
    expect(isStreamExpired(EXPIRES, EXPIRES + 60_000)).toBe(true)
  })

  it('margin 可以自定义（测试与紧场景用）', () => {
    expect(isStreamExpired(EXPIRES, EXPIRES - 5_000, 4_000)).toBe(false)
    expect(isStreamExpired(EXPIRES, EXPIRES - 5_000, 6_000)).toBe(true)
  })
})

describe('resolveStreamFromAdapter', () => {
  it('异步适配器：await resolveStreamUrl，透传 expiresAt', async () => {
    const now = 5_000_000
    const resolved = await resolveStreamFromAdapter(
      {
        getStreamUrl: () => { throw new Error('should not be called') },
        resolveStreamUrl: async songId => ({ url: `https://cdn.test/${songId}`, expiresAt: now + 60_000 }),
      },
      's1',
      { maxBitrate: 320, quality: 'high' },
      now
    )
    expect(resolved).toEqual({ url: 'https://cdn.test/s1', expiresAt: now + 60_000, resolvedAt: now, async: true })
  })

  it('异步适配器不带 expiresAt 时按 20 分钟默认 TTL 补齐', async () => {
    const now = 5_000_000
    const resolved = await resolveStreamFromAdapter(
      {
        getStreamUrl: () => '',
        resolveStreamUrl: async songId => ({ url: `https://cdn.test/${songId}` }),
      },
      's1',
      { maxBitrate: 0, quality: 'lossless' },
      now
    )
    expect(resolved.expiresAt).toBe(now + DEFAULT_STREAM_TTL_MS)
    expect(resolved.async).toBe(true)
  })

  it('同步适配器：包一层 getStreamUrl，占位过期时间远超会话寿命', async () => {
    const now = 5_000_000
    const resolved = await resolveStreamFromAdapter(
      { getStreamUrl: (songId, bitrate, format) => `https://nas.test/stream?id=${songId}&b=${bitrate}&f=${format}` },
      's1',
      { maxBitrate: 320, quality: 'high', contentType: 'audio/flac', path: 'a/b.flac', suffix: 'flac' },
      now
    )
    expect(resolved.url).toBe('https://nas.test/stream?id=s1&b=320&f=')
    expect(resolved.async).toBe(false)
    expect(isStreamExpired(resolved.expiresAt, now + 60_000)).toBe(false)
  })

  it('插件流 5 秒后过期：margin 内即判死，须如实重取', async () => {
    const now = 5_000_000
    const resolved = await resolveStreamFromAdapter(
      {
        getStreamUrl: () => '',
        resolveStreamUrl: async () => ({ url: 'data:audio/wav;base64,AAA', expiresAt: now + 5_000 }),
      },
      's1',
      { maxBitrate: 0, quality: 'lossless' },
      now
    )
    // 5 秒 < 30 秒 margin：解析完成的那一刻就已经在「即将过期」窗口内
    expect(isStreamExpired(resolved.expiresAt, now)).toBe(true)
    expect(isStreamExpired(resolved.expiresAt, now, 1_000)).toBe(false)
  })
})
