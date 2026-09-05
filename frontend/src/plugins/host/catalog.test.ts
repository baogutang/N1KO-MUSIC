/**
 * 安装源校验与 manifest 校验（安装的第一道门）。
 */

import { afterEach, describe, expect, it } from 'vitest'
import { assertSafeInstallUrl, validateManifest } from './catalog'

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
