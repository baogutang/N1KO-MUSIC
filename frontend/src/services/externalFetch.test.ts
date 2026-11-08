import { describe, expect, it } from 'vitest'
import { nextImageLocation } from '@/services/externalFetch'

describe('封面跳转', () => {
  it('301 到 http 图床时改走 https', () => {
    expect(nextImageLocation(
      'https://api.lrc.cx/cover?title=a',
      301,
      'http://p1.music.126.net/abc/1.jpg',
    )).toBe('https://p1.music.126.net/abc/1.jpg')
  })

  it('已经是 https 的地址保持原样', () => {
    expect(nextImageLocation(
      'https://api.lrc.cx/cover?title=a',
      302,
      'https://is1-ssl.mzstatic.com/image/cover.jpg',
    )).toBe('https://is1-ssl.mzstatic.com/image/cover.jpg')
  })

  it('正常图片响应不再跳', () => {
    expect(nextImageLocation('https://cdn.example/a.jpg', 200, '')).toBeNull()
  })

  it('没有 Location 或指回自己就停', () => {
    expect(nextImageLocation('https://api.lrc.cx/cover', 301, '')).toBeNull()
    expect(nextImageLocation('https://api.lrc.cx/cover', 301, 'https://api.lrc.cx/cover')).toBeNull()
  })
})
