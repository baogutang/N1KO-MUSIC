import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ExternalHttpError,
  fetchExternalImage,
  nextImageLocation,
  shouldRetryExternal,
} from '@/services/externalFetch'

describe('封面跳转', () => {
  it('301 到 http 图床时改走 https', () => {
    expect(nextImageLocation(
      'https://api.lrc.cx/cover?title=a',
      301,
      'http://p1.music.126.net/abc/1.jpg',
    )).toBe('https://p1.music.126.net/abc/1.jpg')
  })

  it('已经是 https 的地址保持原样', () => {
    expect(nextImageLocation(
      'https://api.lrc.cx/cover?title=a',
      302,
      'https://is1-ssl.mzstatic.com/image/cover.jpg',
    )).toBe('https://is1-ssl.mzstatic.com/image/cover.jpg')
  })

  it('正常图片响应不再跳', () => {
    expect(nextImageLocation('https://cdn.example/a.jpg', 200, '')).toBeNull()
  })

  it('没有 Location 或指回自己就停', () => {
    expect(nextImageLocation('https://api.lrc.cx/cover', 301, '')).toBeNull()
    expect(nextImageLocation('https://api.lrc.cx/cover', 301, 'https://api.lrc.cx/cover')).toBeNull()
  })
})

/**
 * 远程封面 / 歌词接口的失败不能被当成「没有」。
 *
 * 此前 !res.ok 一律 return null：429、5xx 与「确实没有」混为一谈，
 * react-query 把 null 当成功结果缓存——封面整个会话（staleTime Infinity）、歌词 30 分钟。
 * 只有服务器明确答复了才算「没有」；没问到答案就抛，让 query 进 error 态、之后还能再试。
 */
describe('fetchExternalImage：失败与「没有」要分清', () => {
  afterEach(() => vi.unstubAllGlobals())

  const stubFetch = (respond: () => Response | Promise<Response>) =>
    vi.stubGlobal('fetch', vi.fn(async () => respond()))
  const image = () => new Response(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), { status: 200 })

  it('429 / 5xx / 401 / 403 / 408 抛 ExternalHttpError（带状态码）', async () => {
    for (const status of [429, 500, 502, 503, 401, 403, 408]) {
      stubFetch(() => new Response('', { status }))
      const err = await fetchExternalImage('https://api.test/cover').catch(e => e)
      expect(err, `status ${status}`).toBeInstanceOf(ExternalHttpError)
      expect((err as ExternalHttpError).status).toBe(status)
    }
  })

  it('网络错误照常抛（不吞成 null）', async () => {
    stubFetch(() => { throw new TypeError('Failed to fetch') })
    await expect(fetchExternalImage('https://api.test/cover')).rejects.toThrow('Failed to fetch')
  })

  it('404 是明确的「没有」：返回 null，可以缓存', async () => {
    stubFetch(() => new Response('', { status: 404 }))
    expect(await fetchExternalImage('https://api.test/cover')).toBeNull()
  })

  it('成功但内容为空 / 不是图片：返回 null', async () => {
    stubFetch(() => new Response(new Blob([], { type: 'image/png' }), { status: 200 }))
    expect(await fetchExternalImage('https://api.test/cover')).toBeNull()
    stubFetch(() => new Response(new Blob(['<html>'], { type: 'text/html' }), { status: 200 }))
    expect(await fetchExternalImage('https://api.test/cover')).toBeNull()
  })

  it('成功且是图片：返回 blob 地址', async () => {
    stubFetch(image)
    expect(await fetchExternalImage('https://api.test/cover')).toMatch(/^blob:/)
  })
})

describe('shouldRetryExternal：失败后的自动重试', () => {
  it('网络错误与 5xx / 408 重试一次', () => {
    expect(shouldRetryExternal(0, new TypeError('Failed to fetch'))).toBe(true)
    expect(shouldRetryExternal(0, new ExternalHttpError(503))).toBe(true)
    expect(shouldRetryExternal(0, new ExternalHttpError(408))).toBe(true)
  })

  it('只重试一次，不会连环重发', () => {
    expect(shouldRetryExternal(1, new TypeError('Failed to fetch'))).toBe(false)
    expect(shouldRetryExternal(1, new ExternalHttpError(503))).toBe(false)
  })

  it('429 限流 / 401 / 403 不重试：再发一次只会加重限流或同样失败', () => {
    expect(shouldRetryExternal(0, new ExternalHttpError(429))).toBe(false)
    expect(shouldRetryExternal(0, new ExternalHttpError(401))).toBe(false)
    expect(shouldRetryExternal(0, new ExternalHttpError(403))).toBe(false)
  })
})
