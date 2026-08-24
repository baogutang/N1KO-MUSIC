import { describe, expect, it } from 'vitest'
import { redactUrl } from './redactUrl'

/**
 * 流地址带着凭据。把完整 URL 打进 console，用户复制日志求助时账号就跟着出去了。
 */
describe('日志脱敏', () => {
  it('抹掉 Subsonic 的 token 与 salt', () => {
    const out = redactUrl('https://music.example.com/rest/stream?id=42&u=n1ko&t=deadbeef&s=abc123&v=1.16.1')
    expect(out).not.toContain('deadbeef')
    expect(out).not.toContain('abc123')
    expect(out).toContain('t=***')
    expect(out).toContain('s=***')
  })

  it('保留排查真正需要的参数', () => {
    // id / format / maxBitRate 正是出问题时要看的东西，抹掉就等于没日志
    const out = redactUrl('https://m.test/rest/stream?id=42&t=x&format=flac&maxBitRate=0')
    expect(out).toContain('id=42')
    expect(out).toContain('format=flac')
    expect(out).toContain('maxBitRate=0')
  })

  it('抹掉 Jellyfin / Emby 的 api_key，且大小写不敏感', () => {
    expect(redactUrl('https://m.test/Audio/1/stream?api_key=secret')).not.toContain('secret')
    expect(redactUrl('https://m.test/a?API_KEY=secret')).not.toContain('secret')
    expect(redactUrl('https://m.test/a?X-Emby-Token=secret')).not.toContain('secret')
  })

  it('没有敏感参数时原样返回', () => {
    const clean = 'https://m.test/rest/stream?id=42&format=flac'
    expect(redactUrl(clean)).toBe(clean)
  })

  it('解析不了的输入不赌运气，直接不打', () => {
    // 宁可少一条日志，也不要把一段可能含凭据的字符串原样吐出去
    expect(redactUrl('not a url at all t=secret')).toBe('(unparseable url)')
  })
})
