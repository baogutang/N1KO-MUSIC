/**
 * 把本地收听事件转成 ListenBrainz 的 listen 并直接提交。
 *
 * 挂在布局层，订阅收听历史的新增事件；提交失败的进队列，
 * 联网恢复或下一次成功提交时一并补交。
 */

import { useEffect, useRef } from 'react'
import { useScrobbleStore } from '@/store/scrobbleStore'
import {
  buildListen, buildPlayingNow, qualifiesAsListen, submitListens, type ListenPayload,
} from '@/services/listenBrainz'
import { usePlayerStore } from '@/store/playerStore'
import { subscribeListeningEvents, type ListeningEvent } from '@/services/listeningHistory'

/** 补交的最小间隔，避免刚断网回来就连着敲服务端 */
const FLUSH_INTERVAL_MS = 60_000

export function useDirectScrobble(): void {
  const enabled = useScrobbleStore(s => s.enabled)
  const apiUrl = useScrobbleStore(s => s.apiUrl)
  const token = useScrobbleStore(s => s.token)
  /** 同一时刻只允许一次提交在飞，否则补交队列会被重复发出去 */
  const inFlight = useRef(false)
  /**
   * 已经交过的 eventId。
   * 一次播放期间同一条事件会被反复写入（进度在涨），不去重就会重复提交。
   */
  const submitted = useRef(new Set<string>())

  useEffect(() => {
    if (!enabled || !token.trim()) return
    /**
     * 端点必须是一个校验过的完整地址才发请求。
     *
     * 第二道防线：设置页已经改成失焦才提交、且换端点会断开 token，
     * 但这里是真正带着 Authorization 头出网的地方，不该假设上游一定守规矩。
     * 解析不出主机名的地址一律不发——半截 URL 上没有可信的收件人。
     */
    let endpointHost = ''
    try {
      endpointHost = new URL(apiUrl).hostname
    } catch {
      return
    }
    if (!endpointHost.includes('.') && endpointHost !== 'localhost') return

    const store = useScrobbleStore.getState

    /**
     * 提交一批。失败且值得重试的原样放回队列；不值得重试的（token 错、
     * 数据不合法）直接丢掉并把原因写进设置页，不然队列会永远堵在那一条上。
     */
    const flush = async (extra?: ListenPayload) => {
      if (inFlight.current) {
        if (extra) store().enqueue(extra)
        return
      }
      inFlight.current = true
      try {
        const batch = [...store().drainPending()]
        if (extra) batch.push(extra)
        if (!batch.length) return

        const outcome = await submitListens(apiUrl, token, batch, batch.length > 1 ? 'import' : 'single')
        if (outcome.ok) {
          store().noteSuccess()
          return
        }
        store().noteError(outcome.message)
        if (outcome.retryable) for (const listen of batch) store().enqueue(listen)
      } finally {
        inFlight.current = false
      }
    }

    const onEvent = (event: ListeningEvent) => {
      if (submitted.current.has(event.eventId)) return
      if (!qualifiesAsListen(event.listenedSeconds, event.song.duration ?? 0)) return
      submitted.current.add(event.eventId)
      // listened_at 取开始播放的时间：ListenBrainz 的去重与时间轴都按它算
      const listen = buildListen(event.song, event.startedAt)
      if (listen) void flush(listen)
    }

    /**
     * playing_now：换歌时报一次当前在听什么。
     * 它不进重试队列——「正在听」过期就没意义了，失败就算了。
     */
    let lastNowPlayingId: string | null = null
    const unsubscribePlayer = usePlayerStore.subscribe(state => {
      const song = state.currentSong
      if (!song || !state.isPlaying || song.id === lastNowPlayingId) return
      lastNowPlayingId = song.id
      const payload = buildPlayingNow(song)
      if (payload) void submitListens(apiUrl, token, [payload], 'playing_now')
    })

    const unsubscribe = subscribeListeningEvents(onEvent)
    const onOnline = () => { void flush() }
    window.addEventListener('online', onOnline)
    const timer = window.setInterval(() => { void flush() }, FLUSH_INTERVAL_MS)
    // 启动时先把上次没交上去的补掉
    void flush()

    return () => {
      unsubscribe()
      unsubscribePlayer()
      window.removeEventListener('online', onOnline)
      window.clearInterval(timer)
    }
  }, [enabled, apiUrl, token])
}
