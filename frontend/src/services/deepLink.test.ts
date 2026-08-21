import { describe, expect, it } from 'vitest'
import { parseDeepLink } from './deepLink'

describe('parseDeepLink', () => {
  it('播放控制指令不带路由', () => {
    expect(parseDeepLink('n1ko://play')).toEqual({ command: { kind: 'play' } })
    expect(parseDeepLink('n1ko://pause')).toEqual({ command: { kind: 'pause' } })
    expect(parseDeepLink('n1ko://next')).toEqual({ command: { kind: 'next' } })
    expect(parseDeepLink('n1ko://prev')).toEqual({ command: { kind: 'prev' } })
    expect(parseDeepLink('n1ko://previous')).toEqual({ command: { kind: 'prev' } })
    expect(parseDeepLink('n1ko://shuffle')).toEqual({ command: { kind: 'shuffleLibrary' } })
  })

  it('单曲既跳转也播放', () => {
    expect(parseDeepLink('n1ko://song/abc123')).toEqual({
      route: '/songs/abc123',
      command: { kind: 'playSong', id: 'abc123' },
    })
  })

  it('专辑和歌单默认只跳转，?play=1 才连播', () => {
    expect(parseDeepLink('n1ko://album/a1')).toEqual({ route: '/albums/a1' })
    expect(parseDeepLink('n1ko://album/a1?play=1')).toEqual({
      route: '/albums/a1',
      command: { kind: 'playAlbum', id: 'a1' },
    })
    expect(parseDeepLink('n1ko://playlist/p1?play=1')).toEqual({
      route: '/playlists/p1',
      command: { kind: 'playPlaylist', id: 'p1' },
    })
  })

  it('歌手只跳转，不擅自开始放歌', () => {
    expect(parseDeepLink('n1ko://artist/x9')).toEqual({ route: '/artists/x9' })
  })

  it('搜索词转义后带进查询串', () => {
    expect(parseDeepLink('n1ko://search?q=%E9%99%88%E7%B2%92'))
      .toEqual({ route: '/search?q=%E9%99%88%E7%B2%92' })
    expect(parseDeepLink('n1ko://search?q=a%20b')).toEqual({ route: '/search?q=a%20b' })
  })

  it('搜索没带词就只是打开搜索页', () => {
    expect(parseDeepLink('n1ko://search')).toEqual({ route: '/search' })
    expect(parseDeepLink('n1ko://search?q=%20%20')).toEqual({ route: '/search' })
  })

  it('id 不合白名单一律拒绝——这是外部输入', () => {
    expect(parseDeepLink('n1ko://song/..%2F..%2Fetc%2Fpasswd')).toBeNull()
    expect(parseDeepLink('n1ko://album/a b')).toBeNull()
    expect(parseDeepLink('n1ko://artist/')).toBeNull()
    expect(parseDeepLink(`n1ko://song/${'x'.repeat(129)}`)).toBeNull()
  })

  it('带 .. 的链接直接判畸形——URL 解析器会先把它归一化成另一个 id', () => {
    // 归一化后 pathname 变成 /settings，若照单全收就会播成另一首歌
    expect(parseDeepLink('n1ko://song/abc/../../settings')).toBeNull()
    expect(parseDeepLink('n1ko://album/../x')).toBeNull()
  })

  it('多段路径没有合法含义，一律拒绝', () => {
    expect(parseDeepLink('n1ko://song/abc/def')).toBeNull()
  })

  it('别的协议一概不认', () => {
    expect(parseDeepLink('https://evil.example/song/abc')).toBeNull()
    expect(parseDeepLink('javascript:alert(1)')).toBeNull()
    expect(parseDeepLink('file:///etc/passwd')).toBeNull()
  })

  it('不认识的动作返回 null，而不是猜一个', () => {
    expect(parseDeepLink('n1ko://delete-everything')).toBeNull()
    expect(parseDeepLink('n1ko://')).toBeNull()
  })

  it('畸形的百分号转义不抛错——调用方没有 try/catch，抛出去就是白屏', () => {
    expect(parseDeepLink('n1ko://song/%')).toBeNull()
    expect(parseDeepLink('n1ko://song/%zz')).toBeNull()
    expect(parseDeepLink('n1ko://album/abc%')).toBeNull()
  })

  it('不是合法 URL 时不抛错', () => {
    expect(parseDeepLink('')).toBeNull()
    expect(parseDeepLink('n1ko:/ /broken')).toBeNull()
  })

  it('动作大小写不敏感', () => {
    expect(parseDeepLink('n1ko://PLAY')).toEqual({ command: { kind: 'play' } })
  })
})
