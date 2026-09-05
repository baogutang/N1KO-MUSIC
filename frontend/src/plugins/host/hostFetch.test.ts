/**
 * hostFetch 的白名单拒止与 URL 重建（PLAN 1.2）。
 *
 * 网络通道本身按平台分流（原生 / Tauri / 开发代理 / 浏览器），单测环境
 * 无法真实触达：这里钉住的是所有通道共享的安全边界——白名单外不触网、
 * 重建地址丢 userinfo、协议白名单。通道联路交给阶段 1.6 的浏览器走查
 * （开发代理转发 music.163.com 的 HEAD）。
 */

import { describe, expect, it, vi } from 'vitest'
import { followRedirects, hostFetch, MAX_REDIRECT_HOPS, rebuildAllowedUrl } from './hostFetch'
import type { HostFetchRequest, HostFetchResult } from '../types'

const ALLOW = ['music.163.com', '*.music.126.net']

describe('hostFetch 的白名单拒止', () => {
  it('白名单外的目标不触达任何网络通道，返回 forbidden', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))
    try {
      const result = await hostFetch(
        { url: 'https://evil.example.com/api', method: 'GET', responseType: 'json' },
        ALLOW,
      )
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('forbidden')
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('私网目标即使 allowlist 写了也拒绝', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))
    try {
      const result = await hostFetch(
        { url: 'http://127.0.0.1:8080/admin', method: 'GET', responseType: 'json' },
        ['127.0.0.1'],
      )
      expect(result.ok).toBe(false)
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('allow 为空数组时全部拒绝（必填语义）', async () => {
    const result = await hostFetch(
      { url: 'https://music.163.com/api', method: 'GET', responseType: 'json' },
      [],
    )
    expect(result.ok).toBe(false)
  })
})

describe('rebuildAllowedUrl', () => {
  it('放行的地址重建为 归一化小写 host + path + search', () => {
    expect(rebuildAllowedUrl('https://MUSIC.163.com/api/q?a=1&b=2', ALLOW))
      .toBe('https://music.163.com/api/q?a=1&b=2')
  })

  it('保留显式端口，丢弃 userinfo', () => {
    expect(rebuildAllowedUrl('https://user:pw@music.163.com:8443/api', ALLOW))
      .toBe('https://music.163.com:8443/api')
  })

  it('非 http(s) 协议返回 null', () => {
    expect(rebuildAllowedUrl('ftp://music.163.com/f', ALLOW)).toBeNull()
    expect(rebuildAllowedUrl('data:audio/wav;base64,AAA', ALLOW)).toBeNull()
  })

  it('白名单外返回 null', () => {
    expect(rebuildAllowedUrl('https://evil.example.com/api', ALLOW)).toBeNull()
  })

  it('解析失败返回 null', () => {
    expect(rebuildAllowedUrl('::not-a-url::', ALLOW)).toBeNull()
  })
})

// ===================================================
// 重定向：每一跳都复检白名单（通道一律不跟随）
// ===================================================

const okResult = (status: number, headers: Record<string, string> = {}): HostFetchResult =>
  ({ ok: true, status, headers, body: '', bodyEncoding: 'text' })

/** 记录每一跳真正发出去的请求，并按脚本回响应 */
function recordingSender(script: Array<HostFetchResult>) {
  const sent: HostFetchRequest[] = []
  let i = 0
  const send = async (hopRequest: HostFetchRequest): Promise<HostFetchResult> => {
    sent.push({ ...hopRequest })
    return script[Math.min(i++, script.length - 1)]
  }
  return { sent, send }
}

describe('followRedirects 逐跳复检白名单', () => {
  const req = (over: Partial<HostFetchRequest> = {}): HostFetchRequest => ({
    url: 'https://music.163.com/a', method: 'GET', responseType: 'json', ...over,
  })

  it('白名单内的跳转跟随，最终响应回给插件', async () => {
    const { sent, send } = recordingSender([
      okResult(302, { location: 'https://m804.music.126.net/final.mp3' }),
      okResult(200),
    ])
    const result = await followRedirects(req(), ALLOW, send)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.status).toBe(200)
    expect(sent.map(r => r.url)).toEqual([
      'https://music.163.com/a',
      'https://m804.music.126.net/final.mp3',
    ])
  })

  it('跳到白名单外（开放重定向）直接 forbidden，第二跳根本不发', async () => {
    const { sent, send } = recordingSender([
      okResult(302, { location: 'https://evil.example.com/steal' }),
      okResult(200),
    ])
    const result = await followRedirects(req(), ALLOW, send)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('forbidden')
    expect(sent).toHaveLength(1)
  })

  it('跳到私网（白名单主机上的开放重定向指内网）同样拒绝', async () => {
    const { sent, send } = recordingSender([
      okResult(302, { location: 'http://192.168.1.1/admin' }),
      okResult(200),
    ])
    const result = await followRedirects(req(), ALLOW, send)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('forbidden')
    expect(sent).toHaveLength(1)
  })

  it('相对 Location 按当前目标解析后再判', async () => {
    const { sent, send } = recordingSender([
      okResult(302, { location: '/b?x=1' }),
      okResult(200),
    ])
    await followRedirects(req(), ALLOW, send)
    expect(sent[1].url).toBe('https://music.163.com/b?x=1')
  })

  it('跨主机时剥掉 Cookie / Authorization，同主机保留', async () => {
    const headers = { Cookie: 'MUSIC_U=secret', Authorization: 'Bearer t', 'User-Agent': 'n1ko' }
    const cross = recordingSender([
      okResult(302, { location: 'https://m804.music.126.net/f' }),
      okResult(200),
    ])
    await followRedirects(req({ headers }), ALLOW, cross.send)
    expect(cross.sent[0].headers).toMatchObject({ Cookie: 'MUSIC_U=secret' })
    expect(cross.sent[1].headers).toEqual({ 'User-Agent': 'n1ko' })

    const same = recordingSender([
      okResult(302, { location: 'https://music.163.com/f' }),
      okResult(200),
    ])
    await followRedirects(req({ headers }), ALLOW, same.send)
    expect(same.sent[1].headers).toMatchObject({ Cookie: 'MUSIC_U=secret', Authorization: 'Bearer t' })
  })

  it(`超过 ${MAX_REDIRECT_HOPS} 跳放弃（重定向环不会把宿主拖住）`, async () => {
    const { sent, send } = recordingSender([okResult(302, { location: 'https://music.163.com/loop' })])
    const result = await followRedirects(req(), ALLOW, send)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('network')
    expect(sent).toHaveLength(MAX_REDIRECT_HOPS + 1)
  })

  it('303 与 302+POST 转 GET 并丢 body（与通道自动跟随时的行为一致）', async () => {
    const post = { method: 'POST', body: 'a=1', headers: { 'Content-Type': 'x' } }
    const r302 = recordingSender([okResult(302, { location: 'https://music.163.com/f' }), okResult(200)])
    await followRedirects(req(post), ALLOW, r302.send)
    expect(r302.sent[1].method).toBe('GET')
    expect(r302.sent[1].body).toBeUndefined()

    const r307 = recordingSender([okResult(307, { location: 'https://music.163.com/f' }), okResult(200)])
    await followRedirects(req(post), ALLOW, r307.send)
    expect(r307.sent[1].method).toBe('POST')
    expect(r307.sent[1].body).toBe('a=1')
  })

  it('redirect:manual 不跟随：3xx 原样交回（QQ 登录要自己读 Location）', async () => {
    const { sent, send } = recordingSender([okResult(302, { location: 'https://music.163.com/f' })])
    const result = await followRedirects(req({ redirect: 'manual' }), ALLOW, send)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.status).toBe(302)
      expect(result.headers.location).toBe('https://music.163.com/f')
    }
    expect(sent).toHaveLength(1)
  })

  it('首个目标就在白名单外时一跳都不发', async () => {
    const { sent, send } = recordingSender([okResult(200)])
    const result = await followRedirects(req({ url: 'https://evil.example.com/a' }), ALLOW, send)
    expect(result.ok).toBe(false)
    expect(sent).toHaveLength(0)
  })
})
