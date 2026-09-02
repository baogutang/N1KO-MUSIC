/**
 * useAudioEngine 的纯判定逻辑。
 *
 * 这些规则都是靠不住的流媒体元数据逼出来的经验值（duration 为 Infinity、
 * 提前 ended、缓冲尾部停滞……），单独放出来才能脱离 <audio> 事件流验证。
 */

/** 一次 timeupdate 之间最多承认的前进秒数，超过即视为用户拖动进度条 */
const MAX_LISTEN_DELTA_SEC = 2
/** 播放进度占比达到此比例即算「已到结尾」*/
const NEAR_END_RATIO = 0.97

/**
 * 拼装音频加载 key，格式为 `serverId:songId@quality@playVersion`。
 * playVersion 参与其中，保证「重播同一首歌」也会被识别为一次新的加载。
 */
export function buildLoadedKey(
  serverId: string,
  songId: string,
  quality: string,
  playVersion: number
): string {
  return `${serverId}:${songId}@${quality}@${playVersion}`
}

/**
 * 流地址缓存的 key：与 buildLoadedKey 同构但**不含 playVersion**——
 * 重播同一首歌不必重取仍然新鲜的流地址（插件音源的地址取一次是一次请求）。
 */
export function buildStreamCacheKey(serverId: string, songId: string, quality: string): string {
  return `${serverId}:${songId}@${quality}`
}

/**
 * 一次已解析的流地址。expiresAt 在解析时就补齐默认值（缺省按 20 分钟，
 * PROTOCOL §5.4），过期判断因此只需看一个字段。
 */
export interface ResolvedStream {
  url: string
  /** 毫秒时间戳；此后地址视作过期，播放前必须重取 */
  expiresAt: number
  /** 解析时刻，诊断用 */
  resolvedAt: number
  /** 来自适配器的异步 resolveStreamUrl（插件音源）；false 为同步拼 URL 的 NAS 直链 */
  async: boolean
}

/** PROTOCOL §5.4：取流结果未带 expiresAt 时按 20 分钟处理 */
export const DEFAULT_STREAM_TTL_MS = 20 * 60 * 1000
/** 同步直链（Subsonic 系）不会过期；给一个远超会话寿命的占位过期时间 */
export const DIRECT_STREAM_TTL_MS = 24 * 60 * 60 * 1000

/**
 * 流地址是否已过期。marginMs 是提前量：地址在「即将过期」时就应该判死——
 * 恰好压线取到的地址，等播放器真正发起请求时多半已经失效。
 */
export function isStreamExpired(expiresAt: number, now: number, marginMs = 30_000): boolean {
  return now >= expiresAt - marginMs
}

/**
 * 从适配器解析一次流地址：
 * 有 `resolveStreamUrl`（插件 / 需要签名的流）就 await；否则包一层同步的
 * `getStreamUrl`。不碰缓存——缓存策略归调用方（useAudioEngine 的模块级缓存）。
 * headers 字段协议里保留，当前播放引擎无法附加请求头，此处丢弃。
 */
export async function resolveStreamFromAdapter(
  adapter: {
    getStreamUrl: MusicServerAdapterShape['getStreamUrl']
    resolveStreamUrl?: MusicServerAdapterShape['resolveStreamUrl']
  },
  songId: string,
  opts: { maxBitrate: number; quality: 'lossless' | 'high' | 'medium' | 'low'; contentType?: string; path?: string; suffix?: string },
  now = Date.now()
): Promise<ResolvedStream> {
  if (adapter.resolveStreamUrl) {
    const r = await adapter.resolveStreamUrl(songId, { maxBitrate: opts.maxBitrate, quality: opts.quality })
    return {
      url: r.url,
      expiresAt: r.expiresAt ?? now + DEFAULT_STREAM_TTL_MS,
      resolvedAt: now,
      async: true,
    }
  }
  return {
    url: adapter.getStreamUrl(songId, opts.maxBitrate, '', opts.contentType, opts.path, opts.suffix),
    expiresAt: now + DIRECT_STREAM_TTL_MS,
    resolvedAt: now,
    async: false,
  }
}

/** 只取 resolveStream 用得到的适配器方法面（测试里好用桩替换） */
interface MusicServerAdapterShape {
  getStreamUrl: (
    songId: string,
    maxBitrate: number,
    format: string,
    contentType?: string,
    path?: string,
    suffix?: string
  ) => string
  resolveStreamUrl?: (
    songId: string,
    opts: { maxBitrate: number; quality: 'lossless' | 'high' | 'medium' | 'low' }
  ) => Promise<{ url: string; expiresAt?: number; mimeType?: string }>
}

export interface ParsedLoadedKey {
  /** `serverId:songId` 部分 */
  base: string
  quality: string
  version: string
}

/**
 * 解析加载 key。songId 自身可能含 '@'（部分服务端用路径当 id），
 * 因此必须从右侧切出 quality 与 version，左侧剩下的整体才是 base。
 */
export function parseLoadedKey(key: string): ParsedLoadedKey | null {
  const matched = /^(.+)@([^@]+)@([^@]+)$/.exec(key)
  if (!matched) return null
  return { base: matched[1], quality: matched[2], version: matched[3] }
}

/**
 * 尝试从 audio.duration 读取有效时长，返回 null 表示无法获取
 * 流媒体在未完全缓冲时 duration 为 Infinity，此时返回 null
 */
export function getFiniteDuration(audio: Pick<HTMLAudioElement, 'duration'>): number | null {
  const d = audio.duration
  if (isFinite(d) && d > 0) return d
  return null
}

/** 缓冲是否已覆盖到当前播放时间附近（后面几乎无数据）*/
export function isAtBufferedTail(
  audio: Pick<HTMLAudioElement, 'buffered'>,
  currentTime: number,
  gapSec = 0.45
): boolean {
  try {
    if (audio.buffered.length === 0) return true
    const end = audio.buffered.end(audio.buffered.length - 1)
    return end - currentTime < gapSec
  } catch {
    return true
  }
}

/**
 * 两次 timeupdate 之间应计入收听时长的秒数，不该计入时返回 0。
 * 只承认小步前进：用户拖动进度条产生的跳变（无论前后）都不是真的听过。
 */
export function accumulateListenedDelta(prevTime: number, nextTime: number): number {
  if (prevTime < 0) return 0
  const delta = nextTime - prevTime
  return delta > 0 && delta < MAX_LISTEN_DELTA_SEC ? delta : 0
}

/**
 * ended 事件是否属于「网络中断被当成播完」。
 * NAS/转码流断流时浏览器会把已收到的数据当作完整曲目，此时应保位重载而非切下一首。
 */
export function isPrematureEnd(endedAt: number, metaDuration: number): boolean {
  return (
    metaDuration >= 30 &&
    endedAt > 0 &&
    metaDuration - endedAt > 20 &&
    endedAt / metaDuration < 0.9
  )
}

/**
 * 停滞位置是否已接近曲目结尾（可安全视为自然播完）。
 * 时长不可靠时一律返回 false —— 宁可让用户手动切歌，也不能从头重播。
 */
export function isNearEndOfTrack(currentTime: number, refDuration: number): boolean {
  if (!isFinite(refDuration) || refDuration < 20) return false
  const remain = refDuration - currentTime
  return (
    (remain <= 6 && currentTime > 10) ||
    (refDuration > 60 && currentTime / refDuration >= NEAR_END_RATIO)
  )
}
