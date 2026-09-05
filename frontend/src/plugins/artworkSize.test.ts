import { describe, expect, it } from 'vitest'
import { artworkSizeHint } from './artworkSize'

describe('artworkSizeHint', () => {
  it('网易云：按 2 倍尺寸加 param，封顶 1000', () => {
    expect(artworkSizeHint('http://p3.music.126.net/abc==/1.jpg', 64)).toBe('http://p3.music.126.net/abc==/1.jpg?param=128y128')
    expect(artworkSizeHint('https://p1.music.126.net/x/2.jpg?foo=1', 600)).toBe('https://p1.music.126.net/x/2.jpg?foo=1&param=1000y1000')
  })

  it('QQ：改写路径里的 R300x300 到向上取整的档位', () => {
    expect(artworkSizeHint('https://y.qq.com/music/photo_new/T002R300x300M000004Ntd8v1hJ7bR.jpg', 64))
      .toBe('https://y.qq.com/music/photo_new/T002R150x150M000004Ntd8v1hJ7bR.jpg')
    expect(artworkSizeHint('https://y.qq.com/music/photo_new/T002R300x300M000abc.jpg', 300))
      .toBe('https://y.qq.com/music/photo_new/T002R800x800M000abc.jpg')
    expect(artworkSizeHint('https://y.gtimg.cn/music/photo_new/T001R300x300M000singer.jpg', 96))
      .toBe('https://y.gtimg.cn/music/photo_new/T001R300x300M000singer.jpg')
  })

  it('其它域名、无尺寸、非法 URL 原样返回', () => {
    expect(artworkSizeHint('https://cdn.example.com/c.jpg', 64)).toBe('https://cdn.example.com/c.jpg')
    expect(artworkSizeHint('http://p3.music.126.net/abc==/1.jpg', undefined)).toBe('http://p3.music.126.net/abc==/1.jpg')
    expect(artworkSizeHint('not a url', 64)).toBe('not a url')
    expect(artworkSizeHint('data:image/png;base64,AAAA', 64)).toBe('data:image/png;base64,AAAA')
  })
})
