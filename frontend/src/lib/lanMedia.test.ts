import { describe, it, expect } from 'vitest'
import { toLanProxyUrl, fromLanProxyUrl, lanMediaUrl } from './lanMedia'

const ORIGIN = 'https://localhost'

describe('lanMedia', () => {
  it('http://IPv4 改写成同源代取地址，路径和参数原样带上', () => {
    expect(toLanProxyUrl('http://192.168.1.10:4533/rest/getCoverArt?id=al-1&size=300&u=demo', ORIGIN))
      .toBe('https://localhost/_n1ko_lan/192.168.1.10:4533/rest/getCoverArt?id=al-1&size=300&u=demo')
    expect(toLanProxyUrl('http://10.0.0.2/emby/Items/1/Images/Primary?api_key=k', ORIGIN))
      .toBe('https://localhost/_n1ko_lan/10.0.0.2/emby/Items/1/Images/Primary?api_key=k')
  })

  it('IPv6 地址也改写', () => {
    expect(toLanProxyUrl('http://[fd00::12]:8096/Audio/1/universal?api_key=k', ORIGIN))
      .toBe('https://localhost/_n1ko_lan/[fd00::12]:8096/Audio/1/universal?api_key=k')
  })

  it('主机名、https、非 http 地址原样返回', () => {
    for (const url of [
      'http://nas.local:4533/rest/stream?id=1',
      'https://192.168.1.10:4533/rest/stream?id=1',
      'https://music.example.com/rest/getCoverArt?id=1',
      'blob:https://localhost/abc',
      '',
    ]) {
      expect(toLanProxyUrl(url, ORIGIN)).toBe(url)
    }
  })

  it('HLS 播放列表里的相对地址解析出来仍在代取前缀下', () => {
    const playlist = toLanProxyUrl('http://192.168.1.10:8096/Audio/1/main.m3u8?api_key=k', ORIGIN)
    expect(new URL('hls1/main/0.ts?x=1', playlist).href)
      .toBe('https://localhost/_n1ko_lan/192.168.1.10:8096/Audio/1/hls1/main/0.ts?x=1')
  })

  it('能还原成服务器原地址（给原生取封面用）', () => {
    const original = 'http://192.168.1.10:4533/rest/getCoverArt?id=al-1&size=256'
    expect(fromLanProxyUrl(toLanProxyUrl(original, ORIGIN), ORIGIN)).toBe(original)
    expect(fromLanProxyUrl('https://music.example.com/a.jpg', ORIGIN)).toBe('https://music.example.com/a.jpg')
  })

  it('不在安卓原生壳里：什么都不改', () => {
    expect(lanMediaUrl('http://192.168.1.10:4533/rest/stream?id=1')).toBe('http://192.168.1.10:4533/rest/stream?id=1')
  })
})
