import { describe, expect, it } from 'vitest'
import { buildLibrary, parsePropfind, sameResource } from './webdavLibrary'

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
    expect(library.songs[0]).toMatchObject({
      title: '七里香',
      artist: '周杰伦',
      album: '七里香',
      track: 1,
      serverId: 'nas',
      coverArt: `${directory}cover.jpg`,
    })
    expect(library.albums[0].songCount).toBe(1)
    expect(library.artists.map(artist => artist.name)).toEqual(['周杰伦'])
    expect(library.lrcBySongId.get(songUrl)).toContain('.lrc')
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
