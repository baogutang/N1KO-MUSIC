/**
 * 安装源校验与 manifest 校验（安装的第一道门）。
 */

import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertSafeInstallUrl, fetchCatalog, loadableManifest, validateManifest, validateStoredManifest } from './catalog'
import { fetchInstallJson, fetchInstallText } from './installFetch'

const g = globalThis as Record<string, unknown>
const originalLocation = g.location

function setLocation(href: string) {
  Object.defineProperty(globalThis, 'location', { value: { href }, configurable: true, writable: true })
}

afterEach(() => {
  Object.defineProperty(globalThis, 'location', { value: originalLocation, configurable: true, writable: true })
})

describe('assertSafeInstallUrl · 同源放行按 protocol + host', () => {
  it('Tauri 自定义 scheme 下随包目录同源放行（origin 序列化是 "null"，不能比 origin）', () => {
    setLocation('tauri://localhost/index.html')
    expect(() => assertSafeInstallUrl('/plugins/catalog.json')).not.toThrow()
    expect(() => assertSafeInstallUrl('tauri://localhost/plugins/netease/manifest.json')).not.toThrow()
  })

  it('Capacitor iOS 的 capacitor://localhost 同理', () => {
    setLocation('capacitor://localhost/')
    expect(() => assertSafeInstallUrl('/plugins/catalog.json')).not.toThrow()
  })

  it('同为 "null" origin 的 data: / 其它自定义 scheme 不算同源', () => {
    setLocation('tauri://localhost/index.html')
    expect(() => assertSafeInstallUrl('data:application/json,[]')).toThrow(/https/)
    expect(() => assertSafeInstallUrl('evil://localhost/plugins/catalog.json')).toThrow(/https/)
  })

  it('非同源只认 https，且拒绝私网与 userinfo', () => {
    setLocation('http://localhost:5173/')
    expect(() => assertSafeInstallUrl('http://example.com/m.json')).toThrow(/https/)
    expect(() => assertSafeInstallUrl('https://user:pw@example.com/m.json')).toThrow(/用户名密码/)
    expect(() => assertSafeInstallUrl('https://192.168.1.2/m.json')).toThrow(/内网/)
    expect(() => assertSafeInstallUrl('https://example.com/m.json')).not.toThrow()
  })
})

describe('validateManifest · capabilities 只认协议里的名字', () => {
  const base = {
    id: 'demo', name: 'Demo', version: '1.0.0', protocol: 1, platform: 'demo',
    entry: 'index.js', auth: { kind: 'none' }, hosts: ['demo.test'], disclaimer: '声明',
  }

  it('MusicFree 写法 lyric / importMusicSheet 当场报错，而不是静默当没声明', () => {
    expect(() => validateManifest({ ...base, capabilities: ['search', 'lyric'] })).toThrow(/lyric/)
    expect(() => validateManifest({ ...base, capabilities: ['importMusicSheet'] })).toThrow(/importMusicSheet/)
  })

  it('协议 §6 的全部名字都放行（含 radio / recommendSongs / libraryBrowse）', () => {
    const caps = [
      'search', 'album', 'artist', 'lyrics', 'userPlaylists', 'favorites', 'playlistWrite',
      'topLists', 'recommendSheets', 'recommendSongs', 'importSheet', 'libraryBrowse', 'radio',
    ]
    expect(validateManifest({ ...base, capabilities: caps }).capabilities).toEqual(caps)
  })
})

// ===================================================
// hosts 条目的形状与通配宽度（2026-11-12 加固）
// ===================================================

describe('validateManifest · hosts 条目', () => {
  const base = {
    id: 'demo', name: 'Demo', version: '1.0.0', protocol: 1, platform: 'demo',
    entry: 'index.js', auth: { kind: 'none' }, capabilities: ['search'], disclaimer: '声明',
  }
  const withHosts = (hosts: string[]) => () => validateManifest({ ...base, hosts })

  it('通配基底过宽一律拒：裸 *、*.<单段>、常见的两段公共后缀、托管平台公共子域', () => {
    for (const h of ['*', '*.com', '*.cn', '*.net', '*.com.cn', '*.net.cn', '*.org.cn', '*.co.uk', '*.co.jp', '*.com.hk', '*.com.tw', '*.github.io', '*.COM.CN', '*.com.']) {
      expect(withHosts(['music.163.com', h]), h).toThrow(/过宽/)
    }
  })

  it('带协议 / 路径 / 端口 / userinfo / 空白 / 中间的 * 的条目拒绝', () => {
    for (const h of [
      'https://music.163.com', 'music.163.com/api', 'music.163.com:443', 'user@music.163.com',
      ' music.163.com', 'music.163.com ', 'music .163.com', 'a.*.163.com', 'music*.163.com', '*.', '.music.163.com',
      'music..163.com', '', '[::1]',
    ]) {
      expect(withHosts([h]), JSON.stringify(h)).toThrow(/hosts 条目/)
    }
  })

  it('正常的精确域名与具体站点的一级通配放行', () => {
    const ok = ['music.163.com', '*.music.126.net', '*.gtimg.cn', '*.stream.qqmusic.qq.com', 'mock.invalid', 'MUSIC.163.com', 'a_b.example.com', 'music.163.com.']
    expect(validateManifest({ ...base, hosts: ok }).hosts).toEqual(ok)
  })

  it('仓库里三个插件（netease / qqmusic / mock）的 manifest 在新规则下照样通过（安装与读盘两条）', () => {
    for (const id of ['netease', 'qqmusic', 'mock']) {
      const file = new URL(`../../../../plugins/${id}/manifest.json`, import.meta.url)
      const raw: unknown = JSON.parse(readFileSync(file, 'utf-8'))
      expect(validateManifest(raw).id, id).toBe(id)
      expect(validateStoredManifest(raw).id, id).toBe(id)
    }
  })

  it('读盘复验与安装同一套 hosts 规则，只放宽不认识的 capability 名', () => {
    expect(() => validateStoredManifest({ ...base, hosts: ['*.com'] })).toThrow(/过宽/)
    expect(() => validateManifest({ ...base, hosts: ['a.test'], capabilities: ['lyric'] })).toThrow(/lyric/)
    expect(validateStoredManifest({ ...base, hosts: ['a.test'], capabilities: ['lyric'] }).id).toBe('demo')
  })

  it('loadableManifest 的错误点名插件并给出下一步', () => {
    expect(() => loadableManifest('netease', { ...base, id: 'netease', hosts: ['*'] }))
      .toThrow(/插件 netease 的安装记录不合法.*卸载后重新安装/)
  })
})

// ===================================================
// 目录与安装取数不吃 HTTP 缓存（2026-11-12 加固）
// ===================================================

describe('目录 / manifest / 代码一律向服务器复验（cache: no-cache）', () => {
  it('fetchCatalog、fetchInstallJson、fetchInstallText 都带 no-cache', async () => {
    setLocation('http://localhost:5173/')
    const inits: Array<RequestInit | undefined> = []
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      inits.push(init)
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    try {
      await fetchCatalog('https://catalog.example.test/catalog.json')
      await fetchInstallJson('https://catalog.example.test/m/manifest.json')
      await fetchInstallText('https://catalog.example.test/m/index.js')
    } finally {
      spy.mockRestore()
    }
    expect(inits).toHaveLength(3)
    for (const init of inits) expect(init?.cache).toBe('no-cache')
  })
})
