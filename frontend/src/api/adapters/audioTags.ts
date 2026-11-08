/**
 * 从音频文件开头的标签，或从文件名，读出歌名、歌手、专辑。
 * 只看文件最前面的一段，不用把整首歌下载下来。
 */

export interface AudioTags {
  title?: string
  artist?: string
  album?: string
  track?: number
  /** 标签比这次拿到的字节更长，调用方可以按这个长度再读一次 */
  bytesNeeded?: number
}

const MAX_TAG_BYTES = 256 * 1024

export function readAudioTags(data: Uint8Array): AudioTags {
  if (data.length >= 10 && ascii(data, 0, 3) === 'ID3') return readId3v2(data)
  if (data.length >= 4 && ascii(data, 0, 4) === 'fLaC') return readFlac(data)
  if (data.length >= 12 && ascii(data, 0, 4) === 'RIFF' && ascii(data, 8, 4) === 'WAVE') return readWav(data)
  return {}
}

/** 「01 歌手 - 专辑 - 歌名」或「歌手 - 歌名」。拆不开就只当歌名。 */
export function parseAudioFilename(filename: string): { title: string; artist?: string; album?: string; track?: number } {
  const base = filename.replace(/\.[^.]+$/, '').trim()
  let track: number | undefined
  let rest = base
  const trackMatch = /^(\d{1,3})[\s._-]+(.+)$/.exec(base)
  if (trackMatch) {
    const value = Number(trackMatch[1])
    if (value > 0 && value < 1000) {
      track = value
      rest = trackMatch[2].trim()
    }
  }
  const parts = rest.split(/\s+[-–—－]\s+/).map(part => part.trim()).filter(Boolean)
  if (parts.length >= 3) {
    return { artist: parts[0], album: parts[1], title: parts.slice(2).join(' - '), track }
  }
  if (parts.length === 2) return { artist: parts[0], title: parts[1], track }
  return { title: rest || base, track }
}

function readId3v2(data: Uint8Array): AudioTags {
  const version = data[3]
  const tagSize = synchsafe(data[6], data[7], data[8], data[9])
  const total = 10 + tagSize
  if (data.length < total) {
    return { ...readId3Frames(data.subarray(10), version), bytesNeeded: Math.min(total, MAX_TAG_BYTES) }
  }
  return readId3Frames(data.subarray(10, total), version)
}

function readId3Frames(data: Uint8Array, version: number): AudioTags {
  const tags: AudioTags = {}
  let offset = 0
  const idLen = version === 2 ? 3 : 4
  const sizeLen = version === 2 ? 3 : 4
  const headerLen = idLen + sizeLen + (version === 2 ? 0 : 2)
  while (offset + headerLen <= data.length) {
    const id = ascii(data, offset, idLen)
    if (!/^[A-Z0-9]{3,4}$/.test(id)) break
    const size = version === 4
      ? synchsafe(data[offset + 4], data[offset + 5], data[offset + 6], data[offset + 7])
      : version === 2
        ? (data[offset + 3] << 16) | (data[offset + 4] << 8) | data[offset + 5]
        : u32(data, offset + 4)
    const body = offset + headerLen
    if (size <= 0 || body + size > data.length) break
    const key = frameKey(id)
    if (key && tags[key] === undefined) {
      const text = decodeText(data.subarray(body, body + size))
      if (key === 'track') tags.track = trackNumber(text)
      else if (text) tags[key] = text
    }
    offset = body + size
  }
  return tags
}

function frameKey(id: string): 'title' | 'artist' | 'album' | 'track' | null {
  if (id === 'TIT2' || id === 'TT2') return 'title'
  if (id === 'TPE1' || id === 'TP1') return 'artist'
  if (id === 'TALB' || id === 'TAL') return 'album'
  if (id === 'TRCK' || id === 'TRK') return 'track'
  return null
}

function readFlac(data: Uint8Array): AudioTags {
  const tags: AudioTags = {}
  let offset = 4
  while (offset + 4 <= data.length) {
    const header = data[offset]
    const type = header & 0x7f
    const length = (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]
    const body = offset + 4
    if (body + length > data.length) {
      return { ...tags, bytesNeeded: Math.min(body + length, MAX_TAG_BYTES) }
    }
    if (type === 4) Object.assign(tags, readVorbisComment(data.subarray(body, body + length)))
    offset = body + length
    if (header & 0x80) break
  }
  return tags
}

function readVorbisComment(data: Uint8Array): AudioTags {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  if (data.length < 8) return {}
  const vendorLength = view.getUint32(0, true)
  let offset = 4 + vendorLength
  if (offset + 4 > data.length) return {}
  const count = view.getUint32(offset, true)
  offset += 4
  const tags: AudioTags = {}
  for (let i = 0; i < count && offset + 4 <= data.length; i++) {
    const length = view.getUint32(offset, true)
    offset += 4
    if (offset + length > data.length) break
    const pair = decodeTagBytes(data.subarray(offset, offset + length)).replace(/\0/g, '')
    offset += length
    const eq = pair.indexOf('=')
    if (eq <= 0) continue
    const key = pair.slice(0, eq).trim().toUpperCase()
    const value = pair.slice(eq + 1).trim()
    if (!value) continue
    if ((key === 'TITLE') && !tags.title) tags.title = value
    if (key === 'ARTIST' && value) tags.artist = value
    if (key === 'ALBUMARTIST' && !tags.artist) tags.artist = value
    if (key === 'ALBUM' && !tags.album) tags.album = value
    if ((key === 'TRACKNUMBER' || key === 'TRACK') && tags.track === undefined) tags.track = trackNumber(value)
  }
  return tags
}

function readWav(data: Uint8Array): AudioTags {
  const tags: AudioTags = {}
  let offset = 12
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  while (offset + 8 <= data.length) {
    const id = ascii(data, offset, 4)
    const size = view.getUint32(offset + 4, true)
    const body = offset + 8
    if (id === 'data') break
    if (body + size > data.length) return { ...tags, bytesNeeded: Math.min(body + size, MAX_TAG_BYTES) }
    if (id === 'LIST' && size >= 4 && ascii(data, body, 4) === 'INFO') {
      Object.assign(tags, readWavInfo(data.subarray(body + 4, body + size)))
    } else if (id.toLowerCase() === 'id3 ') {
      Object.assign(tags, readAudioTags(data.subarray(body, body + size)))
    }
    offset = body + size + (size % 2)
  }
  return tags
}

function readWavInfo(data: Uint8Array): AudioTags {
  const tags: AudioTags = {}
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let offset = 0
  while (offset + 8 <= data.length) {
    const id = ascii(data, offset, 4)
    const size = view.getUint32(offset + 4, true)
    const body = offset + 8
    if (body + size > data.length) break
    const text = decodeTagBytes(data.subarray(body, body + size)).replace(/\0/g, '').trim()
    if (id === 'INAM' && text) tags.title = text
    if (id === 'IART' && text) tags.artist = text
    if (id === 'IPRD' && text) tags.album = text
    if (id === 'ITRK' && text) tags.track = trackNumber(text)
    offset = body + size + (size % 2)
  }
  return tags
}

function decodeText(frame: Uint8Array): string {
  if (!frame.length) return ''
  const encoding = frame[0]
  const bytes = frame.subarray(1)
  let text = ''
  if (encoding === 0) text = decodeLatinOrGbk(bytes)
  else if (encoding === 1 || encoding === 2) text = decodeUtf16(bytes, encoding === 2)
  else text = decodeTagBytes(bytes)
  return text.replace(/\0/g, '').trim()
}

/** 带 BOM 的 UTF-16 以 BOM 为准。不少文件标成 BE，实际却是 LE。 */
function decodeUtf16(bytes: Uint8Array, preferBe: boolean): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  }
  return new TextDecoder(preferBe ? 'utf-16be' : 'utf-16le').decode(bytes)
}

function decodeLatinOrGbk(bytes: Uint8Array): string {
  const hasHigh = bytes.some(byte => byte >= 0x80)
  if (!hasHigh) return new TextDecoder('iso-8859-1').decode(bytes)
  try {
    return new TextDecoder('gb18030').decode(bytes)
  } catch {
    return new TextDecoder('iso-8859-1').decode(bytes)
  }
}

function decodeTagBytes(bytes: Uint8Array): string {
  if (bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))) {
    return decodeUtf16(bytes, false)
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    try {
      return new TextDecoder('gb18030').decode(bytes)
    } catch {
      return new TextDecoder('utf-8').decode(bytes)
    }
  }
}

function trackNumber(value: string): number | undefined {
  const match = /^(\d+)/.exec(value.trim())
  if (!match) return undefined
  const track = Number(match[1])
  return track > 0 && track < 1000 ? track : undefined
}

function synchsafe(b0: number, b1: number, b2: number, b3: number): number {
  return ((b0 & 0x7f) << 21) | ((b1 & 0x7f) << 14) | ((b2 & 0x7f) << 7) | (b3 & 0x7f)
}

function u32(data: Uint8Array, offset: number): number {
  return (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]
}

function ascii(data: Uint8Array, offset: number, length: number): string {
  let out = ''
  for (let i = 0; i < length && offset + i < data.length; i++) out += String.fromCharCode(data[offset + i])
  return out
}
