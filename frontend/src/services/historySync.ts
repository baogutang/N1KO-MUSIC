/**
 * 收听历史与同步服务之间的双向搬运。
 *
 * 设计约束：
 * - 同步失败绝不影响播放与本地记录，本地 IndexedDB 始终是读取来源；
 * - 上报走批量出队，播放过程中每 30 秒刷新的中间状态不会打爆网络；
 * - 服务端 scrobble 按 eventId 幂等且会「修正」时长，因此重复上报是安全的，
 *   不需要在客户端判断一次收听是否已经结束。
 */

import axios from 'axios'
import {
  fetchRemoteHistory,
  pushFavorite,
  pushScrobble,
  removeFavorite,
  type RemoteHistoryEntry,
} from '@/api/syncClient'
import {
  deriveListeningOutcome,
  importListeningEvents,
  readListeningEvents,
  type ListeningEvent,
} from '@/services/listeningHistory'
import { activeSyncCredentials, useSyncStore } from '@/store/syncStore'
import { useServerStore } from '@/store/serverStore'
import type { Song } from '@/api/types'

/** 攒够一批再上报的窗口 */
const FLUSH_DELAY_MS = 20_000
/** 单次上报失败后的重试间隔上限 */
const MAX_RETRY_DELAY_MS = 5 * 60_000
/** 单次从服务端拉取的条数 */
const PULL_PAGE_SIZE = 500
/** 最多拉取的页数：与本地保留上限（2 万条）对齐，超出部分本地也留不住 */
const MAX_PULL_PAGES = 40
/**
 * 启动补推时向前多取一点的安全窗口。
 * lastSyncedAt 记的是上次冲刷成功的时刻，而冲刷窗口内可能还有记录没来得及上报。
 */
const BACKFILL_SAFETY_MS = 10 * 60_000

const outbox = new Map<string, ListeningEvent>()
let flushTimer: ReturnType<typeof setTimeout> | null = null
let retryDelay = FLUSH_DELAY_MS
let flushing = false
let started = false

function isUnauthorized(error: unknown): boolean {
  return axios.isAxiosError(error) && error.response?.status === 401
}

function scheduleFlush(delay = FLUSH_DELAY_MS): void {
  if (flushTimer !== null) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    void flushOutbox()
  }, delay)
}

/**
 * 把出队中的记录逐条上报。
 * 令牌失效时清空出队并要求重新登录，否则会陷入无意义的重试。
 */
export async function flushOutbox(): Promise<void> {
  if (flushing) {
    // 已有冲刷在进行：本次让位，但要保证稍后还会再来一次
    scheduleFlush()
    return
  }
  const credentials = activeSyncCredentials()
  if (!credentials || !outbox.size) return

  flushing = true
  const batch = Array.from(outbox.values())
  let failed = false

  for (const event of batch) {
    try {
      await pushScrobble(credentials.baseUrl, credentials.token, {
        eventId: event.eventId,
        songId: event.song.id,
        serverId: event.serverId,
        songData: event.song,
        duration: Math.round(event.listenedSeconds),
        playedAt: Math.floor(event.endedAt / 1000),
      })
      // 上报期间同一次收听可能又刷新了，此时不能删掉更新后的那份
      if (outbox.get(event.eventId) === event) outbox.delete(event.eventId)
    } catch (error) {
      if (isUnauthorized(error)) {
        outbox.clear()
        useSyncStore.getState().invalidateToken()
        flushing = false
        return
      }
      failed = true
      break
    }
  }

  flushing = false
  if (failed) {
    // 指数退避，避免离线时持续打点
    retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY_MS)
    scheduleFlush(retryDelay)
    return
  }

  retryDelay = FLUSH_DELAY_MS
  useSyncStore.getState().markSynced()
  // 冲刷期间新排入的记录留待下一轮
  if (outbox.size) scheduleFlush()
}

/** 把一条本地记录排入上报出队；同一 eventId 只保留最新状态 */
export function queueScrobble(event: ListeningEvent): void {
  if (!activeSyncCredentials()) return
  outbox.set(event.eventId, event)
  scheduleFlush()
}

function toListeningEvent(entry: RemoteHistoryEntry, fallbackServerId: string): unknown | null {
  const song = entry.songData
  if (!song || typeof song.id !== 'string') return null

  const serverId = entry.server_id || fallbackServerId
  const endedAt = entry.played_at * 1000
  const listenedSeconds = Math.max(0, Number(entry.duration) || 0)
  const durationSeconds = Math.max(0, Number(song.duration) || 0)

  return {
    version: 2,
    // 老记录可能没有 event_id，用可复现的组合键补齐，保证重复导入不会翻倍
    eventId: entry.event_id || `remote_${serverId}_${entry.played_at}_${entry.song_id}`,
    serverId,
    song: { ...song, serverId },
    startedAt: endedAt - listenedSeconds * 1000,
    endedAt,
    listenedSeconds,
    completionRate: durationSeconds > 0 ? Math.min(1, listenedSeconds / durationSeconds) : 0,
    outcome: deriveListeningOutcome(listenedSeconds, durationSeconds),
  }
}

/**
 * 从同步服务拉回历史并合并到本地。
 * 返回新增/更新的条数；未配置同步或拉取失败时返回 0。
 */
export async function pullRemoteHistory(): Promise<number> {
  const credentials = activeSyncCredentials()
  const serverId = useServerStore.getState().activeServerId
  if (!credentials || !serverId) return 0

  let imported = 0
  try {
    for (let page = 0; page < MAX_PULL_PAGES; page++) {
      const { items, total } = await fetchRemoteHistory(credentials.baseUrl, credentials.token, {
        serverId,
        limit: PULL_PAGE_SIZE,
        offset: page * PULL_PAGE_SIZE,
      })
      if (!items.length) break

      const converted = items
        .map(entry => toListeningEvent(entry, serverId))
        .filter((item): item is object => item !== null)
      imported += await importListeningEvents(converted, serverId)

      if ((page + 1) * PULL_PAGE_SIZE >= total) break
    }
    useSyncStore.getState().markSynced()
  } catch (error) {
    if (isUnauthorized(error)) useSyncStore.getState().invalidateToken()
    else console.warn('[Sync] 拉取远端历史失败：', error)
  }
  return imported
}

/**
 * 把本地已有历史补推到服务端。
 *
 * 两个使用场景：
 * - 新绑定同步账号时不传 since，把此前积累的记录全部补推；
 * - 每次启动时只补推上次成功同步之后的记录，因为出队只存在内存里，
 *   冲刷窗口内发生的收听会随刷新一起丢失。
 */
export function enqueueLocalBacklog(options: { limit?: number; since?: number } = {}): number {
  const { limit = 1000, since } = options
  const serverId = useServerStore.getState().activeServerId
  if (!activeSyncCredentials() || !serverId) return 0

  const events = readListeningEvents(serverId)
    .filter(event => since === undefined || event.endedAt >= since)
    .slice(0, limit)
  for (const event of events) outbox.set(event.eventId, event)
  if (outbox.size) scheduleFlush(0)
  return events.length
}

/**
 * 启动时补推可能漏掉的记录。
 * 服务端 scrobble 按 eventId 幂等且只会向上修正时长，重复上报是安全的。
 */
export function backfillPendingScrobbles(): number {
  const { lastSyncedAt } = useSyncStore.getState()
  return enqueueLocalBacklog({
    limit: 500,
    since: lastSyncedAt ? lastSyncedAt - BACKFILL_SAFETY_MS : undefined,
  })
}

/**
 * 把收藏状态镜像到同步服务。
 *
 * 收藏的权威来源始终是音乐服务器（Subsonic starred / Jellyfin UserData），
 * 这里只是跨设备镜像，因此失败仅告警、不向调用方抛出。
 * 收藏时需要完整的 Song 才能保存元数据快照；取消收藏只需 id。
 */
export async function mirrorFavorite(
  songId: string,
  starred: boolean,
  song?: Song
): Promise<void> {
  const credentials = activeSyncCredentials()
  const serverId = useServerStore.getState().activeServerId
  if (!credentials || !serverId) return
  if (starred && !song) return

  try {
    if (starred && song) {
      await pushFavorite(credentials.baseUrl, credentials.token, { ...song, serverId }, serverId)
    } else if (!starred) {
      await removeFavorite(credentials.baseUrl, credentials.token, songId, serverId)
    }
  } catch (error) {
    // 取消收藏时服务端可能本来就没有这条记录（404），不值得打扰用户
    if (isUnauthorized(error)) useSyncStore.getState().invalidateToken()
    else if (!axios.isAxiosError(error) || error.response?.status !== 404) {
      console.warn('[Sync] 镜像收藏状态失败：', error)
    }
  }
}

/**
 * 启动同步：监听本地写入事件并在页面隐藏前尽力冲刷出队。
 * 幂等，可安全重复调用。
 */
export function startHistorySync(): void {
  if (started || typeof window === 'undefined') return
  started = true

  window.addEventListener('msp-history-updated', (raw: Event) => {
    const detail = (raw as CustomEvent<{ event?: ListeningEvent }>).detail
    if (detail?.event) queueScrobble(detail.event)
  })

  // 移动端可能不触发 unload，pagehide 是最可靠的时机
  window.addEventListener('pagehide', () => { void flushOutbox() })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushOutbox()
  })
}

/** 仅供测试：重置模块级状态 */
export function resetHistorySyncForTests(): void {
  outbox.clear()
  if (flushTimer !== null) clearTimeout(flushTimer)
  flushTimer = null
  retryDelay = FLUSH_DELAY_MS
  flushing = false
  started = false
}

/** 仅供测试/诊断：当前待上报条数 */
export function pendingScrobbleCount(): number {
  return outbox.size
}
