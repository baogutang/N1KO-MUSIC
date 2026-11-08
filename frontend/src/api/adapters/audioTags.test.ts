import { describe, expect, it } from 'vitest'
import { parseAudioFilename, readAudioTags } from './audioTags'

function u32le(value: number): number[] {
  return [value & 255, (value >> 8) & 255, (value >> 16) & 255, (value >> 24) & 255]
}

function utf16le(text: string): number[] {
  const bytes: number[] = [0xff, 0xfe]
  for (const char of text) {
    const code = char.charCodeAt(0)
    bytes.push(code & 255, (code >> 8) & 255)
  }
  return bytes
}

function synchsafe(size: number): number[] {
  return [(size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f]
}

function id3Frame(id: string, encoding: number, payload: number[]): number[] {
  const body = [encoding, ...payload]
  return [
    id.charCodeAt(0), id.charCodeAt(1), id.charCodeAt(2), id.charCodeAt(3),
    (body.length >> 24) & 255, (body.length >> 16) & 255, (body.length >> 8) & 255, body.length & 255,
    0, 0,
    ...body,
  ]
}

function id3(frames: number[]): Uint8Array {
  return Uint8Array.from([
    0x49, 0x44, 0x33, 0x03, 0x00, 0x00,
    ...synchsafe(frames.length),
    ...frames,
  ])
}

function flac(comments: string[]): Uint8Array {
  const encoder = new TextEncoder()
  const vendor = encoder.encode('test')
  const body = [...u32le(vendor.length), ...vendor, ...u32le(comments.length)]
  for (const comment of comments) {
    const bytes = encoder.encode(comment)
    body.push(...u32le(bytes.length), ...bytes)
  }
  return Uint8Array.from([
    0x66, 0x4c, 0x61, 0x43,
    0x84, (body.length >> 16) & 255, (body.length >> 8) & 255, body.length & 255,
    ...body,
  ])
}

describe('readAudioTags', () => {
  it('读出 FLAC 里的歌名、歌手、专辑和曲序', () => {
    const tags = readAudioTags(flac([
      'TITLE=阿卜杜拉',
      'ARTIST=赵雷',
      'ALBUM=署前街少年',
      'TRACKNUMBER=9',
    ]))
    expect(tags).toMatchObject({ title: '阿卜杜拉', artist: '赵雷', album: '署前街少年', track: 9 })
  })

  it('UTF-16LE 即使被标成大端，也按 BOM 读出中文', () => {
    const frame = id3Frame('TPE1', 2, utf16le('赵雷'))
    expect(readAudioTags(id3(frame)).artist).toBe('赵雷')
  })

  it('编码标成拉丁文、内容是 GBK 时读出中文', () => {
    const gbk = [0xd6, 0xdc, 0xbd, 0xdc, 0xc2, 0xd7]
    const frame = id3Frame('TPE1', 0, gbk)
    expect(readAudioTags(id3(frame)).artist).toBe('周杰伦')
  })

  it('标签比缓冲区长时，告诉调用方还要再读多少', () => {
    const tags = readAudioTags(Uint8Array.from([
      0x49, 0x44, 0x33, 0x04, 0x00, 0x00,
      0x00, 0x00, 0x02, 0x00,
    ]))
    expect(tags.bytesNeeded).toBe(10 + 256)
  })
})

describe('parseAudioFilename', () => {
  it('从「歌手 - 歌名」拆开', () => {
    expect(parseAudioFilename('陈小熊 - 你有多久没有看过星星.mp3')).toEqual({
      artist: '陈小熊',
      title: '你有多久没有看过星星',
    })
  })

  it('从「序号 歌手 - 专辑 - 歌名」拆开', () => {
    expect(parseAudioFilename('01 李志 - 勾三搭四 - 春天.flac')).toEqual({
      track: 1,
      artist: '李志',
      album: '勾三搭四',
      title: '春天',
    })
  })

  it('只有歌名时不猜歌手', () => {
    expect(parseAudioFilename('三十岁的女人.flac')).toEqual({ title: '三十岁的女人' })
  })
})
