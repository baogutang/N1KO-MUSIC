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
 */

import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { usePlayerStore } from '@/store/playerStore'
import { useServerStore } from '@/store/serverStore'
import { useSettingsStore, QUALITY_MAX_BITRATE } from '@/store/settingsStore'
import { useMemberStore } from '@/store/memberStore'
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
let audioEl: HTMLAudioElement = new Audio()
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
 * 模块级历史记录 timer — 完全脱离 React 生命周期
 * 用于在 audio 加载后 5 秒记录播放历史，不受 useEffect cleanup 影响
 */
let moduleHistoryTimer: ReturnType<typeof setTimeout> | null = null
let lastRecordedSongId: string | null = null

/** 从外部 seek（供 PlayerBar / FullscreenPlayer / LyricDisplay 调用）*/
export function seekHowl(time: number) {
  usePlayerStore.getState().seekTo(time)
  audioEl.currentTime = time
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

export function useAudioEngine() {
  const currentSong = usePlayerStore(s => s.currentSong)
  const isPlaying   = usePlayerStore(s => s.isPlaying)
  const volume      = usePlayerStore(s => s.volume)
  const muted       = usePlayerStore(s => s.muted)
  const isConnected = useServerStore(s => s.isConnected)
  const audioQuality = useSettingsStore(s => s.audioQuality)
  const playVersion  = usePlayerStore(s => s.playVersion)
  const isPremium    = useMemberStore(s => s.isPremium)

  // 免费用户强制使用省流音质（128kbps）
  const effectiveQuality = isPremium ? audioQuality : 'low'

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
      loadedKey = null
      return
    }

    if (!isConnected || !hasAdapter()) {
      return
    }

    const currentKey = `${songId}@${effectiveQuality}@${playVersion}`
    if (loadedKey === currentKey && audioEl) {
      return
    }

    // 清除上一个待执行的加载 debounce（连续切歌时，丢弃中间的加载请求）
    if (loadDebounceTimer !== null) {
      clearTimeout(loadDebounceTimer)
      loadDebounceTimer = null
    }

    const isFirstPlay = loadedKey === null

    if (!isFirstPlay) {
      // 非首次播放：停止旧音频、标记切歌防止 onPause 误同步
      if (cleanupPrev) { cleanupPrev(); cleanupPrev = null }
      isSwitchingSong = true
      audioEl.pause()
      audioEl.src = ''
      setTimeout(() => { isSwitchingSong = false }, LOAD_DEBOUNCE_MS + 50)
    }

    // 重置进度，用服务器返回的 duration 作为初始值（避免进度条为 0）
    usePlayerStore.getState().setCurrentTime(0)
    const knownDurationEarly = currentSong.duration ?? 0
    usePlayerStore.getState().setDuration(knownDurationEarly > 0 ? knownDurationEarly : 0)

    // 捕获当前歌曲 id，供 debounce 内校验
    const capturedSongId = songId
    const capturedKey = currentKey
    const capturedSong = currentSong

    // 首次播放不需要 debounce（没有旧音频要中断），后续切歌才 debounce 吸收连续点击
    const doLoad = () => {
      // 检查 store 当前状态是否还是同一首歌，避免 debounce 期间又切走了
      const latestSong = usePlayerStore.getState().currentSong
      if (!latestSong || latestSong.id !== capturedSongId) return

      // ── 实际加载逻辑 ──────────────────────────────────────────
      let streamUrl: string
      try {
        const maxBitrate = QUALITY_MAX_BITRATE[effectiveQuality]
        streamUrl = getAdapter().getStreamUrl(capturedSongId, maxBitrate, '')
      } catch (e) {
        console.error('[AudioEngine] getStreamUrl failed:', e)
        return
      }

      loadedKey = capturedKey

      const audio = audioEl
      let hasRetried = false

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
      }

      const onDurationChange = () => {
        updateDuration()
      }

      // timeupdate 节流：浏览器原生约 250ms 触发一次，但 zustand 广播开销不低
      // 限制为每 200ms 最多更新一次（实际和 timeupdate 频率一致，但可防止异常高频场景）
      let lastTimeUpdateMs = 0
      const onTimeUpdate = () => {
        const now = performance.now()
        if (now - lastTimeUpdateMs < 200) return  // 最多 5fps，进度条足够流畅
        lastTimeUpdateMs = now

        const t = audio.currentTime
        usePlayerStore.getState().setCurrentTime(t)

        // timeupdate 期间再尝试补全 duration（有些服务器流在播放中才返回有效 duration）
        if (usePlayerStore.getState().duration <= 0) {
          updateDuration()
        }
      }

      const onBufferProgress = () => {
        if (audio.buffered.length > 0) {
          const bufferedEnd = audio.buffered.end(audio.buffered.length - 1)
          const dur = audio.duration
          if (isFinite(dur) && dur > 0) {
            usePlayerStore.getState().setBuffered(bufferedEnd / dur)
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

      const onEnded = () => {
        usePlayerStore.getState().next()
      }

      const onError = () => {
        const err = audio.error
        // code=1 是 load() 中止旧播放，不是真正错误
        if (err?.code === 1) return

        // 网络错误(2) / 音频源不可用(4)：自动重试一次
        if (!hasRetried && (err?.code === 2 || err?.code === 4)) {
          hasRetried = true
          console.warn('[AudioEngine] Retrying after error code:', err?.code)
          setTimeout(() => {
            audio.src = streamUrl
            audio.load()
          }, 1000)
          return
        }

        const errMsg = {
          1: '播放已中止',
          2: '网络错误',
          3: '解码失败（格式不支持）',
          4: '音频源不可用',
        }[err?.code ?? 0] ?? '未知错误'
        console.error('[AudioEngine] audio error:', err?.code, err?.message, '| URL:', streamUrl)
        toast({
          title: `播放失败: ${errMsg}`,
          description: `错误码=${err?.code} ${err?.message || ''}\nURL: ${streamUrl.substring(0, 120)}...`,
          variant: 'destructive',
        })
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

      // ── 模块级历史记录（完全脱离 React 生命周期，immune to useEffect cleanup）──
      // 为什么不用 React useEffect：
      //   1. effect cleanup 在依赖变化时清除 timer，而 isConnected/effectiveQuality
      //      可能在首次 rehydration 后变化，触发核心 effect cleanup
      //   2. 核心 effect cleanup 后 loadedKey === currentKey 导致 early return，
      //      但 listener 已被移除，后续变化无法触发
      //   3. 模块级 timer 只在新歌加载时被清除，其余情况（React 重渲染、
      //      effect cleanup、store 变化）都无法干扰它
      if (moduleHistoryTimer) { clearTimeout(moduleHistoryTimer); moduleHistoryTimer = null }
      moduleHistoryTimer = setTimeout(() => {
        moduleHistoryTimer = null
        if (lastRecordedSongId === capturedSongId) return
        const state = usePlayerStore.getState()
        if (state.currentSong?.id === capturedSongId) {
          lastRecordedSongId = capturedSongId
          recordPlayToHistory(state.currentSong)
        }
      }, 5000)

      // scrobble（异步，不阻塞）
      try { getAdapter().scrobble(capturedSongId, false) } catch { /* ignore */ }

      // 如果应该播放但 audio 还没 canplay，先标记 isPlaying=true，等 canplay 触发
      const shouldPlay = usePlayerStore.getState().isPlaying
      if (shouldPlay) {
        usePlayerStore.getState().resume()
      }

      const cleanup = () => {
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

  }, [currentSong?.id, isConnected, effectiveQuality, playVersion]) // eslint-disable-line react-hooks/exhaustive-deps

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
