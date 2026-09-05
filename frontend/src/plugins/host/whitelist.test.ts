/**
 * 域名白名单匹配（PLAN 1.2 验收：精确、`*.` 通配、端口、大小写）。
 */

import { describe, expect, it } from 'vitest'
import { isHostAllowed, isPrivateHost, safeResourceUrl, SMALL_DATA_IMAGE_MAX_CHARS } from './whitelist'

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

  it('localhost 的子域同样是回环（api.localhost 不再漏网）', () => {
    expect(isPrivateHost('api.localhost')).toBe(true)
    expect(isPrivateHost('a.b.LOCALHOST')).toBe(true)
    expect(isHostAllowed('http://api.localhost/admin', ['api.localhost', ...NETEASE])).toBe(false)
    // 不是子域边界的同名后缀仍是公网域名
    expect(isPrivateHost('notlocalhost')).toBe(false)
  })

  it('IPv6 ULA 覆盖 fc00::/7（fd00::/8 此前漏掉）', () => {
    expect(isPrivateHost('[fc00::1]')).toBe(true)
    expect(isPrivateHost('[fd12:3456::1]')).toBe(true)
    expect(isHostAllowed('http://[fd00::1]/x', ['fd00::1'])).toBe(false)
  })

  it('CGNAT 100.64.0.0/10 视为私网，相邻的 100.63/100.128 不是', () => {
    expect(isPrivateHost('100.64.0.1')).toBe(true)
    expect(isPrivateHost('100.127.255.254')).toBe(true)
    expect(isPrivateHost('100.63.0.1')).toBe(false)
    expect(isPrivateHost('100.128.0.1')).toBe(false)
  })

  it('IPv4-mapped IPv6 还原后按 v4 判（点分与十六进制两种写法）', () => {
    expect(isPrivateHost('[::ffff:127.0.0.1]')).toBe(true)
    // URL 解析器把上面那条归一化成的形态
    expect(isPrivateHost('[::ffff:7f00:1]')).toBe(true)
    expect(isPrivateHost('[::ffff:192.168.1.1]')).toBe(true)
    expect(isPrivateHost('[::ffff:8.8.8.8]')).toBe(false)
    expect(isHostAllowed('http://[::ffff:127.0.0.1]/', ['[::ffff:127.0.0.1]'])).toBe(false)
  })

  it('未指定地址 :: 拒绝', () => {
    expect(isPrivateHost('[::]')).toBe(true)
  })
})

describe('safeResourceUrl（交给主窗口加载的插件地址）', () => {
  it('白名单内的 http(s) 地址原样放行', () => {
    expect(safeResourceUrl('https://m804.music.126.net/x.jpg', NETEASE))
      .toBe('https://m804.music.126.net/x.jpg')
  })

  it('白名单外的封面地址丢弃（凭据拼进 query 的外泄路径）', () => {
    expect(safeResourceUrl('https://evil.example.com/c.jpg?c=MUSIC_U%3Dsecret', NETEASE)).toBeNull()
  })

  it('javascript: / file: 一律拒绝，开不开 data 都一样', () => {
    expect(safeResourceUrl('javascript:alert(1)', NETEASE)).toBeNull()
    expect(safeResourceUrl('javascript:alert(1)', NETEASE, { allowDataMedia: true })).toBeNull()
    expect(safeResourceUrl('file:///etc/passwd', NETEASE, { allowDataMedia: true })).toBeNull()
    // data:text/html 不是媒体，即使开了 allowDataMedia 也不放行
    expect(safeResourceUrl('data:text/html,<script>1</script>', NETEASE, { allowDataMedia: true })).toBeNull()
  })

  it('allowDataMedia 才放行 data: 媒体（二维码图 / Mock 的内存 WAV）', () => {
    const png = 'data:image/png;base64,AAAA'
    const wav = 'data:audio/wav;base64,AAAA'
    expect(safeResourceUrl(png, NETEASE)).toBeNull()
    expect(safeResourceUrl(png, NETEASE, { allowDataMedia: true })).toBe(png)
    expect(safeResourceUrl(wav, NETEASE, { allowDataMedia: true })).toBe(wav)
    // 空白名单也能出二维码：data: 不出网，与 hosts 无关
    expect(safeResourceUrl(png, [], { allowDataMedia: true })).toBe(png)
  })

  it('非字符串 / 空串 → null', () => {
    expect(safeResourceUrl(undefined, NETEASE)).toBeNull()
    expect(safeResourceUrl(42, NETEASE)).toBeNull()
    expect(safeResourceUrl('   ', NETEASE, { allowDataMedia: true })).toBeNull()
  })
})

describe('safeResourceUrl · 封面的内联小图', () => {
  it('几 KB 以内的 data:image 放行，超限或非图片仍拒', () => {
    const tiny = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E"
    expect(safeResourceUrl(tiny, [], { allowSmallDataImage: true })).toBe(tiny)
    const huge = 'data:image/png;base64,' + 'A'.repeat(SMALL_DATA_IMAGE_MAX_CHARS)
    expect(safeResourceUrl(huge, [], { allowSmallDataImage: true })).toBeNull()
    expect(safeResourceUrl('data:audio/wav;base64,AAAA', [], { allowSmallDataImage: true })).toBeNull()
    expect(safeResourceUrl('data:text/html,<script>1</script>', [], { allowSmallDataImage: true })).toBeNull()
    // 不开这一档时照旧全拒
    expect(safeResourceUrl(tiny, [])).toBeNull()
  })
})
