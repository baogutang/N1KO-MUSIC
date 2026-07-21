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

import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { usePlayerStore } from '@/store/playerStore'
import { useServerStore } from '@/store/serverStore'
import { useSettingsStore, QUALITY_MAX_BITRATE } from '@/store/settingsStore'
import { getAdapter, hasAdapter } from '@/api'
import { toast } from '@/components/ui/use-toast'

/** 本地播放历史写入（与 History.tsx 共用同一格式）*/
const HISTORY_KEY = 'msp-play-history'

/**
 * 清理 localStorage 中的封面缓存，释放配额空间
 * 当历史写入因 QuotaExceededError 失败时调用
 */
function clearCoverCache() {
  const keysToRemove: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith('msp-cover:')) keysToRemove.push(key)
  }
  keysToRemove.forEach(k => localStorage.removeItem(k))
  if (keysToRemove.length) {
    console.info('[History] cleared', keysToRemove.length, 'cover cache entries to free space')
  }
}

function recordPlayToHistory(song: ReturnType<typeof usePlayerStore.getState>['currentSong']) {
  if (!song) return
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    const history: Array<{ song: typeof song; playedAt: number }> = raw ? JSON.parse(raw) : []
    const filtered = history.filter(e => e.song?.id !== song.id)
    const updated = [{ song, playedAt: Date.now() }, ...filtered].slice(0, 500)
    const payload = JSON.stringify(updated)
    try {
      localStorage.setItem(HISTORY_KEY, payload)
    } catch {
      // QuotaExceededError：清理封面缓存后重试
      console.warn('[History] localStorage quota exceeded, clearing cover cache...')
      clearCoverCache()
      localStorage.setItem(HISTORY_KEY, payload)
    }
    // 通知订阅者（History / Stats 页面）历史已更新
    window.dispatchEvent(new CustomEvent('msp-history-updated'))
    console.info('[History] recorded:', song.title)
  } catch (e) {
    console.error('[History] failed to write localStorage:', e)
  }
}

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

/**
 * 尝试从 audio.duration 读取有效时长，返回 null 表示无法获取
 * 流媒体在未完全缓冲时 duration 为 Infinity，此时返回 null
 */
function getFiniteDuration(audio: HTMLAudioElement): number | null {
  const d = audio.duration
  if (isFinite(d) && d > 0) return d
  return null
}

/** 缓冲是否已覆盖到当前播放时间附近（后面几乎无数据）*/
function isAtBufferedTail(audio: HTMLAudioElement, currentTime: number, gapSec = 0.45): boolean {
  try {
    if (audio.buffered.length === 0) return true
    const end = audio.buffered.end(audio.buffered.length - 1)
    return end - currentTime < gapSec
  } catch {
    return true
  }
}

export function useAudioEngine() {
  const currentSong = usePlayerStore(s => s.currentSong)
  const isPlaying   = usePlayerStore(s => s.isPlaying)
  const volume      = usePlayerStore(s => s.volume)
  const muted       = usePlayerStore(s => s.muted)
  const isConnected = useServerStore(s => s.isConnected)
  const audioQuality = useSettingsStore(s => s.audioQuality)
  const playVersion  = usePlayerStore(s => s.playVersion)
  const effectiveQuality = audioQuality

  // TanStack Query 客户端 — 用于在加载音频时取消 pending 的封面请求，释放连接池
  const queryClient = useQueryClient()

  const volumeRef   = useRef(volume)
  const mutedRef    = useRef(muted)
  volumeRef.current = volume
  mutedRef.current  = muted

  // --- 核心：歌曲变化 / 连接就绪 / 音质变化 时加载音频 ---
  useEffect(() => {
    const songId = currentSong?.id ?? null

    if (!songId || !currentSong) {
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

    if (!isConnected || !hasAdapter()) {
      usePlayerStore.getState().setStreamBuffering(false)
      return
    }

    const currentKey = `${songId}@${effectiveQuality}@${playVersion}`

    // 捕获当前歌曲 id，供 debounce 内校验
    const capturedSongId = songId
    const capturedKey = currentKey
    const capturedSong = currentSong

    /**
     * 同曲同版本、仅音质变化（会员状态/音质设置变更）触发的重载：
     * 记录切换前的播放位置，加载后保位续播，不应从头重播
     */
    let qualitySwitchResumeAt: number | null = null

    // 首次播放不需要 debounce（没有旧音频要中断），后续切歌才 debounce 吸收连续点击
    // reattachOnly=true：同 key 重挂监听（依赖变化触发过 cleanup 后），
    // 绝不能触碰 audioEl.src / currentTime，否则正在播放的歌会从头重播
    const doLoad = (reattachOnly = false) => {
      // 检查 store 当前状态是否还是同一首歌，避免 debounce 期间又切走了
      const latestSong = usePlayerStore.getState().currentSong
      if (!latestSong || latestSong.id !== capturedSongId) return

      // ── 实际加载逻辑 ──────────────────────────────────────────
      const maxBitrate = QUALITY_MAX_BITRATE[effectiveQuality]
      const contentType = capturedSong.contentType
      let streamUrl: string
      try {
        streamUrl = getAdapter().getStreamUrl(
          capturedSongId,
          maxBitrate,
          '',
          contentType,
          capturedSong.path,
          capturedSong.suffix
        )
      } catch (e) {
        console.error('[AudioEngine] getStreamUrl failed:', e)
        return
      }

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
          audio.volume = mutedRef.current ? 0 : volumeRef.current
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
      const maybeSubmitPlay = () => {
        if (playSubmitted || playStatKey !== capturedKey) return
        const st = usePlayerStore.getState()
        const dur = capturedSong.duration || st.duration || 0
        const threshold = dur > 0 ? Math.min(dur / 2, 240) : 240
        if (listenedSec < threshold) return
        playSubmitted = true
        try { getAdapter().scrobble(capturedSongId, true) } catch { /* ignore */ }
        recordPlayToHistory(st.currentSong?.id === capturedSongId ? st.currentSong : capturedSong)
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
          const delta = t - listenedPrevT
          if (listenedPrevT >= 0 && delta > 0 && delta < 2) {
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
        // now-playing 通知在真正开始播放时才发送一次
        // （启动时 rehydrate 的歌只加载不播放，不应上报）
        if (!nowPlayingSent && playStatKey === capturedKey) {
          nowPlayingSent = true
          try { getAdapter().scrobble(capturedSongId, false) } catch { /* ignore */ }
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
      const NEAR_END_RATIO = 0.97

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
        const premature =
          metaDur >= 30 && endT > 0 && metaDur - endT > 20 && endT / metaDur < 0.9
        if (premature && recoverAttempts < maxRecoverAttempts) {
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
        usePlayerStore.getState().next()
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
        const durReliable = isFinite(refDur) && refDur >= 20
        const remain = refDur - t
        const nearEnd =
          durReliable &&
          ((remain <= 6 && t > 10) || (refDur > 60 && t / refDur >= NEAR_END_RATIO))

        if (nearEnd) {
          console.warn(
            '[AudioEngine] Stalled at buffer tail near end (metadata longer than stream); advancing next()',
            { currentTime: t, songDur, audioDur }
          )
          clearStallWatch()
          st.next()
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
          let retryUrl = activeUrl
          try {
            const u = new URL(activeUrl, typeof window !== 'undefined' ? window.location.href : undefined)
            const fmt = u.searchParams.get('format')

            if (maxBitrate === 0) {
              if (recoverAttempts === 0) {
                if (!fmt) {
                  retryUrl = getAdapter().getStreamUrl(
                    capturedSongId,
                    0,
                    'flac',
                    contentType,
                    capturedSong.path,
                    capturedSong.suffix
                  )
                  console.warn('[AudioEngine] Retrying with format=flac (first URL had no format param)')
                } else if (fmt === 'flac' && (code === 4 || code === 3)) {
                  retryUrl = getAdapter().getStreamUrl(
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
                retryUrl = getAdapter().getStreamUrl(
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
          1: '播放已中止',
          2: '网络错误',
          3: '解码失败（格式不支持）',
          4: '音频源不可用',
        }[code] ?? '未知错误'
        console.error('[AudioEngine] audio error:', rawCode, err?.message, '| URL:', streamUrl)
        toast({
          title: `播放失败: ${errMsg}`,
          description: `错误码=${rawCode} ${err?.message || ''}\nURL: ${streamUrl.substring(0, 120)}...`,
          variant: 'destructive',
        })
        usePlayerStore.getState().setStreamBuffering(false)
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
        audio.volume = mutedRef.current ? 0 : volumeRef.current
        audio.load()

        // 新的一次播放：重置播放统计（now-playing / scrobble 提交 / 历史都归本次）
        // 模块级状态脱离 React 生命周期，reattach（同 key 重挂监听）时不重置
        playStatKey = capturedKey
        listenedSec = 0
        listenedPrevT = -1
        nowPlayingSent = false
        playSubmitted = false

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
      const m = /^(.+)@([^@]+)@([^@]+)$/.exec(loadedKey)
      if (m && m[1] === songId && m[3] === String(playVersion) && m[2] !== effectiveQuality) {
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
    const knownDurationEarly = currentSong.duration ?? 0
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
  }, [currentSong?.id, playVersion, isConnected, effectiveQuality, queryClient])

  // --- 播放/暂停控制 ---
  useEffect(() => {
    if (isPlaying && audioEl.paused) {
      // readyState < 2（HAVE_CURRENT_DATA）说明还没有足够数据，等 canplay 事件
      if (audioEl.readyState < 2) return
      audioEl.play().catch(e => {
        if (e.name !== 'AbortError') {
          console.warn('[AudioEngine] play rejected:', e.message)
        }
      })
    } else if (!isPlaying && !audioEl.paused) {
      audioEl.pause()
    }
  }, [isPlaying])

  // --- 音量 ---
  useEffect(() => {
    audioEl.volume = muted ? 0 : volume
  }, [volume, muted])

  // --- 卸载清理 ---
  useEffect(() => () => {
    if (loadDebounceTimer !== null) {
      clearTimeout(loadDebounceTimer)
      loadDebounceTimer = null
    }
    if (cleanupPrev) { cleanupPrev(); cleanupPrev = null }
  }, [])
}
