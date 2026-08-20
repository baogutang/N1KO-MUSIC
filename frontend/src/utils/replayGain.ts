/**
 * ReplayGain 音量归一化。
 *
 * 服务器（Navidrome / OpenSubsonic / Jellyfin）早就把每首歌的增益算好并随响应返回，
 * 客户端此前一律丢弃。结果是七十年代的母带和响度战争之后的母带混在同一个随机队列里，
 * 响度能差 8dB —— 这是「随机播放听起来很难受」里最容易被误判成别的问题的一条。
 *
 * 刻意不引入 Web Audio：useAudioEngine 顶部记录了不使用 AudioContext 的决定
 * （涉及移动端后台播放与内存占用）。ReplayGain 本身只是一个标量增益，
 * 直接乘在 HTMLAudioElement.volume 上即可，不需要音频图。
 */

import type { Song } from '@/api/types'

export type ReplayGainMode = 'off' | 'track' | 'album' | 'auto'

/** 服务器没给增益时的兜底衰减（dB）。0 表示不处理。 */
export const DEFAULT_FALLBACK_GAIN_DB = 0

/** 前置增益上下限（dB），避免用户把自己震聋或调到听不见 */
export const PREAMP_MIN_DB = -15
export const PREAMP_MAX_DB = 15

function dbToLinear(db: number): number {
  return Math.pow(10, db / 20)
}

interface GainContext {
  /** 是否正在按专辑顺序播放。auto 模式据此在 album/track 增益之间选择 */
  albumContext: boolean
  mode: ReplayGainMode
  preampDb: number
}

/**
 * 计算应当乘在 volume 上的线性系数。
 *
 * 返回 1 表示不做任何处理。始终做削波保护：服务器给了 peak 时，
 * 增益不得把峰值推过 1.0，否则响亮的曲目会削顶失真。
 */
export function computeReplayGainScalar(song: Song | null, ctx: GainContext): number {
  if (!song || ctx.mode === 'off') return 1

  const rg = song.ext?.replayGain
  const trackGain = rg?.trackGain
  const albumGain = rg?.albumGain

  // auto：顺序放整张专辑时用 album gain（保住专辑内部的动态关系），
  // 随机播放时用 track gain（每首各自归一化才有意义）
  const preferAlbum = ctx.mode === 'album' || (ctx.mode === 'auto' && ctx.albumContext)

  let gainDb: number | undefined
  if (preferAlbum) gainDb = albumGain ?? trackGain
  else gainDb = trackGain ?? albumGain

  if (gainDb === undefined) {
    const fallback = rg?.fallbackGain ?? DEFAULT_FALLBACK_GAIN_DB
    if (!fallback) return 1
    gainDb = fallback
  }

  const preamp = Math.max(PREAMP_MIN_DB, Math.min(PREAMP_MAX_DB, ctx.preampDb || 0))
  let scalar = dbToLinear(gainDb + preamp)

  // 削波保护
  const peak = preferAlbum ? (rg?.albumPeak ?? rg?.trackPeak) : (rg?.trackPeak ?? rg?.albumPeak)
  if (peak && peak > 0 && scalar * peak > 1) {
    scalar = 1 / peak
  }

  // volume 是 [0,1]，放大超过 1 无法表达；这里只做衰减，
  // 需要提升时靠用户把主音量开大，避免静默失真。
  return Math.max(0, Math.min(1, scalar))
}

/** 当前曲目是否有可用的 ReplayGain 数据（用于设置页显示覆盖情况） */
export function hasReplayGainData(song: Song | null): boolean {
  const rg = song?.ext?.replayGain
  return !!(rg && (rg.trackGain !== undefined || rg.albumGain !== undefined))
}
