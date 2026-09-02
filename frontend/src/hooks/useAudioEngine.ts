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
import { toast } from '@/components/ui/use-toast'
import type { Song } from '@/api/types'
import { computeReplayGainScalar } from '@/utils/replayGain'
import { isMeteredConnection, onConnectionChange } from '@/lib/network'
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
  getFiniteDuration,
  isAtBufferedTail,
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
  }
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
}

/**
 * 异步加载序号：resolveStream await 期间可能已经切歌，
 * 晚到的结果（含它要写的 audio.src）必须作废。
 */
let loadSeq = 0

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
let cleanupPrev: (() => void) | null = null
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
  if (!playEventId || !playEventSong || !playEventServerId || listenedSec < 1) return
  const duration = Math.max(0, playEventSong.duration || 0)
  const outcome = outcomeOverride ?? deriveListeningOutcome(listenedSec, duration)
  upsertListeningEvent({
    version: 2,
    eventId: playEventId,
    serverId: playEventServerId,
    song: playEventSong,
    startedAt: playEventStartedAt || Date.now() - listenedSec * 1000,
    endedAt: Date.now(),
    listenedSeconds: Math.round(listenedSec * 10) / 10,
    completionRate: duration > 0 ? Math.max(0, Math.min(1, listenedSec / duration)) : 0,
    outcome,
  })
  lastPersistedListenedSec = listenedSec
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
  const isPlaying   = usePlayerStore(s => s.isPlaying)
  const volume      = usePlayerStore(s => s.volume)
  const muted       = usePlayerStore(s => s.muted)
  const isConnected = useServerStore(s => s.isConnected)
  const activeServerId = useServerStore(s => s.activeServerId)
  const audioQuality = useSettingsStore(s => s.audioQuality)
  const cellularAudioQuality = useSettingsStore(s => s.cellularAudioQuality)
  const adaptiveQuality = useSettingsStore(s => s.adaptiveQuality)
  const playVersion  = usePlayerStore(s => s.playVersion)
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
    if (!song || !currentSongId) return
    if (bookmarkAppliedRef.current.has(currentSongId)) return
    const position = song.ext?.bookmarkPosition
    if (!position || (song.duration ?? 0) < 20 * 60) return
    // 距离结尾太近就不必续了
    if (song.duration - position / 1000 < 30) return
    bookmarkAppliedRef.current.add(currentSongId)

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
      if (usePlayerStore.getState().currentSong?.id !== currentSongId) return
      attempts += 1
      seekHowl(seconds)
      if (Math.abs(audioEl.currentTime - seconds) > 2 && attempts < 12) {
        timer = setTimeout(trySeek, 250)
      }
    }
    timer = setTimeout(trySeek, 500)
    return () => { if (timer) clearTimeout(timer) }
  }, [currentSongId])

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
    if (!preloadNext || !isPlaying || metered) return
    const timer = setInterval(() => {
      const st = usePlayerStore.getState()
      const remaining = (st.duration || 0) - (st.currentTime || 0)
      // 剩 15 秒内才预热，早了会和当前曲抢连接
      if (!st.duration || remaining > 15 || remaining <= 0) return
      const nextSong = peekNextSong(st)
      if (!nextSong || nextSong.id === preloadedIdRef.current) return
      if (!hasAdapterFor(songServerId(nextSong))) return
      preloadedIdRef.current = nextSong.id
      // 预热同样走 resolveStream：命中未过期的地址（含刚解析过的）直接用，
      // 预热的地址到正式加载时若已过期，加载路径会重取
      resolveStream(nextSong, effectiveQuality)
        .then(resolved => {
          // resolve 期间队列可能已经变化：预热错了歌比不预热更糟
          if (peekNextSong(usePlayerStore.getState())?.id !== nextSong.id) return
          preloadEl.src = resolved.url
          preloadEl.load()
        })
        .catch(() => {
          // 预热失败无所谓，正常加载路径会再拉一次
        })
    }, 2000)
    return () => clearInterval(timer)
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

    // 队列允许混源：加载只看这首歌自己的来源是否连着，不看主库是谁
    const songServer = songServerId(activeSong)
    if (!isConnected || !hasAdapterFor(songServer)) {
      persistListeningSession()
      resetListeningSession()
      if (cleanupPrev) { cleanupPrev(); cleanupPrev = null }
      audioEl.pause()
      audioEl.src = ''
      loadedKey = null
      usePlayerStore.getState().setStreamBuffering(false)
      return
    }

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

    // 首次播放不需要 debounce（没有旧音频要中断），后续切歌才 debounce 吸收连续点击
    // reattachOnly=true：同 key 重挂监听（依赖变化触发过 cleanup 后），
    // 绝不能触碰 audioEl.src / currentTime，否则正在播放的歌会从头重播
    const doLoad = async (reattachOnly = false) => {
      // 检查 store 当前状态是否还是同一首歌，避免 debounce 期间又切走了
      const latestSong = usePlayerStore.getState().currentSong
      if (!latestSong || latestSong.id !== capturedSongId) return

      // ── 实际加载逻辑 ──────────────────────────────────────────
      const maxBitrate = QUALITY_MAX_BITRATE[effectiveQuality]
      const contentType = capturedSong.contentType
      // 异步加载序号：取流 await 期间切了歌，本次加载整体作废
      const seq = ++loadSeq
      let resolved: ResolvedStream
      try {
        resolved = await resolveStream(capturedSong, effectiveQuality)
      } catch (e) {
        console.error('[AudioEngine] resolveStream failed:', e)
        usePlayerStore.getState().setStreamBuffering(false)
        return
      }
      if (seq !== loadSeq || usePlayerStore.getState().currentSong?.id !== capturedSongId) return
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

      /**
       * 保位重载当前流 — 错误恢复 / 提前 ended / 中途停滞共用：
       * 先记录恢复点（bestKnownTime），再重载；恢复点由 applyPendingRecover 在就绪后消费
       */
      const reloadForRecovery = (retryUrl: string, delayMs: number, reason: string) => {
        const resumeAt = bestKnownTime()
        if (resumeAt > 1) {
          pendingRecoverTime = resumeAt
          recoverSeekAttempts = 0
        }
        console.warn('[AudioEngine]', reason, '— reloading, resume at', Math.round(resumeAt), 's')
        const doReload = () => {
          // 延迟期间若已切歌/换加载，放弃本次恢复，避免覆盖新歌的 src
          if (loadedKey !== capturedKey) return
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

      const onPlay = () => {
        usePlayerStore.getState().resume()
        startListeningSession(capturedSong, capturedServerId)
        // now-playing 通知在真正开始播放时才发送一次
        // （启动时 rehydrate 的歌只加载不播放，不应上报）
        if (!nowPlayingSent && playStatKey === capturedKey) {
          nowPlayingSent = true
          void getAdapterFor(capturedServerId).scrobble(capturedSongId, false).catch(error => {
            nowPlayingSent = false
            console.warn('[AudioEngine] now-playing report failed; will retry:', error)
          })
        }
      }

      const onPause = () => {
        /**
         * 耳机拔出 / 系统打断（电话来电等）会触发 audio pause 事件，
         * 但此时 store 仍认为 isPlaying=true，导致按钮状态与实际不符。
         * 判断规则：audio 真实暂停 且 非播放结束 且 非切歌导致的 load abort
         * —— 满足时同步 store 为暂停，这样按钮状态、重新接入耳机后的恢复都能正确工作。
         */
        if (!audio.ended && !isSwitchingSong && usePlayerStore.getState().isPlaying) {
          usePlayerStore.getState().pause()
        }
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
        maybeSubmitPlay()
        persistListeningSession('completed')
        resetListeningSession()
        usePlayerStore.getState().advanceOnEnded()
      }

      stallWatchInterval = setInterval(() => {
        const st = usePlayerStore.getState()
        if (!st.isPlaying || audio.paused || audio.ended) {
          stallPrevT = -1
          stallSinceMs = null
          return
        }
        if (st.currentSong?.id !== capturedSongId) return

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

      const onError = () => {
        const err = audio.error
        // WebKit/Safari 部分版本把标准 MediaError code 报成负数（如 -4）
        const rawCode = err?.code ?? 0
        const code = rawCode < 0 ? -rawCode : rawCode

        // code=1 是 load() 中止旧播放，不是真正错误
        if (code === 1) return

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
                  reloadForRecovery(fresh.url, 1000, `Recovery 1/${maxRecoverAttempts}: refetched stream after code ${rawCode}`)
                })
                .catch(() => {
                  if (loadedKey !== capturedKey) return
                  // 重取也失败：退回原地址重载一次，别比现有的同步路径恢复力更差
                  reloadForRecovery(activeUrl, 1000, `Recovery 1/${maxRecoverAttempts}: refetch failed, retrying same URL after code ${rawCode}`)
                })
              return
            }
            reloadForRecovery(activeUrl, 600, `Recovery ${recoverAttempts}/${maxRecoverAttempts} after code ${rawCode}`)
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
            recoverAttempts === 1 ? 1000 : 600,
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
          }) + `\n${streamUrl.substring(0, 120)}...`,
          variant: 'destructive',
        })
        usePlayerStore.getState().setStreamBuffering(false)
        persistListeningSession()
        usePlayerStore.getState().pause()
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

      const cleanup = () => {
        clearStallWatch()
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
      // 非首次播放：停止旧音频、标记切歌防止 onPause 误同步
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
      doLoad()
    } else {
      // 后续切歌：120ms debounce 吸收连续点击
      loadDebounceTimer = setTimeout(() => {
        loadDebounceTimer = null
        doLoad()
      }, LOAD_DEBOUNCE_MS)
    }

    // React effect 清理：组件卸载或依赖变化时，取消未执行的 debounce 并清理事件
    return () => {
      if (loadDebounceTimer !== null) {
        clearTimeout(loadDebounceTimer)
        loadDebounceTimer = null
      }
      if (cleanupPrev) { cleanupPrev(); cleanupPrev = null }
    }

    // 依赖歌曲 id 而非对象引用：updateCurrentSong（如收藏切换）只替换引用不换歌，
    // 不应触发本 effect，否则会 cleanup 后重载导致从头重播
  }, [currentSongId, playVersion, isConnected, activeServerId, effectiveQuality, queryClient, targetVolume])

  // MainLayout 卸载（登出/断开连接）时模块级 Audio 仍会存活，必须显式停止。
  useEffect(() => () => {
    persistListeningSession()
    resetListeningSession()
    if (loadDebounceTimer !== null) {
      clearTimeout(loadDebounceTimer)
      loadDebounceTimer = null
    }
    if (cleanupPrev) { cleanupPrev(); cleanupPrev = null }
    audioEl.pause()
    audioEl.src = ''
    loadedKey = null
  }, [])

  // --- 播放/暂停控制 ---
  useEffect(() => {
    if (isPlaying) {
      // 渐弱期间元素还没真正 pause，audioEl.paused 仍是 false。
      // 若此时用户又按了播放，必须先取消那条待执行的暂停，否则渐弱回调稍后
      // 仍会把刚恢复的播放停掉——表现为「点了播放没反应」。
      cancelRamp()
      audioEl.volume = targetVolume()
      if (!audioEl.paused) return
      // readyState < 2（HAVE_CURRENT_DATA）说明还没有足够数据，等 canplay 事件
      if (audioEl.readyState < 2) return
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
