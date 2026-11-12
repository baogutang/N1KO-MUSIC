/**
 * 从音频文件开头的标签，或从文件名，读出歌名、歌手、专辑和时长。
 * 只看文件最前面的一段，不用把整首歌下载下来。
 */

export interface AudioTags {
  title?: string
  artist?: string
  /** 专辑歌手（ID3 的 TPE2、Vorbis 的 ALBUMARTIST、MP4 的 aART）。合辑靠它归成一张。 */
  albumArtist?: string
  album?: string
  track?: number
  /** 时长（秒）。算不出来就不填，播放时由播放器补上。 */
  duration?: number
  /** 标签比这次拿到的字节更长，调用方可以按这个长度再读一次 */
  bytesNeeded?: number
}

export interface AudioTagOptions {
  /** 整个文件的字节数（PROPFIND 给的）。固定码率的 MP3 靠它估时长。 */
  fileSize?: number
}

const MAX_TAG_BYTES = 256 * 1024
/** MP3 标签后面还要看第一帧（和里面的 Xing / VBRI 头）才知道时长 */
const FRAME_PROBE = 4096

export function readAudioTags(data: Uint8Array, options: AudioTagOptions = {}): AudioTags {
  if (data.length >= 10 && ascii(data, 0, 3) === 'ID3') return readId3v2(data, options)
  if (data.length >= 4 && ascii(data, 0, 4) === 'fLaC') return readFlac(data)
  if (data.length >= 4 && ascii(data, 0, 4) === 'OggS') return readOgg(data)
  if (data.length >= 12 && ascii(data, 0, 4) === 'RIFF' && ascii(data, 8, 4) === 'WAVE') return readWav(data)
  if (data.length >= 8 && ascii(data, 4, 4) === 'ftyp') return readMp4(data)
  // 没有 ID3 的 MP3 开头直接就是帧。别的格式不去猜，免得把随机字节当成帧头。
  if (data.length >= 4 && data[0] === 0xff && (data[1] & 0xe0) === 0xe0) {
    const duration = mp3Duration(data, 0, options.fileSize)
    return duration ? { duration } : {}
  }
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

function readId3v2(data: Uint8Array, options: AudioTagOptions): AudioTags {
  const version = data[3]
  const flags = data[5]
  const tagSize = synchsafe(data[6], data[7], data[8], data[9])
  // 带脚注（v2.4 的 0x10）时标签后面还有 10 字节
  const total = 10 + tagSize + (flags & 0x10 ? 10 : 0)
  let frames = data.subarray(10, Math.min(data.length, 10 + tagSize))
  // 扩展头：v2.3 的长度不含自己那 4 字节，v2.4 的含
  if (flags & 0x40 && frames.length >= 4) {
    const extended = version === 4 ? synchsafe(frames[0], frames[1], frames[2], frames[3]) : u32(frames, 0) + 4
    frames = frames.subarray(Math.min(extended, frames.length))
  }
  const tags = readId3Frames(frames, version)
  // 时长要看标签后面的第一帧，所以多要一点。标签太大（内嵌了大封面）读不到也没关系，TLEN 或播放器会补上。
  if (data.length < total) return { ...tags, bytesNeeded: Math.min(total + FRAME_PROBE, MAX_TAG_BYTES) }
  // 有的转换工具会在 FLAC 前面挂一段 ID3。真正的标签和时长在后面的 FLAC 元数据里，以它为准。
  if (data.length >= total + 4 && ascii(data, total, 4) === 'fLaC') {
    const { bytesNeeded, ...flac } = readFlac(data.subarray(total))
    const merged: AudioTags = { ...tags, ...flac }
    const need = bytesNeeded ? Math.min(total + bytesNeeded, MAX_TAG_BYTES) : 0
    if (need > data.length) merged.bytesNeeded = need
    return merged
  }
  if (tags.duration === undefined) {
    const audioBytes = options.fileSize ? options.fileSize - total : undefined
    const duration = mp3Duration(data, total, audioBytes)
    if (duration) tags.duration = duration
    else if (data.length < total + FRAME_PROBE && total + FRAME_PROBE <= MAX_TAG_BYTES) tags.bytesNeeded = total + FRAME_PROBE
  }
  return tags
}

type Id3Key = 'title' | 'artist' | 'albumArtist' | 'album' | 'track' | 'length'

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
    if (key) {
      const text = decodeText(data.subarray(body, body + size))
      if (key === 'track') {
        if (tags.track === undefined) tags.track = trackNumber(text)
      } else if (key === 'length') {
        const ms = Number(text)
        if (tags.duration === undefined && Number.isFinite(ms) && ms > 0) tags.duration = ms / 1000
      } else if (text && tags[key] === undefined) {
        tags[key] = text
      }
    }
    offset = body + size
  }
  return tags
}

function frameKey(id: string): Id3Key | null {
  if (id === 'TIT2' || id === 'TT2') return 'title'
  if (id === 'TPE1' || id === 'TP1') return 'artist'
  if (id === 'TPE2' || id === 'TP2') return 'albumArtist'
  if (id === 'TALB' || id === 'TAL') return 'album'
  if (id === 'TRCK' || id === 'TRK') return 'track'
  if (id === 'TLEN' || id === 'TLE') return 'length'
  return null
}

const MP3_BITRATES: Record<string, number[]> = {
  // MPEG-1 Layer I / II / III，MPEG-2/2.5 Layer I / II&III（kbps，下标是码率索引）
  '1-1': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  '1-2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  '1-3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  '2-1': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  '2-2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
}
const MP3_RATES: Record<number, number[]> = {
  1: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  25: [11025, 12000, 8000],
}

/**
 * 从第一帧算 MP3 时长：有 Xing / Info / VBRI 头就按总帧数算（变码率也准），
 * 否则按固定码率用文件大小估。audioBytes 是标签之后的字节数。
 */
function mp3Duration(data: Uint8Array, from: number, audioBytes?: number): number | undefined {
  const end = Math.min(data.length - 4, from + FRAME_PROBE)
  for (let i = from; i < end; i++) {
    if (data[i] !== 0xff || (data[i + 1] & 0xe0) !== 0xe0) continue
    const versionBits = (data[i + 1] >> 3) & 3
    const layerBits = (data[i + 1] >> 1) & 3
    const bitrateIndex = data[i + 2] >> 4
    const rateIndex = (data[i + 2] >> 2) & 3
    if (versionBits === 1 || layerBits === 0 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) continue
    const version = versionBits === 3 ? 1 : versionBits === 2 ? 2 : 25
    const layer = 4 - layerBits
    const sampleRate = MP3_RATES[version][rateIndex]
    const table = version === 1 ? `1-${layer}` : layer === 1 ? '2-1' : '2-2'
    const bitrate = MP3_BITRATES[table][bitrateIndex]
    const mono = (data[i + 3] >> 6) === 3
    const samplesPerFrame = layer === 1 ? 384 : layer === 3 && version !== 1 ? 576 : 1152

    const xingAt = i + 4 + (version === 1 ? (mono ? 17 : 32) : (mono ? 9 : 17))
    // 帧头后面的字节还没读到，先别按固定码率估（变码率文件会估错），让调用方多读一点
    if (i + 4 + 32 + 18 > data.length) return undefined
    const xingTag = ascii(data, xingAt, 4)
    if ((xingTag === 'Xing' || xingTag === 'Info') && xingAt + 12 <= data.length) {
      const flags = u32(data, xingAt + 4)
      if (flags & 1) {
        const frames = u32(data, xingAt + 8) >>> 0
        if (frames > 0) return (frames * samplesPerFrame) / sampleRate
      }
    }
    const vbriAt = i + 4 + 32
    if (ascii(data, vbriAt, 4) === 'VBRI' && vbriAt + 18 <= data.length) {
      const frames = u32(data, vbriAt + 14) >>> 0
      if (frames > 0) return (frames * samplesPerFrame) / sampleRate
    }
    if (audioBytes && audioBytes > 0 && bitrate > 0) return (audioBytes * 8) / (bitrate * 1000)
    return undefined
  }
  return undefined
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
    if (type === 0 && length >= 18) {
      // STREAMINFO：采样率 20 位，总采样数 36 位
      const sampleRate = (data[body + 10] << 12) | (data[body + 11] << 4) | (data[body + 12] >> 4)
      const samples = (data[body + 13] & 0x0f) * 2 ** 32 + (u32(data, body + 14) >>> 0)
      if (sampleRate > 0 && samples > 0) tags.duration = samples / sampleRate
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
    // 同一个键写了多次（多位歌手）时取第一个
    if (key === 'TITLE' && !tags.title) tags.title = value
    if (key === 'ARTIST' && !tags.artist) tags.artist = value
    if ((key === 'ALBUMARTIST' || key === 'ALBUM ARTIST') && !tags.albumArtist) tags.albumArtist = value
    if (key === 'ALBUM' && !tags.album) tags.album = value
    if ((key === 'TRACKNUMBER' || key === 'TRACK') && tags.track === undefined) tags.track = trackNumber(value)
  }
  // 只写了专辑歌手的文件，歌手也用它
  if (!tags.artist && tags.albumArtist) tags.artist = tags.albumArtist
  return tags
}

/**
 * Ogg Vorbis / Opus：标签在这条流的第二个包里（Vorbis 的「\x03vorbis」注释包、Opus 的「OpusTags」），
 * 内容和 FLAC 的 VORBIS_COMMENT 同一个格式。包按每页的分段表拼：分段长 255 表示包还没完，可能接到下一页。
 * 时长要看最后一页的 granule position，在文件末尾，只读开头拿不到，留给播放器补。
 */
function readOgg(data: Uint8Array): AudioTags {
  const packets: Uint8Array[] = []
  let pending: Uint8Array[] = []
  let serial: number | undefined
  let codec: 'vorbis' | 'opus' | undefined
  let truncated = false
  let offset = 0
  while (packets.length < 2) {
    if (offset + 27 > data.length) {
      truncated = true
      break
    }
    if (ascii(data, offset, 4) !== 'OggS') break
    const segments = data[offset + 26]
    const bodyStart = offset + 27 + segments
    if (bodyStart > data.length) {
      truncated = true
      break
    }
    let bodyLength = 0
    for (let i = 0; i < segments; i++) bodyLength += data[offset + 27 + i]
    const pageSerial = u32le(data, offset + 14)
    // 认准第一条 Vorbis / Opus 流：前面可能还有 Skeleton 之类别的流，它们的页跳过
    if (serial === undefined && !(data[offset + 5] & 0x01)) {
      codec = oggCodec(data.subarray(bodyStart, Math.min(bodyStart + 8, data.length)))
      if (codec) serial = pageSerial
    }
    if (serial !== undefined && pageSerial === serial) {
      let at = bodyStart
      for (let i = 0; i < segments && packets.length < 2; i++) {
        const lace = data[offset + 27 + i]
        if (at + lace > data.length) {
          pending.push(data.subarray(at))
          truncated = true
          break
        }
        pending.push(data.subarray(at, at + lace))
        at += lace
        if (lace < 255) {
          packets.push(concatBytes(pending))
          pending = []
        }
      }
      if (truncated) break
    }
    // 每页至少 27 字节，offset 一定往前走
    offset = bodyStart + bodyLength
  }
  if (!codec) return {}
  // 注释包没读全（多半是里面塞了封面图）：先解出读到的那部分，再告诉调用方多读一些
  const comment = packets[1] ?? (packets.length === 1 && pending.length ? concatBytes(pending) : undefined)
  const prefix = codec === 'vorbis' ? '\x03vorbis' : 'OpusTags'
  const tags = comment && ascii(comment, 0, prefix.length) === prefix
    ? readVorbisComment(comment.subarray(prefix.length))
    : {}
  if (!packets[1] && truncated && data.length < MAX_TAG_BYTES) return { ...tags, bytesNeeded: MAX_TAG_BYTES }
  return tags
}

function oggCodec(head: Uint8Array): 'vorbis' | 'opus' | undefined {
  if (ascii(head, 0, 7) === '\x01vorbis') return 'vorbis'
  if (ascii(head, 0, 8) === 'OpusHead') return 'opus'
  return undefined
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 1) return chunks[0]
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0))
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}

function readWav(data: Uint8Array): AudioTags {
  const tags: AudioTags = {}
  let offset = 12
  let byteRate = 0
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  while (offset + 8 <= data.length) {
    const id = ascii(data, offset, 4)
    const size = view.getUint32(offset + 4, true)
    const body = offset + 8
    if (id === 'data') {
      if (byteRate > 0 && size > 0) tags.duration = size / byteRate
      break
    }
    if (body + size > data.length) return { ...tags, bytesNeeded: Math.min(body + size + 8, MAX_TAG_BYTES) }
    if (id === 'fmt ' && size >= 12) {
      byteRate = view.getUint32(body + 8, true)
    } else if (id === 'LIST' && size >= 4 && ascii(data, body, 4) === 'INFO') {
      Object.assign(tags, readWavInfo(data.subarray(body + 4, body + size)))
    } else if (id.toLowerCase() === 'id3 ') {
      const { duration: _ignored, bytesNeeded: _alsoIgnored, ...id3 } = readAudioTags(data.subarray(body, body + size))
      Object.assign(tags, id3)
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

/** MP4 容器的盒子里，这几层要往下钻才能走到标签和时长 */
const MP4_CONTAINERS = new Set(['moov', 'udta', 'meta', 'ilst'])

/**
 * M4A / ALAC：moov 里的 mvhd 有时长，moov/udta/meta/ilst 里是标签。
 * moov 放在文件末尾（没做 faststart）时，开头读不到，交给文件名和播放器。
 */
function readMp4(data: Uint8Array): AudioTags {
  const tags: AudioTags = {}
  /** 返回值是还要从文件开头读到第几个字节；undefined 表示够了或者读不到了 */
  const walk = (from: number, to: number, top: boolean): number | undefined => {
    let offset = from
    while (offset + 8 <= to) {
      let size = u32(data, offset) >>> 0
      const type = ascii(data, offset + 4, 4)
      let header = 8
      if (size === 1 && offset + 16 <= to) {
        size = (u32(data, offset + 8) >>> 0) * 2 ** 32 + (u32(data, offset + 12) >>> 0)
        header = 16
      } else if (size === 0) {
        size = to - offset
      }
      if (size < header) return undefined
      const end = offset + size
      // moov 排在音频数据后面：要读到文件末尾才有，放弃
      if (type === 'mdat' && top) return undefined
      if (MP4_CONTAINERS.has(type)) {
        // meta 是「完整盒」，子盒前面还有 4 字节版本和标志
        const needed = walk(offset + header + (type === 'meta' ? 4 : 0), Math.min(end, to), false)
        if (needed) return needed
        if (end > to) return end <= MAX_TAG_BYTES ? end : undefined
      } else if (end > to) {
        return end <= MAX_TAG_BYTES ? end : undefined
      } else if (type === 'mvhd') {
        const version = data[offset + header]
        const at = offset + header + (version === 1 ? 20 : 12)
        const timescale = u32(data, at) >>> 0
        const duration = version === 1
          ? (u32(data, at + 4) >>> 0) * 2 ** 32 + (u32(data, at + 8) >>> 0)
          : u32(data, at + 4) >>> 0
        if (timescale > 0 && duration > 0) tags.duration = duration / timescale
      } else {
        readMp4Item(type, data.subarray(offset + header, end), tags)
      }
      offset = end
    }
    return undefined
  }
  const needed = walk(0, data.length, true)
  return needed && needed > data.length ? { ...tags, bytesNeeded: needed } : tags
}

function readMp4Item(type: string, body: Uint8Array, tags: AudioTags): void {
  const key = type === '©nam' ? 'title'
    : type === '©ART' ? 'artist'
      : type === 'aART' ? 'albumArtist'
        : type === '©alb' ? 'album'
          : type === 'trkn' ? 'track'
            : null
  if (!key || body.length < 16 || ascii(body, 4, 4) !== 'data') return
  const payload = body.subarray(16, Math.min(body.length, u32(body, 0) >>> 0))
  if (key === 'track') {
    if (payload.length >= 4 && tags.track === undefined) {
      const track = (payload[2] << 8) | payload[3]
      if (track > 0 && track < 1000) tags.track = track
    }
    return
  }
  const text = new TextDecoder('utf-8').decode(payload).replace(/\0/g, '').trim()
  if (text && tags[key] === undefined) tags[key] = text
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

/**
 * ID3 编码 0 按规范是 ISO-8859-1，可不少中文 MP3 里写的其实是 GBK，也有工具写成 UTF-8。
 * 以前带高位字节的一律按 GBK 解，西文的 Björk、Café 就成了乱码。现在依次看：
 * 1. 合法的 UTF-8，而且读出来像真文字 → UTF-8。只看合不合法不够：GBK 的「小」(D0 A1) 恰好也是
 *    合法的 UTF-8（西里尔字母 С），所以两字节的只认夹在 ASCII 字母里的拉丁字母。
 * 2. 按 GBK 两个字节一组走一遍，比高位字节的形态：汉字是成对的高位字节；拉丁文的重音字母是夹在
 *    ASCII 字母中间的单个高位字节，按 GBK 读会和后面的 ASCII 凑成一个字（Björk 的 ö+r），
 *    或在结尾、空格前凑不成字（Café）。凑不成 GBK 的直接按拉丁文，拉丁文的迹象比汉字多也按拉丁文。
 */
function decodeLatinOrGbk(bytes: Uint8Array): string {
  const latin1 = () => new TextDecoder('iso-8859-1').decode(bytes)
  if (!bytes.some(byte => byte >= 0x80)) return latin1()
  const utf8 = strictUtf8(bytes)
  if (utf8 !== null && looksLikeUtf8Text(utf8)) return utf8
  if (gbkOrLatin(bytes) === 'latin1') return latin1()
  try {
    return new TextDecoder('gb18030').decode(bytes)
  } catch {
    return latin1()
  }
}

function strictUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

function looksLikeUtf8Text(text: string): boolean {
  let latinLetter = false
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (code < 0x80) continue
    // 三字节以上（中日韩文字之类）：GBK 几乎凑不出这么规整的序列
    if (code >= 0x800) return true
    // À–ɏ 里的字母（去掉 × ÷）
    if (code >= 0xc0 && code <= 0x24f && code !== 0xd7 && code !== 0xf7) {
      latinLetter = true
      continue
    }
    // 0x80–0xBF 的符号、西里尔 / 希腊 / 阿拉伯字母：多半是 GBK 汉字碰巧撞成的
    return false
  }
  return latinLetter && /[A-Za-z]/.test(text)
}

function gbkOrLatin(bytes: Uint8Array): 'gbk' | 'latin1' {
  const isLetter = (byte: number | undefined) =>
    byte !== undefined && ((byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a))
  let gbk = 0
  let latin = 0
  for (let i = 0; i < bytes.length;) {
    const lead = bytes[i]
    if (lead < 0x80) {
      i += 1
      continue
    }
    const trail = bytes[i + 1]
    // 0x80 / 0xFF 当不了首字节；落在结尾，或后面跟空格、标点、数字的，凑不成 GBK 的字
    // （GB18030 的四字节字在 GBK 年代写的标签里见不到）
    if (lead === 0x80 || lead === 0xff || trail === undefined || trail < 0x40 || trail === 0x7f || trail === 0xff) {
      return 'latin1'
    }
    if (trail < 0x80) {
      // 吞掉了后面的 ASCII（ö+r）：GBK 的扩展区确实有这种字，但远不如拉丁文常见
      latin += 1
    } else if (lead >= 0xa1 && trail >= 0xa1) {
      // 两个字节都在 GB2312 区：像汉字；可被 ASCII 字母前后夹着的一对更像两个连着的重音字母（Größe 的 öß）
      if (isLetter(bytes[i - 1]) && isLetter(bytes[i + 2])) latin += 1
      else gbk += 1
    }
    i += 2
  }
  return latin > gbk ? 'latin1' : 'gbk'
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

function u32le(data: Uint8Array, offset: number): number {
  return (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0
}

function ascii(data: Uint8Array, offset: number, length: number): string {
  let out = ''
  for (let i = 0; i < length && offset + i < data.length; i++) out += String.fromCharCode(data[offset + i])
  return out
}
