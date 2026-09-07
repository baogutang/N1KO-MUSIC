/**
 * 桌面通道与开发态代理的行为必须一致——不一致的地方全是线上事故的来源。
 * 这里钉住三条：不跟随重定向、不带 Origin、插件自己设的 Origin 不被覆盖。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({ last: null as null | { url: string; init: Record<string, unknown> } }))
vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: (url: string, init: Record<string, unknown>) => {
    calls.last = { url, init }
    return Promise.resolve(new Response('ok', { status: 200 }))
  },
}))

const { tauriChannel } = await import('./tauriChannel')

const ALLOW = ['music.163.com']
const base = { url: 'https://music.163.com/x', method: 'GET', responseType: 'text' as const }

afterEach(() => { calls.last = null })

describe('tauriChannel', () => {
  it('用 maxRedirections: 0 而不是只写 redirect: manual', async () => {
    /*
     * tauri-plugin-http 压根不读 fetch 的 redirect 选项（它只认 maxRedirections），
     * 只写 redirect:'manual' 等于让 reqwest 默认跟随 10 跳：白名单只在第一跳生效，
     * QQ 扫码要读的那一跳 302 的 set-cookie（p_skey）也会被跟掉。
     */
    await tauriChannel(base, ALLOW, base.url)
    expect(calls.last?.init.maxRedirections).toBe(0)
  })

  it('插件没写 Origin 时送空串（crate 见空 Origin 会整个删掉）', async () => {
    await tauriChannel(base, ALLOW, base.url)
    expect((calls.last?.init.headers as Record<string, string>).Origin).toBe('')
  })

  it('插件自己写了 Origin 就不动它（QQ 的登录链路要求特定 Origin）', async () => {
    await tauriChannel(
      { ...base, url: 'https://y.qq.com/x', headers: { Origin: 'https://y.qq.com', Referer: 'https://y.qq.com/' } },
      ['y.qq.com'],
      'https://y.qq.com/x',
    )
    const headers = calls.last?.init.headers as Record<string, string>
    expect(headers.Origin).toBe('https://y.qq.com')
  })

  it('白名单外的地址在进通道之前就被拒', async () => {
    await expect(tauriChannel({ ...base, url: 'https://evil.test/x' }, ALLOW, 'https://evil.test/x'))
      .rejects.toThrow(/allowlist/)
    expect(calls.last).toBeNull()
  })
})
