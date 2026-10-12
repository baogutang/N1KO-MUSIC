/** 阶段 4.3：模板填空的唯一实现（全局替换 + 编码） */
import { describe, expect, it } from 'vitest'
import { buildRemoteCoverUrl, buildRemoteLyricsUrl } from '@/services/customApi'

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
