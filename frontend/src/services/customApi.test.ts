/** 阶段 4.3：模板填空的唯一实现（全局替换 + 编码） */
import { describe, expect, it } from 'vitest'
import { buildRemoteCoverUrl, buildRemoteLyricsUrl, coverUrlFromTemplate, LRCAPI_COVER_URL, mayReceivePath } from '@/services/customApi'

describe('customApi 模板填空（4.3）', () => {
  it('占位符出现两次全部替换（旧 .replace 只换第一个）', () => {
    expect(buildRemoteCoverUrl('https://x/{title}/{title}.jpg', { title: '晴天' }))
      .toBe('https://x/%E6%99%B4%E5%A4%A9/%E6%99%B4%E5%A4%A9.jpg')
  })

  it('歌词与封面各自的键集合正确', () => {
    expect(buildRemoteLyricsUrl('/l?ar={artist}&ti={title}&al={album}&id={id}',
      { artist: 'A', title: 'T', album: 'AL', id: '1' }))
      .toBe('/l?ar=A&ti=T&al=AL&id=1')
  })

  it('空值替换成空串；空模板返回空串', () => {
    expect(buildRemoteCoverUrl('/c/{artist}', {})).toBe('/c/')
    expect(buildRemoteCoverUrl('', { title: 'x' })).toBe('')
  })
})

describe('LrcApi 公共实例不收文件路径', () => {
  it('公共实例读不到你的硬盘，不给它 path；自建的照给', () => {
    expect(mayReceivePath(new URL(LRCAPI_COVER_URL))).toBe(false)
    expect(mayReceivePath(new URL('http://192.168.1.3:28883/lyrics'))).toBe(true)
  })

  it('基地址式的封面模板只带歌名、歌手、专辑', () => {
    const url = new URL(coverUrlFromTemplate(LRCAPI_COVER_URL, { title: '成都', artist: '赵雷', album: '无法长大', id: '/音乐/a.flac' }))
    expect([...url.searchParams.keys()].sort()).toEqual(['album', 'artist', 'title'])
  })
})
