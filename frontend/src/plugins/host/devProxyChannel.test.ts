/**
 * 开发代理通道的客户端一侧：只送 pluginId（不再送白名单）、带上强制预检的
 * 自定义头、一律以「不跟随」发起。服务端那一半在 devProxyMiddleware.test.ts。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { devProxyChannel } from './devProxyChannel'
import type { HostFetchRequest } from '../types'

const ALLOW = ['music.163.com']
const request: HostFetchRequest = { url: 'https://music.163.com/api', method: 'GET', responseType: 'json' }

function mockProxy(response: Response) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(response)
}

const okBody = () => new Response(JSON.stringify({ status: 200, headers: {}, bodyBase64: btoa('{}') }))

afterEach(() => vi.restoreAllMocks())

describe('devProxyChannel', () => {
  it('请求体只带 pluginId 与目标地址，不再带调用方给的白名单', async () => {
    const spy = mockProxy(okBody())
    await devProxyChannel(request, ALLOW, 'https://music.163.com/api', { pluginId: 'netease' })
    const [url, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/__n1ko_proxy')
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.pluginId).toBe('netease')
    expect(body.url).toBe('https://music.163.com/api')
    expect(body).not.toHaveProperty('allow')
    // 跟随交给宿主侧逐跳复检，服务端不许自作主张跟随
    expect(body.redirect).toBe('manual')
  })

  it('带上 X-N1KO-Proxy 自定义头（跨源因此必须先过预检）', async () => {
    const spy = mockProxy(okBody())
    await devProxyChannel(request, ALLOW, 'https://music.163.com/api', { pluginId: 'netease' })
    const init = spy.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>)['X-N1KO-Proxy']).toBe('1')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })

  it('白名单外的目标不触达代理', async () => {
    const spy = mockProxy(okBody())
    const result = await devProxyChannel(
      { ...request, url: 'https://evil.example.com/a' }, ALLOW, 'https://evil.example.com/a',
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('forbidden')
    expect(spy).not.toHaveBeenCalled()
  })

  it('中间件回 403（来源/白名单被拒）翻译成 forbidden，不是网络故障', async () => {
    mockProxy(new Response('unknown pluginId', { status: 403 }))
    const result = await devProxyChannel(request, ALLOW, 'https://music.163.com/api', { pluginId: 'nope' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('forbidden')
      expect(result.error.message).toMatch(/unknown pluginId/)
    }
  })

  it('中间件回 502 仍按 network 处理（可重试）', async () => {
    mockProxy(new Response('proxy error: ECONNRESET', { status: 502 }))
    const result = await devProxyChannel(request, ALLOW, 'https://music.163.com/api', { pluginId: 'netease' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('network')
  })

  it('signal 透传给 fetch（宿主超时 / dispose 能掐断这一跳）', async () => {
    const spy = mockProxy(okBody())
    const controller = new AbortController()
    await devProxyChannel(request, ALLOW, 'https://music.163.com/api', {
      pluginId: 'netease', signal: controller.signal,
    })
    expect((spy.mock.calls[0][1] as RequestInit).signal).toBe(controller.signal)
  })
})
