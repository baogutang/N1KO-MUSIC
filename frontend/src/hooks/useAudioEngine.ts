/**
 * 音频引擎 - 原生 HTML5 Audio 实现
 *
 * 使用原生 <audio> 元素替代 Howler.js html5 模式，
 * 不设置 crossOrigin 属性，直接播放无 CORS 头的远程流媒体
 *
 * 主要修复：
 * 1. duration 延迟问题：流媒体场景下 loadedmetadata 时 duration 可能为 Infinity，
 *    通过多个事件（durationchange / canplaythrough / seeking / seeked）补偿更新，
 *    同时 fallback 到 song.duration（服务器返回的元数据）
 * 2. 切歌后播放卡住：不再依赖 canPlayFired flag，改为在 canplay/canplaythrough
 *    回调中始终根据当前 store 状态决定是否 play()，避免旧 flag 状态污染
 * 3. 进度更新双写：移除 setInterval 轮询，仅用 timeupdate 事件驱动，减少 re-render
 * 4. 连续点击无响应修复：加入 120ms load debounce，快速连击时只执行最后一次加载，
 *    避免多次 abort+reload 堆积导致最终那首歌迟迟收不到 canplay
 *
 * 关于 Network 里大量 stream「206」或红色记录：
 * - 206 Partial Content 是 HTML5 Audio 对大文件分段缓冲的正常行为，不是服务器错误。
 * - 切歌、拖动进度或中止旧 range 请求时，浏览器会取消未完成的请求，Safari 等常标成红色，
 *   属于预期现象，不代表播放失败。
 * - 即使全是 206，仍可能出现 MediaError code 4（MEDIA_ERR_SRC_NOT_SUPPORTED）：表示解码器不接受
 *   该字节流。Safari 对服务端实时转码的 FLAC 分段流尤易如此，此时会再试 MP3 转码流。
 * 5. 元数据时长 > 实际可播时长：播放到真实结尾后缓冲耗尽，currentTime 卡住且不触发 ended。
 *    用「近结尾 + 缓冲已到尾 + 时间久不前进」检测并调用 next()，避免 UI 假死、也不自动下一首。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { usePlayerStore } from '@/store/playerStore'
import { redactUrl } from '@/utils/redactUrl'
import { useServerStore } from '@/store/serverStore'
import { useSettingsStore, QUALITY_MAX_BITRATE, type AudioQuality } from '@/store/settingsStore'
import { getAdapterFor, hasAdapterFor } from '@/api'
import { describeError, pluginErrorCode } from '@/services/errors'
import { collectSourceRefs, resolveSourceOrder } from '@/hooks/useSourceQueries'
import { bestMatchFor } from '@/plugins/match'
import { toast } from '@/components/ui/use-toast'
import type { Song } from '@/api/types'
import { computeReplayGainScalar } from '@/utils/replayGain'
import { isMeteredConnection, onConnectionChange } from '@/lib/network'
import { clearPauseReason, notePauseReason, readPauseContext, recordPause } from '@/lib/playbackTrail'
import { t } from '@/i18n'
import {
  createListeningEventId,
  deriveListeningOutcome,
  getScrobbleThreshold,
  upsertListeningEvent,
  type ListeningOutcome,
} from '@/services/listeningHistory'
import {
  accumulateListenedDelta,
  buildLoadedKey,
  buildStreamCacheKey,
  classifyStreamFailure,
  playbackKey,
  getFiniteDuration,
  isAtBufferedTail,
  bufferedAheadSec,
  isNearEndOfTrack,
  isPrematureEnd,
  isStreamExpired,
  parseLoadedKey,
  resolveStreamFromAdapter,
  type ResolvedStream,
} from '@/utils/audioEngine'

/**
 * 强制中止所有未完成的 <img> HTTP 请求，立即释放同源连接池
 *
 * 为什么需要 DOM 层操作而不能只靠 React 状态：
 * - 浏览器同源连接限制为 6 条，歌曲列表渲染时 10-20 个 <img> 已占满连接池
 * - React 状态变更 (streamBuffering) 需要 16-50ms+ 才能触发 DOM 更新
 * - 在这段延迟内 audio.load() 的请求被排在队尾，导致首次播放卡顿
 * - 直接设 img.src='' 会让浏览器立即中止该 HTTP 请求，0 延迟释放连接
 */
function abortPendingImageLoads() {
  const images = document.querySelectorAll('img')
  let aborted = 0
  images.forEach(img => {
    if (img.complete) return          // 已加载完成，不影响
    if (!img.src) return              // 没有 src，跳过
    if (img.src.startsWith('data:')) return  // data URI 占位图，跳过
    if (img.dataset.noAbort === 'true') return  // eager/重要图片（如全屏播放器封面），不中止
    img.src = ''                      // 立即中止浏览器的 HTTP 请求
    aborted++
  })
  if (aborted > 0) {
    console.info('[AudioEngine] aborted', aborted, 'pending image loads to free connections')
  }
}

/** 模块级 Audio 实例 — 预创建，整个应用生命周期内复用 */
const audioEl: HTMLAudioElement = new Audio()
audioEl.preload = 'auto'
/**
 * 第二个 Audio 实例，只用来把下一首的流预热进 HTTP 缓存。
 * 静音且从不 play()，因此不会占用媒体会话，也不会被系统媒体键控制。
 */
const preloadEl: HTMLAudioElement = new Audio()
preloadEl.preload = 'auto'
preloadEl.muted = true
preloadEl.volume = 0

/**
 * 流地址缓存（key 见 buildStreamCacheKey）：插件音源取一次地址是一次网络请求，
 * 还新鲜的地址不该在重播 / 预热间反复重取。Map 保插入序，超限 FIFO 淘汰。
 */
const streamCache = new Map<string, ResolvedStream>()
const STREAM_CACHE_MAX = 32

/**
 * 歌曲归属的服务器：新数据一律带 serverId；旧版本持久化进队列的曲目没有，
 * 退回主库（阶段 0 只连一台，语义等价）。
 */
function songServerId(song: Pick<Song, 'serverId'>): string {
  return song.serverId || useServerStore.getState().activeServerId || ''
}

/**
 * 解析（或命中缓存的）流地址。过期或 skipCache 时重取。
 * 适配器未注册（音源已断开）会抛错，由调用方决定如何降级。
 */
/** 在途请求表（阶段 3.10）：同一 (serverId, songId, quality) 的并发解析只发一次 */
const inflightStreams = new Map<string, Promise<ResolvedStream>>()

async function resolveStream(
  song: Song,
  quality: AudioQuality,
  opts: { skipCache?: boolean } = {}
): Promise<ResolvedStream> {
  const serverId = songServerId(song)
  const key = buildStreamCacheKey(serverId, song.id, quality)
  if (!opts.skipCache) {
    const cached = streamCache.get(key)
    if (cached && !isStreamExpired(cached.expiresAt, Date.now())) return cached
    const inflight = inflightStreams.get(key)
    if (inflight) return inflight
  }
  const request = (async () => {
    const resolved = await resolveStreamFromAdapter(
      getAdapterFor(serverId),
      song.id,
      {
        maxBitrate: QUALITY_MAX_BITRATE[quality],
        quality,
        contentType: song.contentType,
        path: song.path,
        suffix: song.suffix,
      }
    )
    if (streamCache.size >= STREAM_CACHE_MAX) {
      const oldest = streamCache.keys().next().value
      if (oldest !== undefined) streamCache.delete(oldest)
    }
    streamCache.set(key, resolved)
    return resolved
  })()
  inflightStreams.set(key, request)
  /* 只删自己那一格（复核 F11）：skipCache 请求可能与旧在途同 key，
   * 旧请求先结束时把新条目也删掉，去重表就漏风了 */
  request.then(
    () => { if (inflightStreams.get(key) === request) inflightStreams.delete(key) },
    () => { if (inflightStreams.get(key) === request) inflightStreams.delete(key) }
  )
  return request
}

/**
 * 异步加载序号：resolveStream await 期间可能已经切歌，
 * 晚到的结果（含它要写的 audio.src）必须作废。
 */
let loadSeq = 0

/**
 * 单轨失败的播放韧性（PLAN 验收第二轮）：
 * - 跨源降级：插件源上无权/失效的曲子，按播放优先序问其它已连接源要同曲，
 *   只认 isrc/exact 档（fuzzy 容易放错歌，宁可直接跳过）。
 * - 自动跳歌：降级也找不到时前进到下一首，而不是把整条队列停在原地；
 *   连续 MAX_AUTO_SKIPS 次失败则停下（坏队列不该无限空转）。
 */
async function tryFallbackSource(failed: Song, tried: ReadonlySet<string>): Promise<Song | null> {
  const st = useServerStore.getState()
  const refs = collectSourceRefs(st.servers, st.connectedServerIds, st.activeServerId)
  const order = resolveSourceOrder(refs, useSettingsStore.getState().playbackPriority)
  const query = `${failed.title} ${failed.artist}`.trim()
  if (!query) return null
  for (const ref of order) {
    if (ref.serverId === failed.serverId) continue
    // 这一轮里已经试过（并失败）的源不再回头——否则 A→B→A 无限乒乓
    if (tried.has(ref.serverId)) continue
    if (!hasAdapterFor(ref.serverId)) continue
    const adapter = getAdapterFor(ref.serverId)
    if (typeof adapter.searchAll !== 'function') continue
    try {
      const res = await adapter.searchAll(query)
      const best = bestMatchFor(failed, res.songs ?? [])
      if (best && best.tier !== 'fuzzy') return best.song
    } catch { /* 这个源搜失败就试下一家 */ }
  }
  return null
}

let consecutiveResolveFailures = 0
const MAX_AUTO_SKIPS = 5
/**
 * 这一首（队列上的这个位置）的换源链：已经试过哪些音源。
 *
 * 早先记的是「加载 key」，而 key 里带着 serverId——换源之后 key 就变了，
 * 守卫等于没有：QQ 放不了 → 换网易云 → 也放不了 → 换回 QQ → …
 * 无限乒乓，每一轮弹两条提示，看上去就是「报错框永远不消失」。
 * 按队列位置记，并把试过的源攒起来，每个源在一首歌上只试一次。
 */
let fallbackChain: { index: number; tried: Set<string> } | null = null
/**
 * 上一次因「音源已断开」跳过的曲目。
 * 断开动作本身会裁队列，走到这里的都是漏网的；万一整条队列都属于那个源，
 * 逐首跳过时不该对每一首各弹一次提示——说一次就够了。
 */
let disconnectedNoticeKey: string | null = null

/**
 * 在不改变任何状态的前提下算出「下一首是谁」。
 * 随机开启时必须沿 shuffledIndexes 取，否则预热的是错的那一首。
 */
function peekNextSong(st: ReturnType<typeof usePlayerStore.getState>): Song | null {
  const { queue, queueIndex, shuffle, shuffledIndexes, shuffleCursor, repeatMode } = st
  if (!queue.length) return null
  if (repeatMode === 'one') return null
  if (shuffle && shuffledIndexes.length === queue.length) {
    const cursor =
      shuffleCursor >= 0 && shuffledIndexes[shuffleCursor] === queueIndex
        ? shuffleCursor
        : shuffledIndexes.indexOf(queueIndex)
    const next = cursor + 1
    if (next < shuffledIndexes.length) return queue[shuffledIndexes[next]] ?? null
    // 绕回时会重洗，无从预知下一首
    return null
  }
  if (queueIndex < queue.length - 1) return queue[queueIndex + 1] ?? null
  if (repeatMode === 'all') return queue[0] ?? null
  return null
}
let loadedKey: string | null = null  // "songId@quality@version" 格式
let cleanupPrev: ((stopSession?: boolean) => void) | null = null

/**
 * 关闭「正在上报的播放会话」（复审 B5）：Jellyfin 的 Sessions/Playing。
 * cleanupPrev 在 React 依赖变化的 cleanup 里就会被置空，而那时还不知道
 * 下一首歌是谁——把「关会话」单独留在模块级，由新的 effect 体按
 * 「base 是否真的变了」决定关不关；卸载路径无条件关。
 */
let closeSessionPrev: (() => void) | null = null
/**
 * 切歌标志位 — 切歌时设为 true，防止 audio.src='' 触发的 pause
 * 事件被误认为是耳机拔出等外部暂停并同步到 store
 */
let isSwitchingSong = false
/**
 * 加载防抖 timer — 连续切歌时只处理最后一次，
 * 避免多次 abort+reload 堆积导致 UI 长时间无响应
 */
let loadDebounceTimer: ReturnType<typeof setTimeout> | null = null
const LOAD_DEBOUNCE_MS = 120  // 120ms：足以吸收快速连击，又不影响正常点击的响应速度

/**
 * 上次真正执行加载的时刻（阶段 3.7）：距上次切歌已超过 debounce 窗口时
 * 立即加载——非首播不该一律等 120ms，正常听歌每首之间都白等一拍。
 */
let lastLoadStartedAt = 0
/**
 * 上次**调度**（处理一次切歌，无论立即加载还是排 debounce）的时刻
 * （复核 F10）：判定「是不是连击」要看用户最后一次动作，不能只看
 * 「上次加载开始」——排定中的加载还没开始，连点第 3 次就会撞进
 * 立即分支，debounce 退化成节流。
 */
let lastLoadScheduledAt = 0

/**
 * 模块级播放统计状态 — 完全脱离 React 生命周期
 * 按加载 key 归属：新歌加载时重置，同 key 重挂监听（reattach）时保留，
 * 保证 now-playing / scrobble 提交 / 历史记录每次播放最多各一次
 */
let playStatKey: string | null = null
/** 实际收听累计秒数（按 timeupdate 增量累计，seek 跳变不计入）*/
let listenedSec = 0
let listenedPrevT = -1
/** submission=false 的 now-playing 是否已发送（真正开始播放时才发）*/
let nowPlayingSent = false
/** submission=true 的播放提交（及历史记录）是否已完成 */
let playSubmitted = false
/** 当前播放会话。使用 eventId upsert，阈值记录与结束记录不会生成两条播放。 */
let playEventId: string | null = null
let playEventSong: Song | null = null
let playEventServerId: string | null = null
let playEventStartedAt = 0
let lastPersistedListenedSec = 0

function resetListeningSession() {
  playEventId = null
  playEventSong = null
  playEventServerId = null
  playEventStartedAt = 0
  lastPersistedListenedSec = 0
}

function startListeningSession(song: Song, serverId: string) {
  if (playEventId) return
  playEventId = createListeningEventId()
  playEventSong = { ...song, serverId }
  playEventServerId = serverId
  playEventStartedAt = Date.now()
  lastPersistedListenedSec = 0
}

function persistListeningSession(outcomeOverride?: ListeningOutcome) {
  persistSessionSnapshot(captureListeningSession(), outcomeOverride)
}

/** 会话的纯数据快照（复核 F10）：ended 结账不再后推闭包读取，防被新加载清零 */
interface SessionSnapshot {
  eventId: string | null
  song: Song | null
  serverId: string | null
  startedAt: number
  listenedSec: number
}

function captureListeningSession(): SessionSnapshot {
  return {
    eventId: playEventId,
    song: playEventSong,
    serverId: playEventServerId,
    startedAt: playEventStartedAt,
    listenedSec,
  }
}

function persistSessionSnapshot(snap: SessionSnapshot, outcomeOverride?: ListeningOutcome) {
  if (!snap.eventId || !snap.song || !snap.serverId || snap.listenedSec < 1) return
  const duration = Math.max(0, snap.song.duration || 0)
  const outcome = outcomeOverride ?? deriveListeningOutcome(snap.listenedSec, duration)
  upsertListeningEvent({
    version: 2,
    eventId: snap.eventId,
    serverId: snap.serverId,
    song: snap.song,
    startedAt: snap.startedAt || Date.now() - snap.listenedSec * 1000,
    endedAt: Date.now(),
    listenedSeconds: Math.round(snap.listenedSec * 10) / 10,
    completionRate: duration > 0 ? Math.max(0, Math.min(1, snap.listenedSec / duration)) : 0,
    outcome,
  })
  lastPersistedListenedSec = snap.listenedSec
}

/**
 * 模块级「最近真实播放位置」— 由 timeupdate 持续记录，load() 复位到 0 不覆盖。
 * 供错误恢复 / reattach 重载时保位续播，防止中途重载后从头重播
 */
let lastPlaybackPos = 0
let lastPlaybackKey: string | null = null
/**
 * 错误/停滞重载后的恢复点（秒）— 必须放在模块级：
 * reattach 会重建 doLoad 闭包，闭包级变量会在重挂时丢失恢复点，
 * 导致恢复重载后的歌从头重播（正是「静音后从头重播」bug 的来源之一）
 */
let pendingRecoverTime: number | null = null
/** 恢复 seek 的重试计数 — 转码流 seekable 随缓冲增长，需要多个事件里重试 */
let recoverSeekAttempts = 0
const MAX_RECOVER_SEEK_ATTEMPTS = 12
/** 错误恢复重载次数 — 模块级，防止 reattach 重建闭包后归零造成无限重载 */
let recoverAttempts = 0
/**
 * 单曲循环倒带时的闭包内状态重置入口（阶段 6.12）：
 * doLoad 里把「归零看门狗/恢复计数」的函数挂上来，repeat effect 调它——
 * 这些是闭包变量，模块外面够不着。
 */
let onRepeatRewind: (() => void) | null = null

/**
 * 「失败停下后按播放要重载」的标记（复审 A9）：只有 halt / 音质切换失败
 * 这类真正停下时才置位。原先播放 effect 只看「无 src / 错误态」——
 * 暂停态点歌、冷启动首播时 load effect 刚清空 src 也会命中，
 * 多 bump 一次 playVersion、重复取流（插件源多撞一次限频）。
 */
let needsReloadOnPlay = false

/**
 * 离线暂停令牌（复核 F5）：handleOfflineError 暂停时签发一个新令牌；
 * 之后用户的任何播放/暂停动作都会把它清零。网络恢复时只有令牌仍然
 * 有效才自动续播——「暂停时正在播」本身不够：用户离线期间手动停过，
 * 联网后就不该抢方向盘。
 */
let offlineResumeToken = 0
/** 本次 isPlaying 翻转是否引擎自己发起（离线暂停先置位，播放 effect 据此放过令牌） */
let engineInitiatedPause = false

/**
 * 当前音频元素的真实播放位置（秒）。
 * audioEl 是模块级的 new Audio()，从不挂进 DOM，因此 document.querySelector('audio')
 * 找不到它——需要读取实际位置的调用方必须走这里。
 */
export function getAudioCurrentTime(): number {
  return audioEl.currentTime || 0
}

/** 从外部 seek（供 PlayerBar / FullscreenPlayer / LyricDisplay 调用）*/
export function seekHowl(time: number) {
  usePlayerStore.getState().seekTo(time)
  audioEl.currentTime = time
  // 用户主动 seek：同步更新「最近播放位置」，并作废旧的恢复点，
  // 避免之后的错误恢复跳回 seek 之前的旧位置
  lastPlaybackPos = time
  lastPlaybackKey = loadedKey
  pendingRecoverTime = null
  // seek 后确保继续播放（流媒体 seek 可能导致 audio 暂停）
  if (usePlayerStore.getState().isPlaying && audioEl.paused) {
    audioEl.play().catch(() => {})
  }
}

export function useAudioEngine() {
  const currentSong = usePlayerStore(s => s.currentSong)
  const currentSongId = currentSong?.id ?? null
  const playVersion = usePlayerStore(s => s.playVersion)
  /*
   * 「现在放的是哪一次播放」的统一身份（阶段 3.5）：playVersion + 来源 + id。
   * 书签 / 预热原先只比 id，两个音源同 id 时会认错人。
   */
  const playbackIdentity = currentSong
    ? playbackKey(playVersion, songServerId(currentSong), currentSong.id)
    : null
  const isPlaying   = usePlayerStore(s => s.isPlaying)
  const volume      = usePlayerStore(s => s.volume)
  const muted       = usePlayerStore(s => s.muted)
  const isConnected = useServerStore(s => s.isConnected)
  const activeServerId = useServerStore(s => s.activeServerId)
  const startupConnectSettled = useServerStore(s => s.startupConnectSettled)
  const audioQuality = useSettingsStore(s => s.audioQuality)
  const cellularAudioQuality = useSettingsStore(s => s.cellularAudioQuality)
  const adaptiveQuality = useSettingsStore(s => s.adaptiveQuality)
  const repeatSeekToken = usePlayerStore(s => s.repeatSeekToken)

  // 网络类型变化时重新求值（插拔 Wi-Fi、开关省流量模式）
  const [metered, setMetered] = useState(() => isMeteredConnection())
  useEffect(() => onConnectionChange(() => setMetered(isMeteredConnection())), [])

  /**
   * 实际使用的音质档。
   * 这里此前是一句 `const effectiveQuality = audioQuality` —— 会员体系移除后
   * 留下的空转指向，正好是插入网络自适应的地方。
   */
  const effectiveQuality = adaptiveQuality && metered ? cellularAudioQuality : audioQuality

  // TanStack Query 客户端 — 用于在加载音频时取消 pending 的封面请求，释放连接池
  const queryClient = useQueryClient()

  const volumeRef   = useRef(volume)
  const mutedRef    = useRef(muted)
  const currentSongRef = useRef(currentSong)
  volumeRef.current = volume
  mutedRef.current  = muted
  currentSongRef.current = currentSong

  // ReplayGain / 倍速 / 过渡：都通过 ref 读取，避免把高频设置塞进加载依赖
  const replayGainMode = useSettingsStore(s => s.replayGainMode)
  const replayGainPreamp = useSettingsStore(s => s.replayGainPreamp)
  const playbackRate = useSettingsStore(s => s.playbackRate)
  const smoothTransitions = useSettingsStore(s => s.smoothTransitions)
  const gainCtxRef = useRef({ mode: replayGainMode, preamp: replayGainPreamp })
  gainCtxRef.current = { mode: replayGainMode, preamp: replayGainPreamp }
  const smoothRef = useRef(smoothTransitions)
  smoothRef.current = smoothTransitions

  /**
   * 当前应当写入 audio.volume 的值：主音量 × ReplayGain 标量。
   *
   * 三处写入（重试重载、正常加载、音量变化）必须走同一条路径，
   * 否则任何一次重载都会把归一化悄悄丢掉。
   */
  const targetVolume = useCallback(() => {
    if (mutedRef.current) return 0
    // 睡眠定时的收尾渐弱只作用在这里，绝不写回持久化的主音量
    const fade = usePlayerStore.getState().sleepFadeScalar
    const base = volumeRef.current * (Number.isFinite(fade) ? fade : 1)
    const { mode, preamp } = gainCtxRef.current
    if (mode === 'off') return base
    // auto 模式判断是否「按顺序放整张专辑」：随机开着就不是
    const st = usePlayerStore.getState()
    const albumContext =
      !st.shuffle &&
      st.queue.length > 1 &&
      !!st.currentSong?.albumId &&
      st.queue.every(item => item.albumId === st.currentSong?.albumId)
    const scalar = computeReplayGainScalar(currentSongRef.current, {
      mode,
      preampDb: preamp,
      albumContext,
    })
    return Math.max(0, Math.min(1, base * scalar))
  }, [])

  /**
   * 音量斜坡。在延音上硬停是一个音频应用最「像软件」的瞬间。
   * 用 rAF 而不是 setInterval，避免后台标签页里堆积。
   */
  const preloadedIdRef = useRef<string | null>(null)
  const rampRef = useRef<number | null>(null)
  /**
   * 作废当前斜坡时要做的清理（含摘掉 visibilitychange 监听）。
   * 两条取消路径——外部 cancelRamp 与新斜坡覆盖旧斜坡——共用同一套，
   * 否则监听器会随每次暂停/播放累积。
   */
  const disposeRampRef = useRef<(() => void) | null>(null)
  /** 取消在途的音量斜坡，连同它挂着的 onDone 一起作废 */
  const cancelRamp = useCallback(() => {
    disposeRampRef.current?.()
    disposeRampRef.current = null
    if (rampRef.current !== null) {
      cancelAnimationFrame(rampRef.current)
      rampRef.current = null
    }
  }, [])
  const rampVolume = useCallback((to: number, ms: number, onDone?: () => void) => {
    disposeRampRef.current?.()
    disposeRampRef.current = null
    if (rampRef.current !== null) {
      cancelAnimationFrame(rampRef.current)
      rampRef.current = null
    }
    /**
     * 页面不可见时不能用 rAF 做渐变：浏览器会把 requestAnimationFrame 挂起，
     * 回调永远不触发，于是挂在回调里的 `audioEl.pause()` 永远不执行——
     * 锁屏、蓝牙耳机、系统媒体面板上按暂停，音乐照放不误。
     *
     * 淡出是锦上添花，暂停是硬承诺。不可见时直接落到目标值并立刻收尾。
     */
    if (!smoothRef.current || ms <= 0 || document.hidden) {
      audioEl.volume = to
      onDone?.()
      return
    }
    const from = audioEl.volume
    if (Math.abs(from - to) < 0.01) {
      audioEl.volume = to
      onDone?.()
      return
    }
    const start = performance.now()
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      document.removeEventListener('visibilitychange', onHide)
      disposeRampRef.current = null
      if (rampRef.current !== null) {
        cancelAnimationFrame(rampRef.current)
        rampRef.current = null
      }
      audioEl.volume = to
      onDone?.()
    }
    /**
     * 切到后台的那一刻 rAF 就不再回调了，挂在 onDone 里的 pause() 会永远悬着。
     * visibilitychange 比 rAF 更可靠，用它当场收尾。
     */
    function onHide() {
      if (document.hidden) finish()
    }
    document.addEventListener('visibilitychange', onHide)
    disposeRampRef.current = () => {
      settled = true
      document.removeEventListener('visibilitychange', onHide)
    }
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms)
      audioEl.volume = Math.max(0, Math.min(1, from + (to - from) * t))
      if (t < 1) {
        rampRef.current = requestAnimationFrame(step)
      } else {
        finish()
      }
    }
    rampRef.current = requestAnimationFrame(step)
  }, [])

  useEffect(() => () => {
    if (rampRef.current !== null) cancelAnimationFrame(rampRef.current)
  }, [])

  /**
   * 长音轨起播时跳到服务端记下的断点。
   *
   * 只对 20 分钟以上的曲目生效，且必须等到音频可以定位之后再 seek——
   * 转码流的 seekable 随缓冲增长，起播那一刻定位多半落不到位。
   */
  /**
   * 这一轮播放里已经应用过书签的曲目。
   *
   * 之前只记一个 id，于是「听长音轨 → 去听别的歌 → 回到长音轨」时，
   * 第二次进来 ref 里还是那首歌的 id，续听被自己挡掉、从头开始。
   * 改成集合：每首歌在一个会话里只续一次，互不干扰。
   */
  const bookmarkAppliedRef = useRef(new Set<string>())
  useEffect(() => {
    const song = currentSongRef.current
    if (!song || !playbackIdentity) return
    if (bookmarkAppliedRef.current.has(playbackIdentity)) return
    const position = song.ext?.bookmarkPosition
    if (!position || (song.duration ?? 0) < 20 * 60) return
    // 距离结尾太近就不必续了
    if (song.duration - position / 1000 < 30) return
    bookmarkAppliedRef.current.add(playbackIdentity)

    let attempts = 0
    const seconds = position / 1000
    /**
     * 重试链里每一次 setTimeout 都要记下来。
     *
     * 只清第一发是不够的：第二发之后的定时器由 trySeek 自己排队，
     * effect 清理时它们还在队列里，换歌之后仍会醒来并调 seekHowl。
     * 曲目 id 的检查能挡住大部分，但那是靠运气而不是靠结构。
     */
    let timer: ReturnType<typeof setTimeout> | null = null
    const trySeek = () => {
      timer = null
      // 守卫按完整身份比：同 id 不同源的替代版本不该被旧曲目的书签拽走
      const now = usePlayerStore.getState()
      if (!now.currentSong || playbackKey(now.playVersion, songServerId(now.currentSong), now.currentSong.id) !== playbackIdentity) return
      attempts += 1
      seekHowl(seconds)
      if (Math.abs(audioEl.currentTime - seconds) > 2 && attempts < 12) {
        timer = setTimeout(trySeek, 250)
      }
    }
    timer = setTimeout(trySeek, 500)
    return () => { if (timer) clearTimeout(timer) }
  }, [playbackIdentity])

  /**
   * 下一首预热（弱无缝）。
   *
   * 对着家里的 NAS，切歌那一下的空档是一次完整的网络往返。这里用一个隐藏的
   * 第二个 <audio> 提前把下一首的流拉进 HTTP 缓存，切过去时就基本没有空档。
   *
   * 刻意不做元素轮换：那需要重写整个加载/事件/统计路径，风险远大于收益。
   * 因此如实标注为「弱无缝」，而不是真正的 gapless。
   */
  const preloadNext = useSettingsStore(s => s.preloadNext)
  useEffect(() => {
    /*
     * 关闭预热 / 暂停 / 切到蜂窝（阶段 6.13）：清掉预热元素手里的流。
     * 不清的话它会把「下一首」整首拉完——切蜂窝后用户没点任何东西，
     * 流量却在一首一首地走。
     */
    if (!preloadNext || !isPlaying || metered) {
      if (preloadEl.getAttribute('src')) {
        preloadEl.pause()
        preloadEl.removeAttribute('src')
        preloadEl.load()
      }
      return
    }
    /* 已预解析（未拉流）的下一首地址：切歌时直接命中 streamCache */
    const preResolved = new Set<string>()
    const resolveAheadTimer = setInterval(() => {
      const st = usePlayerStore.getState()
      if (!st.isPlaying || st.duration <= 0) return
      const next = peekNextSong(st)
      if (!next || !hasAdapterFor(songServerId(next))) return
      const nextServer = songServerId(next)
      // 只对异步取流的插件源做（NAS 直链拼 URL 零成本）
      const nextAdapter = getAdapterFor(nextServer)
      if (!nextAdapter.resolveStreamUrl) return
      const key = buildStreamCacheKey(nextServer, next.id, effectiveQuality)
      if (preResolved.has(key)) return
      const cached = streamCache.get(key)
      if (cached && !isStreamExpired(cached.expiresAt, Date.now())) return
      preResolved.add(key)
      /*
       * 只解析不拉流（阶段 3.10b）。失败不重试（复核 F11）：预解析是锦上
       * 添花，旧实现失败后从 preResolved 里删掉，8s 一轮再来——会员/denied
       * 曲整首歌期间每 8s 打一次插件，还与用户操作共用频控额度，撞上
       * rate-limited 让整个源退避 60s，反过来挡住用户切歌。每个 key 只试
       * 一次；真切到这首时正常加载路径自会走完整的失败处理。
       */
      resolveStream(next, effectiveQuality).catch(() => { /* 放弃这首的预解析 */ })
    }, 8000)

    const timer = setInterval(() => {
      const st = usePlayerStore.getState()
      const remaining = (st.duration || 0) - (st.currentTime || 0)
      // 剩 15 秒内才预热，早了会和当前曲抢连接
      if (!st.duration || remaining > 15 || remaining <= 0) return
      const nextSong = peekNextSong(st)
      if (!nextSong) return
      // 预热去重按完整身份（阶段 3.5）：队列里两首同 id 不同源的歌都要能各自预热
      const nextKey = playbackKey(st.playVersion, songServerId(nextSong), nextSong.id)
      if (nextKey === preloadedIdRef.current) return
      if (!hasAdapterFor(songServerId(nextSong))) return
      preloadedIdRef.current = nextKey
      // 预热同样走 resolveStream：命中未过期的地址（含刚解析过的）直接用，
      // 预热的地址到正式加载时若已过期，加载路径会重取
      resolveStream(nextSong, effectiveQuality)
        .then(resolved => {
          // resolve 期间队列可能已经变化：预热错了歌比不预热更糟（身份连来源一起比）
          const laterState = usePlayerStore.getState()
          const laterNext = peekNextSong(laterState)
          if (!laterNext || playbackKey(laterState.playVersion, songServerId(laterNext), laterNext.id) !== nextKey) return
          preloadEl.src = resolved.url
          preloadEl.load()
        })
        .catch(() => {
          // 预热失败无所谓，正常加载路径会再拉一次
        })
    }, 2000)
    return () => {
      clearInterval(timer)
      clearInterval(resolveAheadTimer)
    }
  }, [preloadNext, isPlaying, metered, effectiveQuality])

  // --- 核心：歌曲变化 / 连接就绪 / 音质变化 时加载音频 ---
  useEffect(() => {
    const activeSong = currentSongRef.current
    const songId = currentSongId

    if (!songId || !activeSong) {
      persistListeningSession()
      resetListeningSession()
      playStatKey = null
      listenedSec = 0
      listenedPrevT = -1
      /*
       * 先关会话再复位标记（复审 D5）：closeSessionPrev 内部看 nowPlayingSent，
       * 原顺序先把标记清成 false，Jellyfin 的 stop 永远发不出去——
       * 「队列清空后服务器还挂着正在播放」。
       */
      closeSessionPrev?.()
      closeSessionPrev = null
      nowPlayingSent = false
      playSubmitted = false
      // 清除未触发的 debounce
      if (loadDebounceTimer !== null) {
        clearTimeout(loadDebounceTimer)
        loadDebounceTimer = null
      }
      if (cleanupPrev) { cleanupPrev(); cleanupPrev = null }
      audioEl.pause()
      audioEl.src = ''
      usePlayerStore.getState().setStreamBuffering(false)
      loadedKey = null
      // 清空恢复/位置记录，避免残留状态影响下一次播放
      pendingRecoverTime = null
      recoverSeekAttempts = 0
      recoverAttempts = 0
      lastPlaybackPos = 0
      lastPlaybackKey = null
      return
    }

    // 队列允许混源：加载只看这首歌自己的来源是否连着，不看主库是谁。
    // 主库（isConnected）断开不能连坐——正在放的插件源歌曲适配器还活着就该继续放
    const songServer = songServerId(activeSong)
    if (!hasAdapterFor(songServer)) {
      /*
       * 冷启动：插件音源的沙箱还在装载，此刻「没适配器」只是「还没连上」。
       * 什么都不做，等 startupConnectSettled 翻真后本 effect 重跑再判。
       * 否则每次重启都会把用户上次听的那首当成「源断了」跳掉、还自动开播。
       */
      if (!startupConnectSettled) return
      /*
       * 这首歌的音源已经断开。
       *
       * 原来是静默暂停并清空音频：界面还停在这首歌上、进度条不动、按播放
       * 没反应，用户看到的是「播放器坏了」，而真相是「这个源没连着」。
       * 现在说清楚原因并跳到下一首——队列混源，别的源的歌还能放。
       */
      persistListeningSession()
      resetListeningSession()
      closeSessionPrev?.()
      closeSessionPrev = null
      if (cleanupPrev) { cleanupPrev(); cleanupPrev = null }
      audioEl.pause()
      audioEl.src = ''
      loadedKey = null
      usePlayerStore.getState().setStreamBuffering(false)
      const noticeKey = `${songServer}:${songId}`
      if (disconnectedNoticeKey !== noticeKey) {
        disconnectedNoticeKey = noticeKey
        toast({ title: t('player.sourceDisconnected'), variant: 'destructive' })
      }
      // auto:true：到队尾就停下（那是「放完了」），不要在死队列上空转
      usePlayerStore.getState().next({ auto: true })
      return
    }
    disconnectedNoticeKey = null

    const currentKey = buildLoadedKey(songServer, songId, effectiveQuality, playVersion)

    // 捕获当前歌曲 id，供 debounce 内校验
    const capturedSongId = songId
    const capturedKey = currentKey
    const capturedSong = activeSong
    const capturedServerId = songServer

    /**
     * 同曲同版本、仅音质变化（会员状态/音质设置变更）触发的重载：
     * 记录切换前的播放位置，加载后保位续播，不应从头重播
     */
    let qualitySwitchResumeAt: number | null = null

    /*
     * 音质降级阶梯（阶段 5 / F14）：插件源上 denied 多半是「这一档要会员」，
     * 先在同一个源逐档降（lossless→high→medium→low），全部失败才换源、
     * 最后才跳歌——换源会离开用户的「首选源」，跳歌直接打断收听。
     */
    const QUALITY_LADDER: Record<AudioQuality, AudioQuality | null> = {
      lossless: 'high', high: 'medium', medium: 'low', low: null,
    }

    // 首次播放不需要 debounce（没有旧音频要中断），后续切歌才 debounce 吸收连续点击
    // reattachOnly=true：同 key 重挂监听（依赖变化触发过 cleanup 后），
    // 绝不能触碰 audioEl.src / currentTime，否则正在播放的歌会从头重播
    // qualityOverride：同源音质降级时带着更低档重走一遍（F14）
    const doLoad = async (reattachOnly = false, qualityOverride?: AudioQuality) => {
      // 检查 store 当前状态是否还是同一首歌，避免 debounce 期间又切走了
      const latestSong = usePlayerStore.getState().currentSong
      if (!latestSong || latestSong.id !== capturedSongId) return
      if (!reattachOnly) lastLoadStartedAt = performance.now()
      // 新一次加载接管了：之前留下的「按播放需重载」标记作废（复审 A9）
      needsReloadOnPlay = false

      // ── 实际加载逻辑 ──────────────────────────────────────────
      const loadQuality = qualityOverride ?? effectiveQuality
      const maxBitrate = QUALITY_MAX_BITRATE[loadQuality]
      const contentType = capturedSong.contentType
      // 异步加载序号：取流 await 期间切了歌，本次加载整体作废
      const seq = ++loadSeq
      /*
       * 这次加载是否仍然是「用户现在想听的东西」。
       *
       * 成功分支本来就查了，失败分支一路都没查——于是：慢慢失败的 A 在用户已经
       * 改点 B 之后回来，照样弹提示、照样换源、照样把 B 换成「A 的替代版本」。
       * 用户选的歌被一个过期请求抢走了。
       *
       * 身份要连**来源**一起比：同一首歌在两个音源下 id 可能一样，只比 id 会把
       * 「从 QQ 切到网易云的同一首」误判成没变过。
       */
      const stillCurrent = () => {
        if (seq !== loadSeq) return false
        const now = usePlayerStore.getState().currentSong
        return !!now && now.id === capturedSongId && songServerId(now) === songServerId(capturedSong)
      }
      let resolved: ResolvedStream
      try {
        resolved = await resolveStream(capturedSong, loadQuality)
      } catch (e) {
        // 过期的失败不该碰任何全局状态：缓冲标记、提示、换源、失败计数都跳过
        if (!stillCurrent()) return
        console.error('[AudioEngine] resolveStream failed:', e)
        usePlayerStore.getState().setStreamBuffering(false)
        // 静默失败在用户眼里就是「点了没反应」——VIP/付费曲至少要说明原因
        const detail = e instanceof Error ? e.message : String(e)
        /**
         * 「是不是权限问题」按**协议错误码**判（PluginCallError.code，PROTOCOL §7），
         * 分类逻辑抽在 classifyStreamFailure（utils/audioEngine.ts），那里有测试。
         * 取码走 pluginErrorCode（复核 F13：不再鸭子 cast）。
         */
        const code = pluginErrorCode(e)
        /* toast 的说明句走 describeError 的词条（复核 F13）：detail 只喂给
         * classifyStreamFailure 做文本嗅探，插件作者的原始英文串不进 UI */
        const userDetail = describeError(e)
        const failureClass = classifyStreamFailure(code, detail)
        const denied = failureClass === 'denied'
        // 音质切换途中失败不算跳歌场景：保持停在原处的原语义
        if (qualitySwitchResumeAt !== null) {
          // 把 isPlaying 收回来：元素还握着旧流，但加载目标已经失败，
          // 按钮停在「播放中」是在撒谎；收回后用户按播放可从旧流续听
          needsReloadOnPlay = true
          notePauseReason('error', `quality switch failed: ${failureClass}`)
          usePlayerStore.getState().pause()
          toast({
            title: t('player.streamFailed', { title: capturedSong.title }),
            description: denied ? userDetail : undefined,
            variant: 'destructive',
          })
          return
        }

        /*
         * 先找替代源，找到就只说一句「已切换到 X 继续播放」。
         *
         * 早先是「先弹一条失败、再换源、换完再弹一条已切换」，一次成功的降级
         * 也要弹两条，其中一条还是刺眼的红色——而用户其实什么都没损失。
         * 报错只在**真的放不了**（所有源都试过）时说一次。
         * 除权限外，「这个源根本没有这一首」（not-found）同样值得换源再试。
         */
        /*
         * 同源音质降级（F14）：只对插件源（异步取流）的 denied 做——
         * NAS 的转码链路按 maxBitrate 自适应，denied 另有原因。
         * 降档成功就以降档音质重走加载（doLoad 递归），只说一句话。
         */
        if (failureClass === 'denied' && !qualityOverride) {
          const failingServer = songServerId(capturedSong)
          const failingAdapter = hasAdapterFor(failingServer) ? getAdapterFor(failingServer) : null
          if (failingAdapter?.resolveStreamUrl) {
            let lower = QUALITY_LADDER[loadQuality]
            while (lower) {
              try {
                await resolveStream(capturedSong, lower)
                if (!stillCurrent()) return
                toast({ title: t('player.qualityFallback', { quality: t(`audio.quality.${lower}`) }) })
                return doLoad(false, lower)
              } catch {
                if (!stillCurrent()) return
                lower = QUALITY_LADDER[lower]
              }
            }
          }
        }

        const worthFallback = failureClass === 'denied' || failureClass === 'not-found'
        if (worthFallback) {
          const index = usePlayerStore.getState().queueIndex
          if (!fallbackChain || fallbackChain.index !== index) {
            fallbackChain = { index, tried: new Set<string>() }
          }
          fallbackChain.tried.add(songServerId(capturedSong))
          const alt = await tryFallbackSource(capturedSong, fallbackChain.tried)
          // 找替代源要发网络请求，这期间用户完全可能已经改听别的了
          if (!stillCurrent()) return
          if (alt) {
            fallbackChain.tried.add(alt.serverId)
            const altSourceName = useServerStore.getState().servers
              .find(s => s.id === alt.serverId)?.name ?? alt.serverId
            toast({ title: t('player.fallbackSource', { source: altSourceName }) })
            // 原位替换后 currentSong.id 变化 → 加载 effect 重新跑，接着放新源的版本
            usePlayerStore.getState().replaceCurrentSong(alt)
            return
          }
        }

        /*
         * 网络类错误（断网 / 超时 / 限频 / 未知）不是「这首坏了」：换哪首都一样。
         * 原地暂停、说出原因，不计入连续失败——否则断网时连跳 MAX_AUTO_SKIPS 首
         * 后弹「队列已停止」，用户会以为曲库坏了，其实只是网断了。
         * 走到这里说明不是 denied / not-found（那两类在上面已走完换源链）。
         */
        if (!worthFallback) {
          needsReloadOnPlay = true
          notePauseReason('error', `resolve failed: ${failureClass}`)
          usePlayerStore.getState().pause()
          toast({
            title: t('player.streamNetworkHalted', { title: capturedSong.title }),
            description: userDetail,
            variant: 'destructive',
          })
          return
        }

        toast({
          title: t('player.streamFailed', { title: capturedSong.title }),
          description: denied ? userDetail : undefined,
          variant: 'destructive',
        })
        // 自动跳歌：单轨失败不再停住整条队列
        consecutiveResolveFailures += 1
        if (consecutiveResolveFailures >= MAX_AUTO_SKIPS) {
          consecutiveResolveFailures = 0
          // 停下时把 isPlaying 收回来：没有流在放，按钮停在「播放中」
          // 会让按播放看起来失灵（见下方 play effect 的重载修复）
          needsReloadOnPlay = true
          notePauseReason('error', 'too many failed tracks in a row')
          usePlayerStore.getState().pause()
          toast({ title: t('player.queueHalted'), variant: 'destructive' })
          return
        }
        setTimeout(() => {
          // 稍等片刻给失败提示留出可读时间；期间用户手动切了歌就不抢方向盘。
          // 判据连来源一起比（stillCurrent）：只比 id 的话，用户切到「同名同 id
          // 的另一个音源版本」时会被误判成没动过，于是照样被自动跳走。
          if (stillCurrent()) usePlayerStore.getState().advanceOnEnded()
        }, 900)
        return
      }
      if (!stillCurrent()) return
      // 取到流即视为这次连续失败被打断
      consecutiveResolveFailures = 0
      // 这一首放成了：换源链作废（重听同一首时应当能重新走一遍降级）
      fallbackChain = null
      const streamUrl = resolved.url
      // 取到流才认领这个加载 key：被作废的加载不能抢走属于别人的 key
      loadedKey = capturedKey

      const audio = audioEl
      /** 无损最多 2 次恢复（无 format→FLAC→MP3）；有损仅 1 次同 URL 重试 */
      const maxRecoverAttempts = maxBitrate === 0 ? 2 : 1

      /**
       * 汇总当前歌曲「最近已知播放位置」：store / audio / 模块级记录 / 未消费的恢复点
       * 取最大值 — 各来源都可能被 load() 复位到 0，取 max 保证不丢位置
       */
      const bestKnownTime = () => {
        const st = usePlayerStore.getState()
        let t = Math.max(
          st.currentSong?.id === capturedSongId ? (st.currentTime || 0) : 0,
          isFinite(audio.currentTime) ? audio.currentTime : 0
        )
        if (lastPlaybackKey === capturedKey) t = Math.max(t, lastPlaybackPos)
        if (pendingRecoverTime !== null) t = Math.max(t, pendingRecoverTime)
        return t
      }

      /**
       * 应用恢复点：流就绪后把播放位置 seek 回中断处。
       * 转码流的 seekable 范围随缓冲增长，目标位置可能暂不可 seek —— 此时保留恢复点，
       * 在 loadedmetadata / canplay / canplaythrough / progress / timeupdate 中重试，
       * 超过次数上限后放弃（保证至少继续出声），避免与正常播放互相抢占
       */
      const applyPendingRecover = () => {
        if (pendingRecoverTime === null) return
        if (pendingRecoverTime <= 1) { pendingRecoverTime = null; return }
        if (audio.readyState < 1) return  // 元数据未就绪时 seek 会被浏览器丢弃，等下个事件
        // 恢复点稍微回退，减少边界位置 seek 失败概率
        const resumeAt = Math.max(0, pendingRecoverTime - 0.25)
        const giveUpIfExhausted = () => {
          recoverSeekAttempts += 1
          if (recoverSeekAttempts >= MAX_RECOVER_SEEK_ATTEMPTS) pendingRecoverTime = null
        }
        // seekable 尚未覆盖目标位置时直接赋值会被浏览器钳制回 0（丢失位置），先检查再 seek
        let seekableOk = false
        try {
          for (let i = 0; i < audio.seekable.length; i++) {
            if (audio.seekable.start(i) <= resumeAt && audio.seekable.end(i) >= resumeAt) {
              seekableOk = true
              break
            }
          }
        } catch {
          seekableOk = false
        }
        if (!seekableOk) {
          giveUpIfExhausted()
          return
        }
        try {
          audio.currentTime = resumeAt
          usePlayerStore.getState().setCurrentTime(resumeAt)
          lastPlaybackPos = resumeAt
          lastPlaybackKey = capturedKey
          pendingRecoverTime = null
        } catch {
          // 某些流在过早 seek 时会抛错，保留恢复点等下个事件重试
          giveUpIfExhausted()
        }
      }

      /** 「放完存货」的状态（见下面 RIDE_OUT_MIN_SEC）；任何一次重载都会清掉它 */
      let rideOut: { code: number; lastT: number; lastMoveAt: number } | null = null

      /**
       * 保位重载当前流 — 错误恢复 / 提前 ended / 中途停滞共用：
       * 先记录恢复点（bestKnownTime），再重载；恢复点由 applyPendingRecover 在就绪后消费
       */
      const reloadForRecovery = (retryUrl: string, delayMs: number, reason: string) => {
        rideOut = null
        console.warn('[AudioEngine]', reason, '— reloading in', delayMs, 'ms')
        const doReload = () => {
          // 延迟期间若已切歌/换加载，放弃本次恢复，避免覆盖新歌的 src
          if (loadedKey !== capturedKey) return
          // 恢复点在真正重载这一刻取：等的那一会儿里元素可能还在放（存货），提前取会倒回去重放一截
          const resumeAt = bestKnownTime()
          if (resumeAt > 1) {
            pendingRecoverTime = resumeAt
            recoverSeekAttempts = 0
          }
          // load() 可能引发 pause 事件，别被误判为外部暂停同步进 store
          isSwitchingSong = true
          setTimeout(() => { isSwitchingSong = false }, 200)
          audio.src = retryUrl
          audio.volume = targetVolume()
          audio.load()
        }
        if (delayMs <= 0) doReload()
        else setTimeout(doReload, delayMs)
      }

      // ─── 事件处理 ──────────────────────────────────────────────────

      /**
       * 尽早设置 duration：
       *   - loadedmetadata：元数据加载完成，可能已有有效 duration
       *   - durationchange：duration 发生变化时（流媒体会多次触发）
       *   - canplay/canplaythrough：可以播放时再尝试一次
       */
      const updateDuration = () => {
        const d = getFiniteDuration(audio)
        if (d !== null) {
          usePlayerStore.getState().setDuration(d)
        }
      }

      const onLoadedMetadata = () => {
        updateDuration()
        // 尽早尝试恢复中断位置（loadedmetadata 是最早允许 seek 的时机）
        applyPendingRecover()
      }

      const onDurationChange = () => {
        updateDuration()
      }

      /**
       * 达到播放阈值（Subsonic 约定：收听过半或满 4 分钟）后，
       * 提交 submission=true 的 scrobble 并写入本地历史，每次播放只做一次
       */
      /**
       * 失败重试要退避。
       *
       * 这个函数挂在 timeupdate 上（节流到 200ms），失败后把 playSubmitted
       * 放回 false 就意味着**本曲剩下的每一秒都会重试 5 次**——服务器
       * 500、反代抽风、Jellyfin 不支持这个端点，都会变成一场每秒 5 发的
       * 请求风暴，打到一台本来就不舒服的服务器上。
       *
       * 指数退避（2s 起步，上限 60s），并限制次数：scrobble 是锦上添花，
       * 不值得为它把服务器打垮，本地历史无论如何已经写下了。
       */
      let scrobbleRetryAt = 0
      let scrobbleAttempts = 0
      const MAX_SCROBBLE_ATTEMPTS = 5
      const maybeSubmitPlay = () => {
        if (playSubmitted || playStatKey !== capturedKey) return
        if (scrobbleRetryAt > 0 && performance.now() < scrobbleRetryAt) return
        if (scrobbleAttempts >= MAX_SCROBBLE_ATTEMPTS) return
        const st = usePlayerStore.getState()
        const dur = capturedSong.duration || st.duration || 0
        const threshold = getScrobbleThreshold(dur)
        if (listenedSec < threshold) return
        playSubmitted = true
        scrobbleAttempts += 1
        // 上报永远打回歌曲自己的来源服务器（队列混源时主库未必是它在的那台）
        void getAdapterFor(capturedServerId).scrobble(capturedSongId, true).catch(error => {
          playSubmitted = false
          const backoffMs = Math.min(60_000, 2_000 * 2 ** (scrobbleAttempts - 1))
          scrobbleRetryAt = performance.now() + backoffMs
          console.warn(
            `[AudioEngine] scrobble submission failed (${scrobbleAttempts}/${MAX_SCROBBLE_ATTEMPTS});`,
            `retrying in ${Math.round(backoffMs / 1000)}s:`, error)
        })
        persistListeningSession('qualified')
      }

      // timeupdate 节流：浏览器原生约 250ms 触发一次，但 zustand 广播开销不低
      // 限制为每 200ms 最多更新一次（实际和 timeupdate 频率一致，但可防止异常高频场景）
      let lastTimeUpdateMs = 0
      /** 上次恢复重载后的连续健康播放秒数 — 播够 30s 补满恢复次数预算 */
      let healthyPlaySec = 0
      const onTimeUpdate = () => {
        const now = performance.now()
        if (now - lastTimeUpdateMs < 200) return  // 最多 5fps，进度条足够流畅
        lastTimeUpdateMs = now

        const t = audio.currentTime
        usePlayerStore.getState().setCurrentTime(t)

        // 持续记录最近真实播放位置（t=0 是 load() 复位，不覆盖），供恢复保位续播
        if (t > 0) {
          lastPlaybackPos = t
          lastPlaybackKey = capturedKey
        }
        // 恢复点尚未消费（如重载后 seekable 还没长到目标位置）：继续重试
        if (pendingRecoverTime !== null) applyPendingRecover()

        // 累计实际收听时长：只计入正常前进的小增量，seek 造成的跳变不算收听
        if (playStatKey === capturedKey) {
          const delta = accumulateListenedDelta(listenedPrevT, t)
          if (delta > 0) {
            listenedSec += delta
            maybeSubmitPlay()
            // 长时间播放中偶发多次网络抖动：连续健康播放 30s 后补满恢复预算，
            // 避免一次恢复用光次数后，后续中断只能静音/报错
            if (recoverAttempts > 0) {
              healthyPlaySec += delta
              if (healthyPlaySec >= 30) {
                recoverAttempts = 0
                healthyPlaySec = 0
              }
            }
            if (listenedSec - lastPersistedListenedSec >= 30) {
              persistListeningSession()
            }
          }
          listenedPrevT = t
        }

        // timeupdate 期间再尝试补全 duration（有些服务器流在播放中才返回有效 duration）
        if (usePlayerStore.getState().duration <= 0) {
          updateDuration()
        }
      }

      const onBufferProgress = () => {
        // 缓冲增长后 seekable 可能已覆盖恢复点，重试恢复中断位置
        if (pendingRecoverTime !== null) applyPendingRecover()
        if (audio.buffered.length > 0) {
          const bufferedEnd = audio.buffered.end(audio.buffered.length - 1)
          // 流媒体场景 audio.duration 可能长期为 Infinity，此时回退到 store/song 元数据时长计算缓冲比例
          const state = usePlayerStore.getState()
          const dur = getFiniteDuration(audio) ?? state.duration ?? capturedSong.duration ?? 0
          if (dur > 0) {
            usePlayerStore.getState().setBuffered(Math.max(0, Math.min(1, bufferedEnd / dur)))
          }
        }
      }

      /**
       * canplay / canplaythrough：
       * 不使用 flag，每次都检查 store 中的 isPlaying 状态决定是否播放
       * 这样切歌无论顺序如何都能正确自动播放
       */
      const tryPlay = () => {
        updateDuration()
        // 恢复中断位置（带 seekable 就绪检查，未就绪会在后续事件里重试）
        applyPendingRecover()
        // 音频已就绪，恢复图片加载
        usePlayerStore.getState().setStreamBuffering(false)
        if (usePlayerStore.getState().isPlaying && audio.paused) {
          audio.play().then(() => {
            // play success
          }).catch(e => {
            // AbortError 通常是因为紧接着又切歌了，忽略
            if (e.name !== 'AbortError') {
              console.error('[AudioEngine] play() rejected:', e.message)
            }
          })
        }
      }

      /*
       * 精确播放上报（阶段 6.3）：Jellyfin 的会话生命周期——start 开会话、
       * progress 喂断点、stop 关会话。有 reportPlayback 的适配器走这条链
       * （scrobble(false) 的 Sessions/Playing 就不再发，避免开会话两次）；
       * 没有的照旧只发 now-playing。上报失败不影响播放。
       */
      const preciseReporter = getAdapterFor(capturedServerId).reportPlayback
      const reportPrecise = (
        event: 'start' | 'progress' | 'stop',
        positionMs: number,
        isPaused = false
      ) => {
        if (!preciseReporter) return
        void preciseReporter.call(getAdapterFor(capturedServerId), capturedSongId, {
          positionMs, isPaused, event,
        }).catch(() => { /* 会话上报是尽力而为 */ })
      }

      const onPlay = () => {
        usePlayerStore.getState().resume()
        startListeningSession(capturedSong, capturedServerId)
        // now-playing 通知在真正开始播放时才发送一次
        // （启动时 rehydrate 的歌只加载不播放，不应上报）
        if (!nowPlayingSent && playStatKey === capturedKey) {
          nowPlayingSent = true
          if (preciseReporter) {
            reportPrecise('start', 0)
          } else {
            void getAdapterFor(capturedServerId).scrobble(capturedSongId, false).catch(error => {
              nowPlayingSent = false
              console.warn('[AudioEngine] now-playing report failed; will retry:', error)
            })
          }
        } else if (nowPlayingSent && preciseReporter) {
          /* 暂停后恢复（复审 B5）：续上会话的进度与播放态，服务器才不再
             把它当「已暂停」 */
          reportPrecise('progress', Math.max(0, audio.currentTime * 1000), false)
        }
      }

      const onPause = () => {
        // 「放完存货」途中元素停了：存货真的见底（或已放完）才是要重连；
        // 存货还多却停了，是系统（来电、Siri、AirPods 摘下）或用户停的——照常同步暂停，等恢复播放后看门狗接着盯
        if (rideOut && usePlayerStore.getState().isPlaying && (audio.ended || bufferedAheadSec(audio, audio.currentTime) < RIDE_OUT_RECONNECT_SEC)) {
          const code = rideOut.code
          rideOut = null
          finishRideOut(code)
          return
        }
        /**
         * 耳机拔出 / 系统打断（电话来电等）会触发 audio pause 事件，
         * 但此时 store 仍认为 isPlaying=true，导致按钮状态与实际不符。
         * 判断规则：audio 真实暂停 且 非播放结束 且 非切歌导致的 load abort
         * —— 满足时同步 store 为暂停，这样按钮状态、重新接入耳机后的恢复都能正确工作。
         */
        if (!audio.ended && !isSwitchingSong && usePlayerStore.getState().isPlaying) {
          notePauseReason('element', document.visibilityState === 'hidden' ? 'while hidden (locked / background)' : 'while visible')
          usePlayerStore.getState().pause()
        }
        /* 暂停也要上报（6.3）：服务器那边的「正在播放」状态才停得下来 */
        if (nowPlayingSent) reportPrecise('progress', Math.max(0, audio.currentTime * 1000), true)
      }

      /**
       * 转码流 / 错误 duration：真实样本已播完但 duration 偏大 → 不触发 ended、进度卡住。
       * 仅在「接近曲目结尾 + 缓冲已到尾 + currentTime 连续约 3s 不变」时视为自然结束。
       */
      let stallWatchInterval: ReturnType<typeof setInterval> | null = null
      let stallPrevT = -1
      let stallSinceMs: number | null = null
      const STALL_ADVANCE_MS = 5000
      /** 中途（非结尾）缓冲耗尽的停滞：多等一会儿再保位重载，给浏览器自愈机会 */
      const MID_STALL_RELOAD_MS = 8000

      /*
       * 网络断了、缓冲里还有存货：先把存货放完，快到头了再重连（「放完存货」）。
       *
       * 以前流一报网络错误（code 2）就动手：断网就暂停，在线就马上保位重载。可这时当前位置往后
       * 常常还缓冲着几十秒，浏览器本来能接着放——于是用户看到的是「缓冲明明有余量，却自己停了」。
       * 现在：还有 ≥ 4 秒存货就先放着；剩不到 2.5 秒、或者位置 1.5 秒不动了，再走原来的恢复
       * （断网就停下等网，在线就保位重载）。存货不够 4 秒的照旧立刻恢复。
       */
      const RIDE_OUT_MIN_SEC = 4
      const RIDE_OUT_RECONNECT_SEC = 2.5

      /*
       * 倒带重置（6.12；复审 A5 补全）：第二遍是一条新的收听——
       * 看门狗/恢复计数之外，还要清落盘时长（listenedSec/listenedPrevT，
       * 否则第 2 遍起时长逐遍累计）与 scrobble 退避（scrobbleAttempts/
       * scrobbleRetryAt，否则循环 5 遍后 scrobble 永久停摆、
       * 每遍开头也不会立刻重报）。
       */
      onRepeatRewind = () => {
        healthyPlaySec = 0
        recoverAttempts = 0
        stallPrevT = -1
        stallSinceMs = null
        listenedSec = 0
        listenedPrevT = -1
        scrobbleAttempts = 0
        scrobbleRetryAt = 0
      }

      const clearStallWatch = () => {
        if (stallWatchInterval !== null) {
          clearInterval(stallWatchInterval)
          stallWatchInterval = null
        }
        stallPrevT = -1
        stallSinceMs = null
      }

      const onEnded = () => {
        // NAS/转码流中途断流时，浏览器会把已收到的数据当作完整曲目而提前触发 ended。
        // 与真实播完区分：距元数据时长还差很多（>20s 且 <90%）时按网络中断处理，
        // 保位重载续播，而不是 next() —— 否则单曲循环/单曲队列下会从头重播。
        // 注意此分支不能清掉停滞看门狗：恢复后的流仍需监护
        const metaDur = capturedSong.duration || 0
        const endT = bestKnownTime()
        if (isPrematureEnd(endT, metaDur) && recoverAttempts < maxRecoverAttempts) {
          recoverAttempts += 1
          healthyPlaySec = 0
          reloadForRecovery(
            audio.currentSrc || streamUrl,
            800,
            `Premature ended at ${Math.round(endT)}/${Math.round(metaDur)}s`
          )
          return
        }
        clearStallWatch()
        if (nowPlayingSent) reportPrecise('stop', Math.max(0, bestKnownTime() * 1000))
        /*
         * 先快照、先结账，再切歌（阶段 3.7；复核 F10 改快照制）：
         * 把会话**数据**同步拍下来、阈值提交同步做完、立刻 reset 给下一首
         * 让位，然后才 advance。此前把 persist 后推到 advance 之后、靠
         * 闭包读模块变量——只要真正被推迟到新 doLoad 之后（effect 微任务），
         * listenedSec 已被清零，落盘就成了空会话。快照在任何时序下都安全。
         */
        const endedSnapshot = captureListeningSession()
        maybeSubmitPlay()
        resetListeningSession()
        usePlayerStore.getState().advanceOnEnded()
        persistSessionSnapshot(endedSnapshot, 'completed')
      }

      stallWatchInterval = setInterval(() => {
        const st = usePlayerStore.getState()
        if (!st.isPlaying || audio.paused || audio.ended) {
          stallPrevT = -1
          stallSinceMs = null
          return
        }
        if (st.currentSong?.id !== capturedSongId) return

        if (rideOut) {
          const now = performance.now()
          const at = audio.currentTime
          // 整首都已经缓冲完：不必重连，放完自然结束（ended 照常切下一首）
          const fullDur = getFiniteDuration(audio) ?? capturedSong.duration ?? 0
          if (fullDur > 0 && at + bufferedAheadSec(audio, at) >= fullDur - 0.5) {
            rideOut = null
            return
          }
          if (Math.abs(at - rideOut.lastT) > 0.04) {
            rideOut.lastT = at
            rideOut.lastMoveAt = now
          }
          if (bufferedAheadSec(audio, at) < RIDE_OUT_RECONNECT_SEC || now - rideOut.lastMoveAt > 1500) {
            const code = rideOut.code
            rideOut = null
            finishRideOut(code)
          }
          return
        }

        const t = audio.currentTime
        if (stallPrevT < 0) {
          stallPrevT = t
          stallSinceMs = null
          return
        }
        if (Math.abs(t - stallPrevT) > 0.04) {
          stallPrevT = t
          stallSinceMs = null
          return
        }
        if (stallSinceMs === null) {
          stallSinceMs = performance.now()
          return
        }
        if (performance.now() - stallSinceMs < STALL_ADVANCE_MS) return

        if (!isAtBufferedTail(audio, t)) {
          stallSinceMs = null
          return
        }

        const songDur = capturedSong.duration || 0
        const audioDur = getFiniteDuration(audio) ?? st.duration ?? 0
        const refDur = Math.max(songDur, audioDur)

        // 仅在「有可靠时长且接近结尾」时才允许自动推进，避免 duration 缺失导致误判从头播
        if (isNearEndOfTrack(t, refDur)) {
          console.warn(
            '[AudioEngine] Stalled at buffer tail near end (metadata longer than stream); advancing next()',
            { currentTime: t, songDur, audioDur }
          )
          clearStallWatch()
          persistListeningSession('completed')
          resetListeningSession()
          st.advanceOnEnded()
          return
        }

        // 中途停滞（NAS 断流/转码停摆，且未触发 error 事件）：
        // 再多等到 8s 无进展后保位重载续播，而不是无限静音
        if (performance.now() - stallSinceMs < MID_STALL_RELOAD_MS) return
        if (recoverAttempts >= maxRecoverAttempts) {
          stallSinceMs = null
          return
        }
        recoverAttempts += 1
        healthyPlaySec = 0
        stallSinceMs = null
        stallPrevT = -1
        reloadForRecovery(
          audio.currentSrc || streamUrl,
          0,
          `Mid-song stall at buffer tail (t=${Math.round(t)}s)`
        )
      }, 900)

      /*
       * 断网恢复（阶段 3.11；复核 F5 修三处）：离线期间的失败不是流坏了——
       * 不消耗恢复次数，暂停并等 online（5 分钟内）从原位置续播。
       * ① 只 pause 不 resume：联网后 onBack 只重载不续播，得手动点播放——
       *   现在签发离线令牌，联网时令牌仍有效就 resume；
       * ② 超出 5 分钟窗口直接 return：之后点播放没反应（audio 已错死）——
       *   现在置 needsReloadOnPlay，把方向盘还给用户；
       * ③ cleanup 不摘 online 监听：切歌后旧闭包还挂在 window 上——
       *   现在由 effect cleanup 负责摘。
       */
      let offlineOnlineHandler: (() => void) | null = null
      const handleOfflineError = (): boolean => {
        if (typeof navigator !== 'undefined' && navigator.onLine) return false
        const token = ++offlineResumeToken
        engineInitiatedPause = true
        notePauseReason('offline')
        usePlayerStore.getState().pause()
        const onBack = () => {
          offlineOnlineHandler = null
          window.removeEventListener('online', onBack)
          if (performance.now() - offlineAtMs > 5 * 60 * 1000) {
            // 超窗不再抢方向盘，但要让「点播放」有反应：流已错死，重载才播得动
            needsReloadOnPlay = true
            return
          }
          if (offlineResumeToken !== token) return // 用户动过播放/暂停，听用户的
          const stillSame = usePlayerStore.getState().currentSong?.id === capturedSongId
          if (!stillSame) return
          /* reloadForRecovery 自带 seek 恢复点（bestKnownTime）并把 store 的播放
           * 意图亮回来；canplay → tryPlay 看见 isPlaying 自然续播 */
          usePlayerStore.getState().resume()
          reloadForRecovery(audio.currentSrc || streamUrl, 400, 'Network back online')
        }
        const offlineAtMs = performance.now()
        offlineOnlineHandler = onBack
        window.addEventListener('online', onBack)
        return true
      }

      const onError = () => {
        const err = audio.error
        // WebKit/Safari 部分版本把标准 MediaError code 报成负数（如 -4）
        const rawCode = err?.code ?? 0
        const code = rawCode < 0 ? -rawCode : rawCode

        // code=1 是 load() 中止旧播放，不是真正错误
        if (code === 1) return
        // 网络错误、缓冲里还有存货：先放完存货再说（见 RIDE_OUT_MIN_SEC）
        if (code === 2 && !rideOut && !audio.paused && bufferedAheadSec(audio, audio.currentTime) >= RIDE_OUT_MIN_SEC) {
          const at = audio.currentTime
          rideOut = { code: rawCode, lastT: at, lastMoveAt: performance.now() }
          console.warn('[AudioEngine] network error with', Math.round(bufferedAheadSec(audio, at)), 's still buffered — playing on, reconnecting near the end of it')
          return
        }
        if (rideOut) return
        recoverFromError(rawCode, code)
      }

      /** 网络 / 解码 / 源不可用三类错误的恢复：断网就停下等网，否则按策略保位重载；次数用完才报错停下 */
      const recoverFromError = (rawCode: number, code: number, immediate = false) => {
        const err = audio.error
        /** 放完存货再来恢复时不必再等：错误早就发生过了 */
        const wait = (ms: number) => (immediate ? 0 : ms)
        // 离线：挂起等网，不消耗恢复次数（阶段 3.11）。
        // code 4 也先查离线（复核 F5）：开播前取流失败常报 src not supported (4)，
        // 离线时它同样是「没网」而不是「流坏了」，不该烧恢复次数
        if ((code === 2 || code === 4) && handleOfflineError()) return

        // 网络错误(2) / 解码失败(3，转码流坏块常见) / 音频源不可用(4)：
        // 按策略恢复（见文件头 206 vs code 4 说明）。恢复点由 reloadForRecovery
        // 取 bestKnownTime —— 绝不能只看 store/audio 的 currentTime：
        // 重载会把两者复位到 0，若恢复期间再次出错，就会把恢复点覆盖为 0 导致从头重播
        if (recoverAttempts < maxRecoverAttempts && (code === 2 || code === 3 || code === 4)) {
          const activeUrl = audio.currentSrc || streamUrl
          let adapter: ReturnType<typeof getAdapterFor> | null = null
          try {
            adapter = getAdapterFor(capturedServerId)
          } catch {
            adapter = null
          }

          // 异步取流型（插件音源）：第一次恢复先绕过缓存重取一次新地址——
          // 这类 URL 常是短时效签名链接，原样重载多半还是同一个错
          if (adapter?.resolveStreamUrl) {
            recoverAttempts += 1
            healthyPlaySec = 0
            if (recoverAttempts === 1) {
              void resolveStream(capturedSong, effectiveQuality, { skipCache: true })
                .then(fresh => {
                  if (loadedKey !== capturedKey) return
                  reloadForRecovery(fresh.url, wait(1000), `Recovery 1/${maxRecoverAttempts}: refetched stream after code ${rawCode}`)
                })
                .catch(() => {
                  if (loadedKey !== capturedKey) return
                  // 重取也失败：退回原地址重载一次，别比现有的同步路径恢复力更差
                  reloadForRecovery(activeUrl, wait(1000), `Recovery 1/${maxRecoverAttempts}: refetch failed, retrying same URL after code ${rawCode}`)
                })
              return
            }
            reloadForRecovery(activeUrl, wait(600), `Recovery ${recoverAttempts}/${maxRecoverAttempts} after code ${rawCode}`)
            return
          }

          // 同步直链（Subsonic 系）：维持原有格式回退——只对 URL 带 format
          // 参数的转码流有意义；异步源的 URL 是不透明串，不走这段
          let retryUrl = activeUrl
          try {
            const u = new URL(activeUrl, typeof window !== 'undefined' ? window.location.href : undefined)
            const fmt = u.searchParams.get('format')

            if (maxBitrate === 0 && adapter) {
              if (recoverAttempts === 0) {
                if (!fmt) {
                  retryUrl = adapter.getStreamUrl(
                    capturedSongId,
                    0,
                    'flac',
                    contentType,
                    capturedSong.path,
                    capturedSong.suffix
                  )
                  console.warn('[AudioEngine] Retrying with format=flac (first URL had no format param)')
                } else if (fmt === 'flac' && (code === 4 || code === 3)) {
                  retryUrl = adapter.getStreamUrl(
                    capturedSongId,
                    320,
                    'mp3',
                    contentType,
                    capturedSong.path,
                    capturedSong.suffix
                  )
                  console.warn(
                    '[AudioEngine] Retrying as MP3: browser rejected FLAC transcode (Network may still show 206)'
                  )
                }
              } else if (recoverAttempts === 1 && fmt === 'flac' && (code === 4 || code === 3)) {
                retryUrl = adapter.getStreamUrl(
                  capturedSongId,
                  320,
                  'mp3',
                  contentType,
                  capturedSong.path,
                  capturedSong.suffix
                )
                console.warn('[AudioEngine] Second recovery: MP3 after FLAC transcode failed')
              }
            }
          } catch {
            retryUrl = streamUrl
          }

          recoverAttempts += 1
          healthyPlaySec = 0
          reloadForRecovery(
            retryUrl,
            wait(recoverAttempts === 1 ? 1000 : 600),
            `Recovery ${recoverAttempts}/${maxRecoverAttempts} after code ${rawCode}`
          )
          return
        }

        const errMsg = {
          1: t('player.error.aborted'),
          2: t('player.error.network'),
          3: t('player.error.decode'),
          4: t('player.error.unsupported'),
        }[code] ?? t('error.unknown')
        // 流地址带着 t= / s=（密码 MD5 与 salt），原样打进控制台等于把凭据
        // 留在那里——用户复制日志求助时会一起带出去。
        console.error('[AudioEngine] audio error:', rawCode, err?.message, '| URL:', redactUrl(streamUrl))
        toast({
          title: t('player.error.title', { message: errMsg }),
          // 标题抽了 i18n、说明句留着中文模板，等于给英文用户一条半中半英的报错。
          // URL 不进译文：它是诊断信息，不该被翻译，也不该被断句规则改动。
          description: t('player.error.detail', {
            code: rawCode,
            message: err?.message ? ` ${err.message}` : '',
          }) + `\n${redactUrl(streamUrl).substring(0, 120)}...`,
          variant: 'destructive',
        })
        usePlayerStore.getState().setStreamBuffering(false)
        persistListeningSession()
        notePauseReason('error', `media error ${rawCode}`)
        usePlayerStore.getState().pause()
      }

      /** 存货放完了（或者位置不动了）：走这次网络错误本来该走的恢复 */
      const finishRideOut = (rawCode: number) => {
        if (loadedKey !== capturedKey) return
        recoverFromError(rawCode, rawCode < 0 ? -rawCode : rawCode, true)
      }

      const onWaiting = () => {
        // 网络等待时不需要特殊处理，audio 会自动恢复
      }

      audio.addEventListener('loadedmetadata', onLoadedMetadata)
      audio.addEventListener('durationchange', onDurationChange)
      audio.addEventListener('timeupdate', onTimeUpdate)
      audio.addEventListener('progress', onBufferProgress)
      audio.addEventListener('canplay', tryPlay)
      audio.addEventListener('canplaythrough', tryPlay)
      audio.addEventListener('play', onPlay)
      audio.addEventListener('pause', onPause)
      audio.addEventListener('ended', onEnded)
      audio.addEventListener('error', onError)
      audio.addEventListener('waiting', onWaiting)

      if (!reattachOnly) {
        // ── 释放连接池：确保 audio stream 获得最高优先级 ──
        // 第 1 层：DOM 层 — 立即中止所有未完成的 <img> HTTP 请求（0 延迟）
        abortPendingImageLoads()
        // 第 2 层：TanStack Query 层 — 仅取消非活跃封面请求，避免误杀当前详情页正在加载的封面
        queryClient.cancelQueries({ queryKey: ['custom-cover'], type: 'inactive' }).catch(() => {})
        // 第 3 层：React 状态层 — 阻止后续 React 渲染重新发起图片请求
        usePlayerStore.getState().setStreamBuffering(true)

        audio.src = streamUrl
        audio.volume = targetVolume()
        audio.load()

        // 音质切换属于同一次收听，保留累计时长和 eventId；真正切歌才结算旧会话。
        const continuingQualitySwitch =
          qualitySwitchResumeAt !== null &&
          playEventSong?.id === capturedSongId &&
          playEventServerId === capturedServerId
        if (!continuingQualitySwitch) {
          persistListeningSession()
          resetListeningSession()
          listenedSec = 0
          listenedPrevT = -1
          nowPlayingSent = false
          playSubmitted = false
        } else {
          listenedPrevT = qualitySwitchResumeAt ?? -1
        }
        playStatKey = capturedKey

        // 恢复状态归本次加载：音质切换重载时带上切换前位置，其余从头开始
        recoverAttempts = 0
        recoverSeekAttempts = 0
        pendingRecoverTime =
          qualitySwitchResumeAt !== null && qualitySwitchResumeAt > 1
            ? qualitySwitchResumeAt
            : null
        lastPlaybackPos = qualitySwitchResumeAt ?? 0
        lastPlaybackKey = capturedKey

        // 如果应该播放但 audio 还没 canplay，先标记 isPlaying=true，等 canplay 触发
        const shouldPlay = usePlayerStore.getState().isPlaying
        if (shouldPlay) {
          usePlayerStore.getState().resume()
        }
      } else {
        // reattach：仅当元素仍可播放时才「只重挂监听」。
        // 若 src 已被清（切歌中断残留）或元素已进入错误态（监听缺席期间出错），
        // 光重挂监听会永远静音 —— 且后续 error 事件会把歌从头重播。
        // 此时降级为「保位重载」：恢复 src 并 seek 回最近位置
        const attrSrc = audio.getAttribute('src') || ''
        if (!attrSrc || audio.error !== null) {
          reloadForRecovery(streamUrl, 0, 'Reattach found dead element (no src or errored)')
        }
      }

      /*
       * 复审 B5：会话 stop 不在 cleanup 里发——cleanup 在 reattach/音质切换
       * 时也会跑，会话被拦腰关掉。关闭动作挂到模块级 closeSessionPrev，
       * 由「真的换歌 / 卸载」的路径显式调用。
       */
      closeSessionPrev = () => {
        if (nowPlayingSent && !audio.ended) {
          reportPrecise('stop', Math.max(0, bestKnownTime() * 1000))
        }
      }
      const cleanup = () => {
        onRepeatRewind = null
        /* closeSessionPrev 不在这里清空：React 依赖变化的 cleanup 先于新
           effect 体执行，这里清了它，新 body 就没法按 base 判断关会话 */
        clearStallWatch()
        /* 离线等待的 online 监听也要摘（复核 F5③）：旧闭包挂着，
           切歌后网络一恢复就会拿旧 audio 元素抢方向盘 */
        if (offlineOnlineHandler) {
          window.removeEventListener('online', offlineOnlineHandler)
          offlineOnlineHandler = null
        }
        audio.removeEventListener('loadedmetadata', onLoadedMetadata)
        audio.removeEventListener('durationchange', onDurationChange)
        audio.removeEventListener('timeupdate', onTimeUpdate)
        audio.removeEventListener('progress', onBufferProgress)
        audio.removeEventListener('canplay', tryPlay)
        audio.removeEventListener('canplaythrough', tryPlay)
        audio.removeEventListener('play', onPlay)
        audio.removeEventListener('pause', onPause)
        audio.removeEventListener('ended', onEnded)
        audio.removeEventListener('error', onError)
        audio.removeEventListener('waiting', onWaiting)
      }
      cleanupPrev = cleanup
    }

    // 同 key 已加载：监听存活则直接跳过；
    // 监听被 cleanup 移除过（如 isConnected 抖动、依赖变化）则仅重挂监听，
    // 不重置 src/进度 —— 否则收藏、重连等同曲重跑会导致从头重播
    if (loadedKey === currentKey) {
      if (cleanupPrev) return
      doLoad(true)
      return
    }

    // 清除上一个待执行的加载 debounce（连续切歌时，丢弃中间的加载请求）
    if (loadDebounceTimer !== null) {
      clearTimeout(loadDebounceTimer)
      loadDebounceTimer = null
    }

    const isFirstPlay = loadedKey === null

    // 换歌时清预热（阶段 6.13）：旧歌的「下一首」对新队列没有意义，
    // 留着它等于后台继续拉一首没人要的流
    if (!isFirstPlay && preloadEl.getAttribute('src')) {
      preloadEl.pause()
      preloadEl.removeAttribute('src')
      preloadEl.load()
    }

    if (!isFirstPlay && loadedKey) {
      // 识别「同曲同版本、仅音质变化」的重载（loadedKey 格式 songId@quality@version，
      // songId 可能含 @，从右侧解析）：这类重载必须保位续播，不能从头重播。
      // playVersion 相同说明不是用户切歌/重播（那些都会 bump version）
      const parsed = parseLoadedKey(loadedKey)
      if (
        parsed &&
        parsed.base === `${songServer}:${songId}` &&
        parsed.version === String(playVersion) &&
        parsed.quality !== effectiveQuality
      ) {
        const st = usePlayerStore.getState()
        qualitySwitchResumeAt = Math.max(
          st.currentTime || 0,
          isFinite(audioEl.currentTime) ? audioEl.currentTime : 0,
          lastPlaybackKey === loadedKey ? lastPlaybackPos : 0
        )
      }
    }

    if (!isFirstPlay) {
      // 非首次播放：停止旧音频、标记切歌防止 onPause 误同步。
      // 会话 stop 只在「真的换了歌」时发：同 base 的重载（音质切换/
      // reattach）继续用原会话（复审 B5）
      const prevBase = loadedKey ? parseLoadedKey(loadedKey)?.base : null
      const nextBase = parseLoadedKey(currentKey)?.base
      if (prevBase !== nextBase) {
        closeSessionPrev?.()
        closeSessionPrev = null
      }
      if (cleanupPrev) { cleanupPrev(); cleanupPrev = null }
      isSwitchingSong = true
      audioEl.pause()
      audioEl.src = ''
      setTimeout(() => { isSwitchingSong = false }, LOAD_DEBOUNCE_MS + 50)
    }

    // 重置进度（音质切换保留原位置），用服务器返回的 duration 作为初始值（避免进度条为 0）
    usePlayerStore.getState().setCurrentTime(qualitySwitchResumeAt ?? 0)
    usePlayerStore.getState().setBuffered(0)
    const knownDurationEarly = activeSong.duration ?? 0
    usePlayerStore.getState().setDuration(knownDurationEarly > 0 ? knownDurationEarly : 0)

    if (isFirstPlay) {
      // 首次播放：同步执行，不经过 setTimeout（消除 macrotask 排队延迟）
      lastLoadScheduledAt = performance.now()
      doLoad()
    } else if (performance.now() - lastLoadScheduledAt < LOAD_DEBOUNCE_MS) {
      /*
       * 连击窗口内只保留最后一次（复核 F10）：窗口锚在「上次调度」上，
       * 定时器随每次点击重置——连点 5 次只有静默后的最后一次真正取流。
       * 旧实现锚在「上次加载开始」，排定中的加载还没开始、时间戳还是旧的，
       * 第 3 次连点就判成「不是连击」立即加载（5 连点发 3 次取流）。
       */
      lastLoadScheduledAt = performance.now()
      if (loadDebounceTimer !== null) clearTimeout(loadDebounceTimer)
      loadDebounceTimer = setTimeout(() => {
        loadDebounceTimer = null
        doLoad()
      }, LOAD_DEBOUNCE_MS)
    } else {
      // 距上次切歌超过 debounce 窗口（阶段 3.7）：这不是连击，立即加载
      lastLoadScheduledAt = performance.now()
      doLoad()
    }

    // React effect 清理：组件卸载或依赖变化时，取消未执行的 debounce 并清理事件
    return () => {
      if (loadDebounceTimer !== null) {
        clearTimeout(loadDebounceTimer)
        loadDebounceTimer = null
      }
      /* 依赖变化必然重跑 effect（reattach/重载）：会话不关；
         真切歌在 effect 体内按 base 判断发 stop（复审 B5） */
      if (cleanupPrev) { cleanupPrev(false); cleanupPrev = null }
    }

    // 依赖歌曲 id 而非对象引用：updateCurrentSong（如收藏切换）只替换引用不换歌，
    // 不应触发本 effect，否则会 cleanup 后重载导致从头重播
  }, [currentSongId, playVersion, isConnected, activeServerId, startupConnectSettled, effectiveQuality, queryClient, targetVolume])

  // MainLayout 卸载（登出/断开连接）时模块级 Audio 仍会存活，必须显式停止。
  useEffect(() => () => {
    persistListeningSession()
    resetListeningSession()
    if (loadDebounceTimer !== null) {
      clearTimeout(loadDebounceTimer)
      loadDebounceTimer = null
    }
    closeSessionPrev?.()
    closeSessionPrev = null
    if (cleanupPrev) { cleanupPrev(); cleanupPrev = null }
    audioEl.pause()
    audioEl.src = ''
    loadedKey = null
  }, [])

  // 播放诊断：每次 isPlaying 由真变假，记下是谁停的、当时 <audio> 什么状态（见 lib/playbackTrail）
  useEffect(() => usePlayerStore.subscribe((state, prev) => {
    if (prev.isPlaying && !state.isPlaying) recordPause(readPauseContext(audioEl), prev.currentSong?.title)
    else if (!prev.isPlaying && state.isPlaying) clearPauseReason()
  }), [])

  // --- 播放/暂停控制 ---
  useEffect(() => {
    // 离线令牌的作废点（复核 F5）：isPlaying 的翻转若非引擎自己发起，
    // 就是用户（或 UI）动了播放/暂停——离线期间的自动续播不再抢方向盘。
    if (engineInitiatedPause) engineInitiatedPause = false
    else offlineResumeToken = 0
    if (isPlaying) {
      // 渐弱期间元素还没真正 pause，audioEl.paused 仍是 false。
      // 若此时用户又按了播放，必须先取消那条待执行的暂停，否则渐弱回调稍后
      // 仍会把刚恢复的播放停掉——表现为「点了播放没反应」。
      cancelRamp()
      audioEl.volume = targetVolume()
      if (!audioEl.paused) return
      // readyState < 2（HAVE_CURRENT_DATA）说明还没有足够数据，等 canplay 事件
      if (audioEl.readyState < 2) {
        /*
         * 复审 A9：只有 halt / 音质切换失败置过 needsReloadOnPlay 才重载。
         * 原先只看「无 src / 错误态」太宽——暂停态点歌、冷启动首播时
         * load effect 刚清空 src，这里也命中，多 bump 一次 playVersion、
         * 重复取流（插件源多撞一次限频）。
         */
        if (needsReloadOnPlay && usePlayerStore.getState().currentSong) {
          usePlayerStore.getState().reloadCurrent()
        }
        return
      }
      audioEl.play().catch(e => {
        if (e.name !== 'AbortError') {
          console.warn('[AudioEngine] play rejected:', e.message)
        }
      })
    } else if (!audioEl.paused) {
      // 在延音上硬停是最「像软件」的一个瞬间，用约 120ms 渐弱收尾
      rampVolume(0, 120, () => {
        // 渐弱途中状态可能已经翻回播放，此时不能再暂停
        if (usePlayerStore.getState().isPlaying) {
          audioEl.volume = targetVolume()
          return
        }
        audioEl.pause()
        audioEl.volume = targetVolume()
      })
    }
  }, [isPlaying, rampVolume, cancelRamp, targetVolume])

  /**
   * 单曲循环的倒带。
   *
   * 不走 playVersion —— 那会让 loadedKey 变化、src 重设、整首重新拉流。
   * 同一首歌循环一夜就是把它下载几百遍（服务器开了转码还要重转几百遍）。
   * 音频已经在内存里，倒回开头即可。
   *
   * 跳过首帧：初始值 0 不代表发生过一次循环。
   */
  const lastRepeatTokenRef = useRef(repeatSeekToken)
  useEffect(() => {
    if (repeatSeekToken === lastRepeatTokenRef.current) return
    lastRepeatTokenRef.current = repeatSeekToken
    /*
     * 第二遍起是一条新的收听（阶段 6.12 修正）：
     * - onEnded 已把上一遍记成 completed 并结算，这里开新会话；
     * - playSubmitted 复位，scrobble 每一遍都报（原来第二遍起永远不报）；
     * - 闭包里的看门狗/恢复计数经 onRepeatRewind 归零。
     */
    playSubmitted = false
    onRepeatRewind?.()
    const song = usePlayerStore.getState().currentSong
    if (song) startListeningSession(song, songServerId(song))
    audioEl.currentTime = 0
    if (usePlayerStore.getState().isPlaying) {
      void audioEl.play().catch(() => {})
    }
  }, [repeatSeekToken])

  // --- 音量（含 ReplayGain 归一化与睡眠渐弱）---
  const sleepFadeScalar = usePlayerStore(s => s.sleepFadeScalar)
  useEffect(() => {
    audioEl.volume = targetVolume()
  }, [volume, muted, replayGainMode, replayGainPreamp, currentSongId, sleepFadeScalar, targetVolume])

  // --- 倍速播放：有声书 / 讲座 / 广播剧 ---
  useEffect(() => {
    // defaultPlaybackRate 才是 load() 之后被恢复的那个值。只设 playbackRate 的话，
    // 每次切歌 / 错误重载 / 音质切换都会把速度悄悄打回 1×，设置页却还显示 2×。
    audioEl.defaultPlaybackRate = playbackRate
    audioEl.playbackRate = playbackRate
    // 变调补偿，避免倍速下变成花栗鼠
    audioEl.preservesPitch = true
  }, [playbackRate, currentSongId, playVersion])

}
