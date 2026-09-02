/**
 * 域名白名单匹配（PLAN 1.2 验收：精确、`*.` 通配、端口、大小写）。
 */

import { describe, expect, it } from 'vitest'
import { isHostAllowed, isPrivateHost } from './whitelist'

const NETEASE = [
  'music.163.com',
  'interface.music.163.com',
  '*.music.126.net',
  '*.music.127.net',
]

describe('精确匹配', () => {
  it('列出的域名原样放行', () => {
    expect(isHostAllowed('https://music.163.com/api', NETEASE)).toBe(true)
    expect(isHostAllowed('https://interface.music.163.com/weapi', NETEASE)).toBe(true)
  })

  it('没列出的域名拒绝', () => {
    expect(isHostAllowed('https://evil.example.com/api', NETEASE)).toBe(false)
    expect(isHostAllowed('https://music.164.com/api', NETEASE)).toBe(false)
  })

  it('exact 条目不放行它的子域', () => {
    expect(isHostAllowed('https://a.music.163.com/api', NETEASE)).toBe(false)
  })
})

describe('* 通配（一级子域）', () => {
  it('一级子域命中', () => {
    expect(isHostAllowed('https://a.music.126.net/x', NETEASE)).toBe(true)
    expect(isHostAllowed('https://m804.music.126.net/x', NETEASE)).toBe(true)
  })

  it('裸域不命中（通配的是子域，不是域本身）', () => {
    expect(isHostAllowed('https://music.126.net/x', NETEASE)).toBe(false)
  })

  it('多级子域不命中', () => {
    expect(isHostAllowed('https://a.b.music.126.net/x', NETEASE)).toBe(false)
  })
})

describe('端口', () => {
  it('匹配只看 hostname：任意端口同样按域名判定', () => {
    expect(isHostAllowed('https://music.163.com:8443/api', NETEASE)).toBe(true)
    expect(isHostAllowed('http://music.163.com:8080/api', NETEASE)).toBe(true)
    expect(isHostAllowed('https://evil.example.com:443/api', NETEASE)).toBe(false)
  })
})

describe('大小写', () => {
  it('URL 与规则两侧都大小写不敏感', () => {
    expect(isHostAllowed('https://MUSIC.163.COM/api', NETEASE)).toBe(true)
    expect(isHostAllowed('https://music.163.com/api', ['MUSIC.163.COM'])).toBe(true)
    expect(isHostAllowed('https://A.Music.126.net/x', NETEASE)).toBe(true)
  })
})

describe('协议与形状', () => {
  it('只认 http(s)', () => {
    expect(isHostAllowed('ftp://music.163.com/f', NETEASE)).toBe(false)
    expect(isHostAllowed('file:///etc/passwd', NETEASE)).toBe(false)
    expect(isHostAllowed('javascript:alert(1)', NETEASE)).toBe(false)
  })

  it('解析不了的串直接拒绝', () => {
    expect(isHostAllowed('not a url', NETEASE)).toBe(false)
    expect(isHostAllowed('', NETEASE)).toBe(false)
  })
})

describe('私网与回环（SSRF 防线）', () => {
  it('内网地址即使写进 allowlist 也拒绝', () => {
    const allow = ['music.163.com', 'localhost', '192.168.1.10', '10.0.0.5']
    expect(isHostAllowed('http://localhost:4533/rest/ping', allow)).toBe(false)
    expect(isHostAllowed('http://127.0.0.1:8080/', allow)).toBe(false)
    expect(isHostAllowed('http://192.168.1.10:8090/', allow)).toBe(false)
    expect(isHostAllowed('http://10.0.0.5/', allow)).toBe(false)
    expect(isHostAllowed('http://172.16.0.1/', allow)).toBe(false)
    expect(isHostAllowed('http://169.254.169.254/latest/meta-data', allow)).toBe(false)
    expect(isHostAllowed('http://[::1]/', allow)).toBe(false)
  })

  it('isPrivateHost 独立可判', () => {
    expect(isPrivateHost('localhost')).toBe(true)
    expect(isPrivateHost('127.0.0.1')).toBe(true)
    expect(isPrivateHost('Music.163.com')).toBe(false)
    expect(isPrivateHost('a.music.126.net')).toBe(false)
  })
})
