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

const hex = (text: string) => (text.match(/../g) ?? []).map(byte => parseInt(byte, 16))
const bytesOf = (text: string) => [...text].map(char => char.charCodeAt(0))

describe('ID3 编码 0：真的 Latin-1、其实是 GBK，还是 UTF-8', () => {
  const artist = (bytes: number[]) => readAudioTags(id3(id3Frame('TPE1', 0, bytes))).artist

  // 字节都是 iconv 转出来的真实编码
  it.each([
    ['Björk', '426af6726b'],
    ['Café', '436166e9'],
    ['Sigur Rós', '53696775722052f373'],
    ['Mötley Crüe', '4df6746c6579204372fc65'],
    ['Größe', '4772f6df65'],
  ])('西文 Latin-1 不当成 GBK：%s', (expected, bytes) => {
    expect(artist(hex(bytes))).toBe(expected)
  })

  it.each([
    ['周杰伦', 'd6dcbddcc2d7'],
    ['陈奕迅 - K歌之王', 'b3c2dec8d1b8202d204bb8e8d6aecdf5'],
    // D0 A1 恰好也是合法的 UTF-8（西里尔字母 С），不能只看合不合法
    ['小S', 'd0a153'],
    ['王菲', 'cdf5b7c6'],
  ])('GBK 的中文照样读出来：%s', (expected, bytes) => {
    expect(artist(hex(bytes))).toBe(expected)
  })

  it('纯 ASCII', () => {
    expect(artist(bytesOf('Radiohead'))).toBe('Radiohead')
  })

  it.each(['Björk', 'Sigur Rós', '周杰伦'])('标成编码 0 的 UTF-8：%s', text => {
    expect(artist([...new TextEncoder().encode(text)])).toBe(text)
  })
})

describe('开头挂了 ID3 的 FLAC', () => {
  function flacFile(comments: string[], seconds: number): number[] {
    const rate = 44100
    const samples = rate * seconds
    const info = new Array(34).fill(0)
    info[10] = (rate >> 12) & 0xff
    info[11] = (rate >> 4) & 0xff
    info[12] = ((rate & 0x0f) << 4) | 0x02
    info[13] = 0xf0
    info[14] = (samples >>> 24) & 0xff
    info[15] = (samples >>> 16) & 0xff
    info[16] = (samples >>> 8) & 0xff
    info[17] = samples & 0xff
    return [0x66, 0x4c, 0x61, 0x43, 0x00, 0, 0, 34, ...info, ...flac(comments).subarray(4)]
  }
  const tag = id3([
    ...id3Frame('TIT2', 3, bytesOf('from id3')),
    ...id3Frame('TALB', 3, bytesOf('only in id3')),
  ])

  it('跳过 ID3 按 FLAC 读：FLAC 的标签为准，时长取 STREAMINFO', () => {
    const data = Uint8Array.from([...tag, ...flacFile(['TITLE=七里香', 'ARTIST=周杰伦'], 180)])
    expect(readAudioTags(data)).toEqual({ title: '七里香', artist: '周杰伦', album: 'only in id3', duration: 180 })
  })

  it('FLAC 的注释块没读全时，按整个文件的偏移要更多字节', () => {
    const full = [...tag, ...flacFile(['TITLE=七里香', 'ARTIST=周杰伦'], 180)]
    const tags = readAudioTags(Uint8Array.from(full.slice(0, tag.length + 4 + 38 + 4 + 5)))
    expect(tags.duration).toBe(180)
    expect(tags.bytesNeeded).toBe(full.length)
  })
})

describe('Ogg Vorbis / Opus', () => {
  function oggPage(serial: number, flags: number, laces: number[], body: number[]): number[] {
    return [
      ...bytesOf('OggS'), 0, flags, ...new Array(8).fill(0), ...u32le(serial), ...u32le(0), 0, 0, 0, 0,
      laces.length, ...laces, ...body,
    ]
  }
  /** 一个完整包的分段表：255 表示没完，最后一段小于 255 */
  function lacesOf(length: number): number[] {
    return [...new Array(Math.floor(length / 255)).fill(255), length % 255]
  }
  function commentBody(comments: string[]): number[] {
    const encoder = new TextEncoder()
    const out = [...u32le(4), ...bytesOf('test'), ...u32le(comments.length)]
    for (const comment of comments) {
      const bytes = encoder.encode(comment)
      out.push(...u32le(bytes.length), ...bytes)
    }
    return out
  }
  const vorbisId = [0x01, ...bytesOf('vorbis'), ...new Array(23).fill(0)]
  const vorbisComment = (comments: string[]) => [0x03, ...bytesOf('vorbis'), ...commentBody(comments), 0x01]

  it('Vorbis 注释包跨了两页也拼得起来', () => {
    const comment = vorbisComment([
      'TITLE=Hoppípolla',
      'ARTIST=Sigur Rós',
      'ALBUM=Takk...',
      'ALBUMARTIST=Sigur Rós',
      'TRACKNUMBER=2/11',
      `DESCRIPTION=${'x'.repeat(600)}`,
    ])
    const laces = lacesOf(comment.length)
    const data = Uint8Array.from([
      ...oggPage(7, 0x02, lacesOf(vorbisId.length), vorbisId),
      ...oggPage(7, 0, laces.slice(0, 2), comment.slice(0, 510)),
      ...oggPage(7, 0x01, laces.slice(2), comment.slice(510)),
    ])
    // 时长在文件末尾，只读开头不给
    expect(readAudioTags(data)).toEqual({
      title: 'Hoppípolla',
      artist: 'Sigur Rós',
      album: 'Takk...',
      albumArtist: 'Sigur Rós',
      track: 2,
    })
  })

  it('Opus 的 OpusTags；前面别的流（Skeleton）的页跳过', () => {
    const head = [...bytesOf('OpusHead'), 1, 2, 0x38, 0x01, ...u32le(48000), 0, 0, 0]
    const tags = [...bytesOf('OpusTags'), ...commentBody(['title=夜曲', 'artist=周杰伦', 'album=十一月的萧邦', 'tracknumber=1'])]
    const skeleton = [...bytesOf('fishead\0'), ...new Array(56).fill(0)]
    const data = Uint8Array.from([
      ...oggPage(99, 0x02, lacesOf(skeleton.length), skeleton),
      ...oggPage(5, 0x02, lacesOf(head.length), head),
      ...oggPage(99, 0x04, [0], []),
      ...oggPage(5, 0, lacesOf(tags.length), tags),
    ])
    expect(readAudioTags(data)).toEqual({ title: '夜曲', artist: '周杰伦', album: '十一月的萧邦', track: 1 })
  })

  it('注释包里塞了大封面、没读全：先给读到的，再要更多字节', () => {
    const comment = vorbisComment(['TITLE=Alpha', 'ARTIST=Beta', `METADATA_BLOCK_PICTURE=${'A'.repeat(3000)}`])
    const full = [
      ...oggPage(7, 0x02, lacesOf(vorbisId.length), vorbisId),
      ...oggPage(7, 0, lacesOf(comment.length), comment),
    ]
    expect(readAudioTags(Uint8Array.from(full.slice(0, 200)))).toEqual({
      title: 'Alpha',
      artist: 'Beta',
      bytesNeeded: 256 * 1024,
    })
  })

  it('长度字段越界、页不前进的坏文件：直接停，不抛', () => {
    const page1 = oggPage(7, 0x02, lacesOf(vorbisId.length), vorbisId)
    const hugeVendor = [0x03, ...bytesOf('vorbis'), 0xff, 0xff, 0xff, 0xff, 0x01]
    const hugeCount = [0x03, ...bytesOf('vorbis'), ...u32le(0), 0xff, 0xff, 0xff, 0xff]
    const hugeField = [0x03, ...bytesOf('vorbis'), ...u32le(0), ...u32le(1), 0xf0, 0xff, 0xff, 0xff, ...bytesOf('TITLE=x')]
    for (const packet of [hugeVendor, hugeCount, hugeField]) {
      const data = Uint8Array.from([...page1, ...oggPage(7, 0, lacesOf(packet.length), packet)])
      expect(readAudioTags(data)).toEqual({})
    }
    // 分段表说有 255 段，缓冲区在表中间就完了
    expect(readAudioTags(Uint8Array.from([...bytesOf('OggS'), 0, 2, ...new Array(20).fill(0), 255, 255, 255]))).toEqual({})
    // 一串空页，没有一条认得的流
    const empty = new Array(500).fill(oggPage(1, 0, [], [])).flat()
    expect(readAudioTags(Uint8Array.from(empty))).toEqual({})
    // 分段长度指到缓冲区外面
    const lying = [...page1, ...bytesOf('OggS'), 0, 0, ...new Array(8).fill(0), ...u32le(7), ...new Array(8).fill(0), 1, 200, 0x03]
    expect(() => readAudioTags(Uint8Array.from(lying))).not.toThrow()
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
