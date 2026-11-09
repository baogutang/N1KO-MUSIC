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
    // 标签本身 + 后面一段（时长要看标签后的第一帧）
    expect(tags.bytesNeeded).toBe(10 + 256 + 4096)
  })

  it('ID3 的 TPE2 是专辑歌手', () => {
    const encoder = new TextEncoder()
    const frames = [
      ...id3Frame('TPE1', 3, [...encoder.encode('赵雷')]),
      ...id3Frame('TPE2', 3, [...encoder.encode('群星')]),
    ]
    expect(readAudioTags(id3(frames))).toMatchObject({ artist: '赵雷', albumArtist: '群星' })
  })

  it('FLAC 从 STREAMINFO 算时长', () => {
    const samples = 44100 * 180
    const info = new Array(34).fill(0)
    info[10] = (44100 >> 12) & 0xff
    info[11] = (44100 >> 4) & 0xff
    info[12] = ((44100 & 0x0f) << 4) | 0x02
    info[13] = 0xf0
    info[14] = (samples >>> 24) & 0xff
    info[15] = (samples >>> 16) & 0xff
    info[16] = (samples >>> 8) & 0xff
    info[17] = samples & 0xff
    const comments = flac(['ALBUMARTIST=群星'])
    const data = Uint8Array.from([0x66, 0x4c, 0x61, 0x43, 0x00, 0, 0, 34, ...info, ...comments.subarray(4)])
    expect(readAudioTags(data)).toMatchObject({ duration: 180, albumArtist: '群星', artist: '群星' })
  })

  it('变码率 MP3 按 Xing 头里的总帧数算时长', () => {
    const header = [0xff, 0xfb, 0x90, 0x00]
    const xing = [0x58, 0x69, 0x6e, 0x67, 0, 0, 0, 1, 0, 0, 0x03, 0xe8]
    const frame = [...header, ...new Array(32).fill(0), ...xing, ...new Array(64).fill(0)]
    const data = Uint8Array.from([...id3(id3Frame('TIT2', 3, [0x61])), ...frame])
    expect(readAudioTags(data).duration).toBeCloseTo((1000 * 1152) / 44100, 3)
  })

  it('固定码率 MP3 用文件大小估时长', () => {
    const tag = id3(id3Frame('TIT2', 3, [0x61]))
    const frame = [0xff, 0xfb, 0x90, 0x00, ...new Array(200).fill(0)]
    const data = Uint8Array.from([...tag, ...frame])
    const tags = readAudioTags(data, { fileSize: tag.length + 1_600_000 })
    expect(tags.duration).toBeCloseTo(100, 3)
  })

  it('WAV 用 data 块大小除以每秒字节数', () => {
    const fmt = [0x66, 0x6d, 0x74, 0x20, ...u32le(16), 1, 0, 2, 0, ...u32le(44100), ...u32le(176400), 4, 0, 16, 0]
    const data = Uint8Array.from([
      0x52, 0x49, 0x46, 0x46, ...u32le(0), 0x57, 0x41, 0x56, 0x45,
      ...fmt,
      0x64, 0x61, 0x74, 0x61, ...u32le(176400 * 10),
    ])
    expect(readAudioTags(data).duration).toBe(10)
  })

  it('M4A 读 mvhd 的时长和 ilst 里的歌名', () => {
    const box = (type: number[], body: number[]) => {
      const size = 8 + body.length
      return [(size >> 24) & 255, (size >> 16) & 255, (size >> 8) & 255, size & 255, ...type, ...body]
    }
    const ascii = (text: string) => [...text].map(char => char.charCodeAt(0))
    const be = (value: number) => [(value >> 24) & 255, (value >> 16) & 255, (value >> 8) & 255, value & 255]
    const mvhd = box(ascii('mvhd'), [0, 0, 0, 0, ...be(0), ...be(0), ...be(1000), ...be(215000), ...new Array(80).fill(0)])
    const title = box([0xa9, ...ascii('nam')], box(ascii('data'), [...be(1), ...be(0), ...new TextEncoder().encode('成都')]))
    const meta = box(ascii('meta'), [0, 0, 0, 0, ...box(ascii('ilst'), title)])
    const moov = box(ascii('moov'), [...mvhd, ...box(ascii('udta'), meta)])
    const data = Uint8Array.from([...box(ascii('ftyp'), ascii('M4A \0\0\0\0')), ...moov])
    expect(readAudioTags(data)).toMatchObject({ duration: 215, title: '成都' })
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
