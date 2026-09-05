/**
 * 开发代理 /__n1ko_proxy 的服务端防线（vite.config.ts）。
 *
 * 这个端点是本机上唯一「替调用方出网」的地方：白名单必须来自磁盘上的
 * manifest（不是请求体）、来源必须是本 dev server、目标解析到私网要拒、
 * 3xx 逐跳复检。中间件本身要起 dev server 才跑得起来，这里钉住的是它
 * 调用的那几个判定函数（与中间件同一份实现）。
 */

import { describe, expect, it, vi } from 'vitest'
import { fileURLToPath } from 'node:url'

// dns 得先桩掉：单测不能真去解析域名（离线环境下会全部判成「解析不了→拒绝」）
const dnsState = vi.hoisted(() => ({
  addresses: [{ address: '93.184.216.34', family: 4 }] as Array<{ address: string; family: number }>,
}))
vi.mock('node:dns', () => ({
  default: { promises: { lookup: async () => dnsState.addresses } },
}))

const {
  PROXY_MAX_HOPS,
  pluginHostsFromDisk,
  proxyRequestGuard,
  proxyWithHops,
  resolvesToPrivateAddress,
} = await import('./vite.config')

const PLUGINS_ROOT = fileURLToPath(new URL('../plugins', import.meta.url))

const jsonHeaders = {
  'x-n1ko-proxy': '1',
  origin: 'http://localhost:5173',
  host: 'localhost:5173',
  'sec-fetch-site': 'same-origin',
  'content-type': 'application/json',
}

describe('proxyRequestGuard（来源与形状）', () => {
  it('本 dev server 自己发来的 JSON 请求放行', () => {
    expect(proxyRequestGuard(jsonHeaders)).toBeNull()
    // Sec-Fetch-Site 缺失（老浏览器）不阻断，其余三条仍在
    expect(proxyRequestGuard({ ...jsonHeaders, 'sec-fetch-site': undefined })).toBeNull()
  })

  it('缺自定义头 → 拒（跨源因此必须先过预检，而这端点不回 CORS 头）', () => {
    expect(proxyRequestGuard({ ...jsonHeaders, 'x-n1ko-proxy': undefined })).toMatch(/X-N1KO-Proxy/)
  })

  it('Origin 不是本 dev 源 → 拒', () => {
    expect(proxyRequestGuard({ ...jsonHeaders, origin: 'https://evil.example.com' })).toMatch(/cross-origin/)
    expect(proxyRequestGuard({ ...jsonHeaders, origin: undefined })).toMatch(/Origin/)
    expect(proxyRequestGuard({ ...jsonHeaders, origin: 'not a url' })).toMatch(/Origin/)
  })

  it('Sec-Fetch-Site 不是 same-origin → 拒', () => {
    expect(proxyRequestGuard({ ...jsonHeaders, 'sec-fetch-site': 'cross-site' })).toMatch(/cross-site/)
  })

  it('Content-Type 不是 JSON → 拒（表单式简单请求发不进来）', () => {
    expect(proxyRequestGuard({ ...jsonHeaders, 'content-type': 'text/plain' })).toMatch(/application\/json/)
  })
})

describe('pluginHostsFromDisk（白名单只认磁盘上的 manifest）', () => {
  it('按 pluginId 读到真实 hosts', () => {
    expect(pluginHostsFromDisk(PLUGINS_ROOT, 'netease')).toContain('music.163.com')
  })

  it('未知 / 非法 id 一律空名单（空名单 = 全部拒绝）', () => {
    expect(pluginHostsFromDisk(PLUGINS_ROOT, 'no-such-plugin')).toEqual([])
    expect(pluginHostsFromDisk(PLUGINS_ROOT, '')).toEqual([])
    // 路径穿越：id 正则先挡一道
    expect(pluginHostsFromDisk(PLUGINS_ROOT, '../../etc')).toEqual([])
    expect(pluginHostsFromDisk(PLUGINS_ROOT, 'Netease')).toEqual([])
  })
})

describe('resolvesToPrivateAddress（DNS 层的私网判定）', () => {
  it('解析到公网地址 → false', async () => {
    dnsState.addresses = [{ address: '93.184.216.34', family: 4 }]
    expect(await resolvesToPrivateAddress('https://music.163.com/a')).toBe(false)
  })

  it('公网域名解析到内网（DNS 指内网）→ true', async () => {
    dnsState.addresses = [{ address: '192.168.1.10', family: 4 }]
    expect(await resolvesToPrivateAddress('https://music.163.com/a')).toBe(true)
    dnsState.addresses = [{ address: '93.184.216.34', family: 4 }, { address: '169.254.169.254', family: 4 }]
    expect(await resolvesToPrivateAddress('https://music.163.com/a')).toBe(true)
    dnsState.addresses = [{ address: '93.184.216.34', family: 4 }]
  })

  it('URL 解析不了 → true（拿不准就不转）', async () => {
    expect(await resolvesToPrivateAddress('::nope::')).toBe(true)
  })
})

describe('proxyWithHops（服务端也逐跳复检）', () => {
  const ALLOW = ['music.163.com', '*.music.126.net']

  /** 假的一跳：按脚本回，并记下真正发出去的地址与头 */
  function sender(script: Array<{ status: number; headers: Record<string, string> }>) {
    const sent: Array<{ url: string; method: string; headers: Record<string, string> }> = []
    let i = 0
    const send = async (url: string, method: string, headers: Record<string, string>) => {
      sent.push({ url, method, headers: { ...headers } })
      const hop = script[Math.min(i++, script.length - 1)]
      return { status: hop.status, headers: hop.headers, buf: Buffer.from('') }
    }
    return { sent, send }
  }

  it('白名单内逐跳跟随', async () => {
    const { sent, send } = sender([
      { status: 302, headers: { location: 'https://m1.music.126.net/f' } },
      { status: 200, headers: {} },
    ])
    const out = await proxyWithHops('https://music.163.com/a', 'GET', {}, null, ALLOW, true, send)
    expect('blocked' in out).toBe(false)
    expect(sent.map(s => s.url)).toEqual(['https://music.163.com/a', 'https://m1.music.126.net/f'])
  })

  it('跳到白名单外 → blocked，第二跳不发', async () => {
    const { sent, send } = sender([
      { status: 302, headers: { location: 'https://evil.example.com/steal' } },
      { status: 200, headers: {} },
    ])
    const out = await proxyWithHops('https://music.163.com/a', 'GET', {}, null, ALLOW, true, send)
    expect(out).toMatchObject({ blocked: 'host not allowed' })
    expect(sent).toHaveLength(1)
  })

  it('跳到私网 → blocked', async () => {
    const { send } = sender([
      { status: 302, headers: { location: 'http://10.0.0.5/admin' } },
      { status: 200, headers: {} },
    ])
    const out = await proxyWithHops('https://music.163.com/a', 'GET', {}, null, ALLOW, true, send)
    expect(out).toMatchObject({ blocked: 'host not allowed' })
  })

  it('目标 DNS 指向内网 → blocked，一跳都不发', async () => {
    dnsState.addresses = [{ address: '127.0.0.1', family: 4 }]
    const { sent, send } = sender([{ status: 200, headers: {} }])
    const out = await proxyWithHops('https://music.163.com/a', 'GET', {}, null, ALLOW, true, send)
    expect(out).toMatchObject({ blocked: 'target resolves to a private address' })
    expect(sent).toHaveLength(0)
    dnsState.addresses = [{ address: '93.184.216.34', family: 4 }]
  })

  it('跨主机剥掉 Cookie / Authorization', async () => {
    const { sent, send } = sender([
      { status: 302, headers: { location: 'https://m1.music.126.net/f' } },
      { status: 200, headers: {} },
    ])
    await proxyWithHops(
      'https://music.163.com/a', 'GET',
      { Cookie: 'MUSIC_U=secret', Authorization: 'Bearer t', 'User-Agent': 'n1ko' },
      null, ALLOW, true, send,
    )
    expect(sent[1].headers).toEqual({ 'User-Agent': 'n1ko' })
  })

  it(`超过 ${PROXY_MAX_HOPS} 跳 → blocked`, async () => {
    const { sent, send } = sender([{ status: 302, headers: { location: 'https://music.163.com/loop' } }])
    const out = await proxyWithHops('https://music.163.com/a', 'GET', {}, null, ALLOW, true, send)
    expect(out).toMatchObject({ blocked: 'too many redirects' })
    expect(sent).toHaveLength(PROXY_MAX_HOPS + 1)
  })

  it('follow=false（宿主要 manual）时 3xx 原样回，不自作主张跟随', async () => {
    const { sent, send } = sender([{ status: 302, headers: { location: 'https://music.163.com/f' } }])
    const out = await proxyWithHops('https://music.163.com/a', 'GET', {}, null, ALLOW, false, send)
    expect(out).toMatchObject({ status: 302 })
    expect(sent).toHaveLength(1)
  })

  it('空白名单（未知 pluginId）时第一跳就 blocked', async () => {
    const { sent, send } = sender([{ status: 200, headers: {} }])
    const out = await proxyWithHops('https://music.163.com/a', 'GET', {}, null, [], true, send)
    expect(out).toMatchObject({ blocked: 'host not allowed' })
    expect(sent).toHaveLength(0)
  })
})
