import { describe, expect, it } from 'vitest'
import { upgradeInsecureUrl } from './httpsUpgrade'

describe('upgradeInsecureUrl', () => {
  it('http 升到 https（壳里 http 子资源会被当混合内容拦掉）', () => {
    expect(upgradeInsecureUrl('http://p1.music.126.net/a==/1.jpg'))
      .toBe('https://p1.music.126.net/a==/1.jpg')
  })

  it('已经是 https、data:、以及不认识的形状都原样返回', () => {
    for (const u of [
      'https://p1.music.126.net/a.jpg',
      'data:image/png;base64,AAAA',
      'blob:tauri://localhost/x',
      '',
    ]) {
      expect(upgradeInsecureUrl(u)).toBe(u)
    }
  })

  it('只认协议前缀，不碰路径里出现的 http://', () => {
    expect(upgradeInsecureUrl('https://cdn.test/r?u=http://x.test/a.jpg'))
      .toBe('https://cdn.test/r?u=http://x.test/a.jpg')
  })
})
