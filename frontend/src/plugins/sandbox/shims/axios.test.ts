/** 沙箱 axios shim：默认请求头（各通道行为必须一致，见 tauriChannel.test.ts） */

import { describe, expect, it } from 'vitest'
import { createAxiosShim } from './axios'
import type { HostFetchRequest } from '../../types'

function shimWithCapture() {
  const seen: HostFetchRequest[] = []
  const ax = createAxiosShim(async req => {
    seen.push(req)
    return { ok: true, status: 200, headers: {}, body: '{}', bodyEncoding: 'text' }
  })
  return { ax, seen }
}

describe('默认 User-Agent', () => {
  it('插件没写就补一个普通浏览器的', async () => {
    // 不补的话开发态一个 UA 都不发，而桌面版会被 tauri-plugin-http 塞上
    // `tauri-plugin-http/2.6.0`——送到 QQ 登录服务器等于自报是机器人
    const { ax, seen } = shimWithCapture()
    await ax.get('https://y.qq.com/x')
    expect(seen[0].headers?.['User-Agent']).toMatch(/^Mozilla\/5\.0 /)
  })

  it('插件自己写了就不覆盖（网易云 eapi 要客户端 UA）', async () => {
    const { ax, seen } = shimWithCapture()
    await ax.get('https://music.163.com/x', { headers: { 'User-Agent': 'NetEaseMusic/9.0.90' } })
    expect(seen[0].headers?.['User-Agent']).toBe('NetEaseMusic/9.0.90')
  })

  it('大小写不同的写法也算插件写过了', async () => {
    const { ax, seen } = shimWithCapture()
    await ax.get('https://music.163.com/x', { headers: { 'user-agent': 'Custom/1.0' } })
    const headers = seen[0].headers ?? {}
    expect(headers['user-agent']).toBe('Custom/1.0')
    expect(headers['User-Agent']).toBeUndefined()
  })
})
