import type { Song } from '@/api/types'
import { HISTORY_BYTE_BUDGET, STORAGE_KEYS } from '@/services/storageKeys'
import { reclaimStorage } from '@/services/storageMaintenance'
import {
  deleteEvents,
  deleteEventsByServer,
  isHistoryDbAvailable,
  putEvent,
  putEvents,
  readAllEvents,
} from '@/services/historyDb'

const HISTORY_KEY = STORAGE_KEYS.playHistory

/**
 * 保留上限。IndexedDB 配额远大于 localStorage，可以留下足够长的行为窗口
 * 供推荐画像使用；降级到 localStorage 时另有体积预算兜底。
 */
const MAX_EVENTS = 20000

export type ListeningOutcome = 'completed' | 'qualified' | 'abandoned' | 'skipped'

export interface ListeningEvent {
  version: 2
  eventId: string
  serverId: string
  song: Song
  startedAt: number
  endedAt: number
  listenedSeconds: number
  completionRate: number
  outcome: ListeningOutcome
}

interface LegacyHistoryEntry {
  song?: Song
  playedAt?: number
}

function createId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `play_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

export function createListeningEventId(): string {
  return createId()
}

function isListeningEvent(value: unknown): value is ListeningEvent {
  if (!value || typeof value !== 'object') return false
  const event = value as Partial<ListeningEvent>
  return event.version === 2 && typeof event.eventId === 'string' && !!event.song
}

function normalizeEvent(value: unknown, fallbackServerId: string): ListeningEvent | null {
  if (isListeningEvent(value)) {
    const duration = Math.max(0, Number(value.song.duration) || 0)
    const listenedSeconds = Math.max(0, Number(value.listenedSeconds) || 0)
    return {
      ...value,
      serverId: value.serverId || fallbackServerId,
      song: { ...value.song, serverId: value.serverId || fallbackServerId },
      listenedSeconds,
      completionRate: duration > 0
        ? Math.max(0, Math.min(1, listenedSeconds / duration))
        : Math.max(0, Math.min(1, Number(value.completionRate) || 0)),
    }
  }

  const legacy = value as LegacyHistoryEntry
  if (!legacy?.song?.id || !legacy.playedAt) return null
  const duration = Math.max(0, Number(legacy.song.duration) || 0)
  const serverId = legacy.song.serverId || fallbackServerId
  return {
    version: 2,
    eventId: `legacy_${serverId}_${legacy.playedAt}_${legacy.song.id}`,
    serverId,
    song: { ...legacy.song, serverId },
    startedAt: legacy.playedAt - duration * 1000,
    endedAt: legacy.playedAt,
    listenedSeconds: duration,
    completionRate: duration > 0 ? 1 : 0,
    outcome: 'completed',
  }
}

function readAll(fallbackServerId = 'legacy'): ListeningEvent[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(item => normalizeEvent(item, fallbackServerId))
      .filter((item): item is ListeningEvent => item !== null)
      .sort((a, b) => b.endedAt - a.endedAt)
  } catch {
    return []
  }
}

/**
 * 在体积预算内尽可能多地保留最近记录。
 * 条目数上限无法约束体积（单条 Song 含 path 等字段，长度差异很大），
 * 因此以序列化后的字节数为准逐轮收缩。
 */
function persistWithinBudget(events: ListeningEvent[]): boolean {
  let kept = events
  while (kept.length) {
    const payload = JSON.stringify(kept)
    if (payload.length * 2 <= HISTORY_BYTE_BUDGET) {
      try {
        localStorage.setItem(HISTORY_KEY, payload)
        return true
      } catch {
        // 其他键占满了配额，继续收缩本键
      }
    }
    kept = kept.slice(0, Math.floor(kept.length * 0.7))
  }
  return false
}

function writeAll(events: ListeningEvent[]) {
  const bounded = events
    .sort((a, b) => b.endedAt - a.endedAt)
    .slice(0, MAX_EVENTS)

  if (persistWithinBudget(bounded)) return
  reclaimStorage(HISTORY_KEY)
  if (persistWithinBudget(bounded)) return
  // 回收后仍写不进：保留磁盘上的旧快照（最多落后一条），不清空用户历史。
  console.warn('[History] 存储配额不足，本次收听记录仅保留在内存中')
}

/**
 * detail 里带上刚写入的事件，供同步层排队上报。
 * 已有消费方只读 serverId，多一个字段不影响它们。
 */
function notifyHistoryUpdated(serverId: string, event?: ListeningEvent) {
  window.dispatchEvent(new CustomEvent('msp-history-updated', { detail: { serverId, event } }))
}

/**
 * 内存里的权威副本。
 *
 * 读取方（推荐、历史页、统计页）都是同步调用，而 IndexedDB 只有异步接口，
 * 因此以内存为读取源、IndexedDB 只负责持久化。initListeningHistory 完成前
 * 回退到 localStorage 直读，保证首屏也有数据。
 */
let memoryCache: ListeningEvent[] | null = null
/** IndexedDB 不可用时退回原来的 localStorage 全量重写策略 */
let usingLocalStorageFallback = false

function currentEvents(fallbackServerId: string): ListeningEvent[] {
  if (memoryCache) return memoryCache
  return readAll(fallbackServerId)
}

function persist(event: ListeningEvent, allEvents: ListeningEvent[]): void {
  // 也检查 isHistoryDbAvailable：init 尚未运行时不能把写入丢掉
  if (usingLocalStorageFallback || !isHistoryDbAvailable()) {
    writeAll(allEvents)
    return
  }

  /**
   * 迁移完成后 localStorage 里已没有副本，因此单条写入失败必须退回写盘，
   * 否则这条记录只存在于内存中、刷新即丢。落到 localStorage 的快照会在
   * 下次启动时被 initListeningHistory 按 eventId 合并回 IndexedDB。
   */
  const fallback = () => writeAll(memoryCache ?? allEvents)
  void putEvent(event)
    .then(persisted => {
      if (!persisted) {
        console.warn('[History] IndexedDB 写入未成功，回退到 localStorage 快照')
        fallback()
      }
    })
    .catch(error => {
      console.warn('[History] IndexedDB 写入失败，回退到 localStorage 快照：', error)
      fallback()
    })
}

/** 按 eventId 去重，同一 eventId 保留 endedAt 更新的那条 */
function dedupeByEventId(groups: ListeningEvent[][]): ListeningEvent[] {
  const merged = new Map<string, ListeningEvent>()
  for (const group of groups) {
    for (const event of group) {
      const existing = merged.get(event.eventId)
      if (!existing || event.endedAt >= existing.endedAt) merged.set(event.eventId, event)
    }
  }
  return Array.from(merged.values())
}

export function readListeningEvents(serverId?: string): ListeningEvent[] {
  const events = currentEvents(serverId || 'legacy')
  if (!serverId) return events
  return events.filter(event => event.serverId === serverId)
}

export function upsertListeningEvent(event: ListeningEvent): void {
  try {
    const events = currentEvents(event.serverId)
    const index = events.findIndex(item => item.eventId === event.eventId)
    const next = index >= 0
      ? events.map(item => (item.eventId === event.eventId ? event : item))
      : [event, ...events]

    const bounded = next.sort((a, b) => b.endedAt - a.endedAt)
    const dropped = bounded.splice(MAX_EVENTS)
    memoryCache = bounded

    persist(event, bounded)
    if (dropped.length && !usingLocalStorageFallback) {
      void deleteEvents(dropped.map(item => item.eventId))
    }
    notifyHistoryUpdated(event.serverId, event)
  } catch (error) {
    console.error('[History] failed to persist listening event:', error)
  }
}

export function clearListeningEvents(serverId: string): void {
  const events = currentEvents(serverId)
  memoryCache = events.filter(event => event.serverId !== serverId)

  if (usingLocalStorageFallback) {
    writeAll(memoryCache)
  } else {
    void deleteEventsByServer(serverId).catch(error => {
      console.warn('[History] 清除历史失败：', error)
    })
  }
  notifyHistoryUpdated(serverId)
}

/**
 * 启动时加载历史并完成 localStorage → IndexedDB 迁移。
 *
 * 迁移成功后删除 localStorage 里的历史键，直接把最多 1.5MB 的配额
 * 还给播放队列等仍然依赖 localStorage 的状态。
 */
export async function initListeningHistory(): Promise<void> {
  /**
   * 加载是异步的，期间用户可能已经开始听歌并写入了 memoryCache，
   * 所有赋值路径都必须与既有内存副本合并，不能直接覆盖。
   */
  const commit = (loaded: ListeningEvent[]): ListeningEvent[] => {
    const merged = dedupeByEventId([loaded, memoryCache ?? []])
      .sort((a, b) => b.endedAt - a.endedAt)
      .slice(0, MAX_EVENTS)
    memoryCache = merged
    return merged
  }

  if (!isHistoryDbAvailable()) {
    usingLocalStorageFallback = true
    commit(readAll('legacy'))
    return
  }

  const stored = await readAllEvents<unknown>()
  if (stored === null) {
    usingLocalStorageFallback = true
    commit(readAll('legacy'))
    return
  }

  const fromDb = stored
    .map(item => normalizeEvent(item, 'legacy'))
    .filter((item): item is ListeningEvent => item !== null)

  const legacy = readAll('legacy')
  if (legacy.length) {
    const known = new Set(fromDb.map(event => event.eventId))
    const pending = legacy.filter(event => !known.has(event.eventId))
    const migrated = pending.length ? await putEvents(pending) : true
    fromDb.push(...pending)

    // 只有确认落库成功才删除迁移来源，否则宁可留着下次重试（eventId 去重不会产生重复）
    if (migrated) {
      try {
        localStorage.removeItem(HISTORY_KEY)
      } catch {
        // 删不掉也无妨，下次启动仍会去重
      }
    } else {
      console.warn('[History] 迁移到 IndexedDB 未成功，保留 localStorage 中的历史以便重试')
    }
  }

  const merged = commit(fromDb)
  if (merged.length) notifyHistoryUpdated(merged[0].serverId)
}

/**
 * 批量导入历史（用于从同步服务拉回其他设备的记录）。
 *
 * 以 eventId 去重、endedAt 更新者胜出，因此重复导入是幂等的。
 * 返回真正新增或更新的条数，供调用方决定是否需要通知界面刷新。
 */
export async function importListeningEvents(
  incoming: unknown[],
  fallbackServerId: string
): Promise<number> {
  const normalized = incoming
    .map(item => normalizeEvent(item, fallbackServerId))
    .filter((item): item is ListeningEvent => item !== null)
  if (!normalized.length) return 0

  const existing = currentEvents(fallbackServerId)
  const known = new Map(existing.map(event => [event.eventId, event]))
  const changed = normalized.filter(event => {
    const previous = known.get(event.eventId)
    return !previous || event.endedAt > previous.endedAt || event.listenedSeconds > previous.listenedSeconds
  })
  if (!changed.length) return 0

  // changed 放在后面：dedupe 在 endedAt 相同时取后者，
  // 而能进入 changed 的记录必然比本地更完整（更晚结束或听得更久）。
  memoryCache = dedupeByEventId([existing, changed])
    .sort((a, b) => b.endedAt - a.endedAt)
    .slice(0, MAX_EVENTS)

  if (usingLocalStorageFallback || !isHistoryDbAvailable()) {
    writeAll(memoryCache)
  } else if (!(await putEvents(changed))) {
    // IndexedDB 写失败时退回 localStorage 快照，否则刷新后合并结果会凭空消失
    console.warn('[History] 导入记录未能写入 IndexedDB，回退到 localStorage 快照')
    writeAll(memoryCache)
  }
  notifyHistoryUpdated(fallbackServerId)
  return changed.length
}

/** 仅供测试：重置模块级缓存 */
export function resetListeningHistoryCache(): void {
  memoryCache = null
  usingLocalStorageFallback = false
}

export function getScrobbleThreshold(durationSeconds: number): number {
  return durationSeconds > 0 ? Math.min(durationSeconds / 2, 240) : 240
}

export function isQualifiedListeningEvent(event: ListeningEvent): boolean {
  return event.listenedSeconds >= getScrobbleThreshold(event.song.duration || 0)
}

export function deriveListeningOutcome(
  listenedSeconds: number,
  durationSeconds: number,
  completed = false
): ListeningOutcome {
  const completionRate = durationSeconds > 0 ? listenedSeconds / durationSeconds : 0
  if (completed || completionRate >= 0.9) return 'completed'
  if (listenedSeconds >= getScrobbleThreshold(durationSeconds)) return 'qualified'
  if (listenedSeconds < Math.min(30, Math.max(5, durationSeconds * 0.1))) return 'skipped'
  return 'abandoned'
}

/**
 * 订阅新写入的收听事件。
 *
 * 包一层是为了让消费方不必知道事件名，也不必自己拆 CustomEvent 的 detail。
 * 注意同一个 eventId 会被写多次（一次播放期间进度在涨），
 * 消费方要自己按 eventId 去重。
 */
export function subscribeListeningEvents(
  handler: (event: ListeningEvent) => void
): () => void {
  const onUpdated = (raw: Event) => {
    const detail = (raw as CustomEvent<{ event?: ListeningEvent }>).detail
    if (detail?.event) handler(detail.event)
  }
  window.addEventListener('msp-history-updated', onUpdated)
  return () => window.removeEventListener('msp-history-updated', onUpdated)
}
