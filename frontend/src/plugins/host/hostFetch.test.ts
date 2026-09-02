/**
 * hostFetch 的白名单拒止与 URL 重建（PLAN 1.2）。
 *
 * 网络通道本身按平台分流（原生 / Tauri / 开发代理 / 浏览器），单测环境
 * 无法真实触达：这里钉住的是所有通道共享的安全边界——白名单外不触网、
 * 重建地址丢 userinfo、协议白名单。通道联路交给阶段 1.6 的浏览器走查
 * （开发代理转发 music.163.com 的 HEAD）。
 */

import { describe, expect, it, vi } from 'vitest'
import { hostFetch, rebuildAllowedUrl } from './hostFetch'

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
