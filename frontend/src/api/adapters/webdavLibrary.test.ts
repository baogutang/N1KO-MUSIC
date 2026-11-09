import { describe, expect, it } from 'vitest'
import { buildLibrary, fileUrlOf, idOf, parsePropfind, sameResource } from './webdavLibrary'

const ROOT = 'http://192.168.1.3:5005'

const XML = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/音乐/周杰伦/七里香/</d:href>
    <d:propstat><d:prop>
      <d:displayname>七里香</d:displayname>
      <d:resourcetype><d:collection/></d:resourcetype>
    </d:prop></d:propstat>
  </d:response>
  <d:response>
    <d:href>/音乐/周杰伦/七里香/cover.jpg</d:href>
    <d:propstat><d:prop>
      <d:displayname>cover.jpg</d:displayname>
      <d:getcontentlength>100</d:getcontentlength>
      <d:getcontenttype>image/jpeg</d:getcontenttype>
      <d:resourcetype/>
    </d:prop></d:propstat>
  </d:response>
  <d:response>
    <d:href>/音乐/周杰伦/七里香/01%20七里香.flac</d:href>
    <d:propstat><d:prop>
      <d:displayname>01 七里香.flac</d:displayname>
      <d:getcontentlength>12345</d:getcontentlength>
      <d:getcontenttype>audio/flac</d:getcontenttype>
      <d:resourcetype/>
    </d:prop></d:propstat>
  </d:response>
  <d:response>
    <d:href>/音乐/周杰伦/七里香/01%20七里香.lrc</d:href>
    <d:propstat><d:prop>
      <d:displayname>01 七里香.lrc</d:displayname>
      <d:resourcetype/>
    </d:prop></d:propstat>
  </d:response>
</d:multistatus>`

describe('parsePropfind', () => {
  it('丢掉当前目录，并解出音频、封面和歌词', () => {
    const request = `${ROOT}/音乐/周杰伦/七里香/`
    const entries = parsePropfind(XML, request)
    expect(entries.map(entry => entry.name)).toEqual(['cover.jpg', '01 七里香.flac', '01 七里香.lrc'])
    expect(entries.some(entry => sameResource(entry.url, request))).toBe(false)
    const song = entries.find(entry => entry.name.endsWith('.flac'))
    expect(decodeURI(song?.url ?? '')).toContain('01 七里香.flac')
    expect(song?.size).toBe(12345)
    expect(song?.collection).toBe(false)
  })
})

describe('buildLibrary', () => {
  it('上一级文件夹是歌手，当前文件夹是专辑', () => {
    const directory = `${ROOT}/音乐/周杰伦/七里香/`
    const songUrl = `${ROOT}/音乐/周杰伦/七里香/01%20七里香.flac`
    const library = buildLibrary({
      serverId: 'nas',
      root: ROOT,
      files: [{ url: songUrl, name: '01 七里香.flac', directory, size: 12345 }],
      covers: new Map([[directory, `${directory}cover.jpg`]]),
      lrcs: new Map([[songUrl, `${directory}01%20七里香.lrc`]]),
    })
    expect(library.songs).toHaveLength(1)
    const id = idOf(songUrl)
    expect(library.songs[0]).toMatchObject({
      id,
      title: '七里香',
      artist: '周杰伦',
      album: '七里香',
      track: 1,
      serverId: 'nas',
      coverArt: idOf(`${directory}cover.jpg`),
      path: '/音乐/周杰伦/七里香/01 七里香.flac',
    })
    expect(library.albums[0].songCount).toBe(1)
    expect(library.artists.map(artist => artist.name)).toEqual(['周杰伦'])
    expect(library.lrcBySongId.get(id)).toBe(idOf(`${directory}01%20七里香.lrc`))
  })

  it('文件标签优先于文件夹名', () => {
    const directory = `${ROOT}/音乐2/杂/`
    const library = buildLibrary({
      serverId: 'nas',
      root: ROOT,
      files: [{
        url: `${ROOT}/音乐2/杂/a.flac`,
        name: 'a.flac',
        directory,
        tagTitle: '阿卜杜拉',
        tagArtist: '赵雷',
        tagAlbum: '署前街少年',
        tagTrack: 9,
      }],
      covers: new Map(),
      lrcs: new Map(),
    })
    expect(library.songs[0]).toMatchObject({ title: '阿卜杜拉', artist: '赵雷', album: '署前街少年', track: 9 })
    expect(library.artists.map(artist => artist.name)).toEqual(['赵雷'])
  })

  it('没有标签时从「歌手 - 歌名」拆文件名', () => {
    const library = buildLibrary({
      serverId: 'nas',
      root: ROOT,
      files: [{
        url: `${ROOT}/音乐2/a.mp3`,
        name: '陈小熊 - 你有多久没有看过星星.mp3',
        directory: `${ROOT}/音乐2/`,
      }],
      covers: new Map(),
      lrcs: new Map(),
    })
    expect(library.songs[0]).toMatchObject({
      title: '你有多久没有看过星星',
      artist: '陈小熊',
      album: '音乐2',
    })
  })

  it('直接放在根目录的歌归到「全部音乐」', () => {
    const library = buildLibrary({
      serverId: 'nas',
      root: ROOT,
      files: [{ url: `${ROOT}/a.mp3`, name: 'a.mp3', directory: `${ROOT}/` }],
      covers: new Map(),
      lrcs: new Map(),
    })
    expect(library.songs[0]).toMatchObject({ title: 'a', album: '全部音乐', artist: '未知歌手' })
  })
})

describe('id 和地址', () => {
  const next = 'http://192.168.1.150:5005'
  const file = `${ROOT}/sata11/%E8%AE%B8%E5%B5%A9%20-%20%E5%AE%87%E5%AE%99%E4%B9%8B%E5%A4%A7.mp3`

  it('id 只是路径，不带主机', () => {
    expect(idOf(file)).toBe('/sata11/%E8%AE%B8%E5%B5%A9%20-%20%E5%AE%87%E5%AE%99%E4%B9%8B%E5%A4%A7.mp3')
  })

  it('换 IP 之后同一个 id 拼出新地址', () => {
    expect(fileUrlOf(`${next}/dav`, idOf(file))).toBe(
      `${next}/sata11/%E8%AE%B8%E5%B5%A9%20-%20%E5%AE%87%E5%AE%99%E4%B9%8B%E5%A4%A7.mp3`,
    )
  })

  it('旧测试版留下的整条地址也换成当前主机', () => {
    expect(fileUrlOf(next, file)).toBe(`${next}${idOf(file)}`)
  })
})

describe('专辑歌手、时长与最近添加', () => {
  const dir = `${ROOT}/合辑/夏天/`
  const files = [
    { url: `${dir}1.flac`, name: '1.flac', directory: dir, tagTitle: '甲', tagArtist: '赵雷', tagAlbumArtist: '群星', tagAlbum: '夏天', tagTrack: 1, tagDuration: 200.4, modified: 1000 },
    { url: `${dir}2.flac`, name: '2.flac', directory: dir, tagTitle: '乙', tagArtist: '李志', tagAlbumArtist: '群星', tagAlbum: '夏天', tagTrack: 2, tagDuration: 100, modified: 1000 },
    { url: `${ROOT}/新/a.mp3`, name: 'a.mp3', directory: `${ROOT}/新/`, tagTitle: '丙', tagArtist: '赵雷', tagAlbum: '新专辑', modified: 5000 },
  ]
  const library = buildLibrary({ serverId: 'nas', root: ROOT, files, covers: new Map(), lrcs: new Map() })

  it('合辑按专辑歌手归成一张，曲目保留各自的歌手', () => {
    const album = library.albums.find(item => item.name === '夏天')
    expect(album?.artist).toBe('群星')
    expect(album?.songs.map(song => song.artist)).toEqual(['赵雷', '李志'])
    expect(album?.duration).toBe(300)
    expect(library.songs.find(song => song.title === '甲')?.duration).toBe(200)
  })

  it('只在合辑里唱过一首的歌手也有自己的歌手页', () => {
    const lizhi = library.artists.find(item => item.name === '李志')
    expect(lizhi?.songs?.map(song => song.title)).toEqual(['乙'])
    expect(lizhi?.albumCount).toBe(0)
    const zhaolei = library.artists.find(item => item.name === '赵雷')
    expect(zhaolei?.songs?.map(song => song.title).sort()).toEqual(['丙', '甲'])
  })

  it('最近添加按文件修改时间排', () => {
    expect(library.recentAlbums.map(album => album.name)).toEqual(['新专辑', '夏天'])
  })
})
