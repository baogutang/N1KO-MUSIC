/**
 * 曲目技术规格的展示格式化。
 *
 * README 把无损直通当卖点，界面上却看不到任何证据。
 * 这些字段（bitDepth / samplingRate / channelCount）服务器早就随响应返回，
 * 此前被 mapSong 丢弃；bitRate / contentType / suffix 本来就在 Song 上。
 */

import type { Song } from '@/api/types'
import type { AudioQuality } from '@/store/settingsStore'
import { QUALITY_MAX_BITRATE } from '@/store/settingsStore'

/** 从 MIME 或后缀推断展示用的编码名 */
export function formatCodec(song: Song | null): string | null {
  if (!song) return null
  const suffix = song.suffix?.toUpperCase()
  if (suffix) return suffix
  const type = song.contentType
  if (!type) return null
  const tail = type.split('/')[1]?.toUpperCase()
  if (!tail) return null
  return tail.replace('X-', '').replace('MPEG', 'MP3')
}

export function formatSampleRate(hz?: number): string | null {
  if (!hz || hz <= 0) return null
  const khz = hz / 1000
  return `${Number.isInteger(khz) ? khz : khz.toFixed(1)}kHz`
}

export function formatChannels(count?: number): string | null {
  if (!count || count <= 0) return null
  if (count === 1) return '单声道'
  if (count === 2) return '2ch'
  return `${count}ch`
}

/**
 * 本次播放是直通原始文件还是被服务器转码。
 * 无损档位（maxBitRate = 0）请求原始文件，其余档位一律是转码流。
 */
export function isPassthrough(quality: AudioQuality): boolean {
  return QUALITY_MAX_BITRATE[quality] === 0
}

/** 组装成一行等宽小字，如 `24bit · 96kHz · FLAC · 2ch · 1411kbps` */
export function buildSpecLine(song: Song | null): string[] {
  if (!song) return []
  const parts: string[] = []
  if (song.ext?.bitDepth) parts.push(`${song.ext.bitDepth}bit`)
  const rate = formatSampleRate(song.ext?.samplingRate)
  if (rate) parts.push(rate)
  const codec = formatCodec(song)
  if (codec) parts.push(codec)
  const channels = formatChannels(song.ext?.channelCount)
  if (channels) parts.push(channels)
  if (song.bitRate) parts.push(`${song.bitRate}kbps`)
  return parts
}
