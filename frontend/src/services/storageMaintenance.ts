/**
 * localStorage 空间维护。
 *
 * 本模块只操作原始键值，不 import 任何 store —— 这样它既能在 store 完成
 * hydration 之前运行（启动自愈），也不会与 persist 适配器形成循环依赖。
 */

import {
  HISTORY_BYTE_BUDGET,
  LEGACY_COVER_KEY_PREFIX,
  RECOMMENDATION_CACHE_LIMIT,
  RECOMMENDATION_CACHE_PREFIX,
  STORAGE_KEYS,
  STORAGE_PRESSURE_EVENT,
} from './storageKeys'

/** 缓存条目的最小结构约定：带保存时间即可被按时间淘汰 */
interface TimestampedEntry {
  savedAt?: number
}

function hasLocalStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined'
  } catch {
    return false
  }
}

/** 键值对占用的字节数估算（UTF-16，键名同样占空间） */
function entryBytes(key: string, value: string | null): number {
  return (key.length + (value?.length ?? 0)) * 2
}

function listKeys(predicate: (key: string) => boolean): string[] {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key && predicate(key)) keys.push(key)
  }
  return keys
}

function removeKeys(keys: string[]): number {
  let freed = 0
  for (const key of keys) {
    freed += entryBytes(key, localStorage.getItem(key))
    try {
      localStorage.removeItem(key)
    } catch {
      // 单键删除失败不影响其余回收
    }
  }
  return freed
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

/** 当天的推荐缓存作用域，与 usePersonalizedRecommendations 保持一致（补零便于排序） */
export function recommendationDayKey(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/**
 * 清理推荐缓存：
 * - 删除所有非当天的键（含旧版把 endedAt 写进键名、每 30 秒新增一条的遗留数据）
 * - 当天键超过上限时按保存时间淘汰最旧的
 */
export function pruneRecommendationCache(now = new Date()): number {
  if (!hasLocalStorage()) return 0
  const today = recommendationDayKey(now)
  const allKeys = listKeys(key => key.startsWith(RECOMMENDATION_CACHE_PREFIX))
  const stale: string[] = []
  const current: Array<{ key: string; savedAt: number }> = []

  for (const key of allKeys) {
    // 键形如 msp-recommendation:{serverId}:{yyyy-mm-dd}:{batch}:{size}
    if (!key.includes(`:${today}:`)) {
      stale.push(key)
      continue
    }
    current.push({ key, savedAt: readJson<TimestampedEntry>(key)?.savedAt ?? 0 })
  }

  let freed = removeKeys(stale)
  if (current.length > RECOMMENDATION_CACHE_LIMIT) {
    const evictable = current
      .sort((a, b) => b.savedAt - a.savedAt)
      .slice(RECOMMENDATION_CACHE_LIMIT)
      .map(item => item.key)
    freed += removeKeys(evictable)
  }
  return freed
}

/**
 * 把收听历史压缩到体积预算内，优先保留最近的记录。
 * 返回释放的字节数；历史本身未超预算时不做任何写入。
 */
export function trimHistoryToBudget(budget = HISTORY_BYTE_BUDGET): number {
  if (!hasLocalStorage()) return 0
  const key = STORAGE_KEYS.playHistory
  const raw = localStorage.getItem(key)
  if (!raw || raw.length * 2 <= budget) return 0

  const events = readJson<TimestampedEntry[]>(key)
  // 内容无法解析成数组说明已损坏，删除是安全的；有效历史一律不整键删除。
  if (!Array.isArray(events)) return removeKeys([key])
  if (!events.length) return 0

  const sorted = [...events].sort(
    (a, b) => Number((b as { endedAt?: number }).endedAt ?? 0) - Number((a as { endedAt?: number }).endedAt ?? 0)
  )
  let kept = sorted
  let payload = JSON.stringify(kept)
  // 每轮丢弃最旧的三成，直到进入预算；至少保留一条最新记录。
  while (payload.length * 2 > budget && kept.length > 1) {
    kept = kept.slice(0, Math.max(1, Math.floor(kept.length * 0.7)))
    payload = JSON.stringify(kept)
  }

  const before = raw.length * 2
  try {
    localStorage.setItem(key, payload)
  } catch {
    // 写不进就保留原值：宁可不腾出这部分空间，也不能整键抹掉用户历史
    return 0
  }
  return Math.max(0, before - payload.length * 2)
}

/** 通知内存中的可重建缓存收缩，避免下一次 persist 又把淘汰掉的条目写回来 */
function announcePressure(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(STORAGE_PRESSURE_EVENT))
}

/**
 * 配额不足时的分级回收。越靠前的层级代价越低（可完全重建），
 * 播放器/服务器/设置/主题这些体积小且不可重建的键永不回收。
 *
 * @param protectedKey 正在写入的键，不参与回收
 */
export function reclaimStorage(protectedKey?: string): number {
  if (!hasLocalStorage()) return 0
  let freed = 0

  // 一级：完全可重建的缓存
  freed += removeKeys(listKeys(key => key.startsWith(LEGACY_COVER_KEY_PREFIX)))
  freed += removeKeys(listKeys(key => key.startsWith(RECOMMENDATION_CACHE_PREFIX)))
  if (freed > 0) return freed

  // 二级：远端可重新获取的封面/歌词缓存
  const rebuildable: string[] = [STORAGE_KEYS.coverCache, STORAGE_KEYS.lyricsCache]
    .filter(key => key !== protectedKey)
  freed += removeKeys(listKeys(key => rebuildable.includes(key)))
  if (freed > 0) {
    announcePressure()
    return freed
  }

  // 三级：收听历史降级到一半预算（会真实损失最旧的记录，因此放在最后）
  if (protectedKey !== STORAGE_KEYS.playHistory) {
    freed += trimHistoryToBudget(Math.floor(HISTORY_BYTE_BUDGET / 2))
  }
  return freed
}

/** 已用字节数估算，仅用于诊断展示 */
export function estimateStorageBytes(): number {
  if (!hasLocalStorage()) return 0
  let total = 0
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key) total += entryBytes(key, localStorage.getItem(key))
  }
  return total
}

/**
 * 启动自愈：清掉历史遗留的推荐缓存、把超标的历史压回预算内。
 * 已经因配额撑满而白屏的用户，重新加载一次即可恢复。
 */
export function runStorageMaintenance(): void {
  if (!hasLocalStorage()) return
  try {
    const freed = pruneRecommendationCache() + trimHistoryToBudget()
    if (freed > 0) {
      console.info(`[storage] 启动清理释放约 ${Math.round(freed / 1024)}KB`)
      announcePressure()
    }
  } catch (error) {
    console.warn('[storage] 启动清理失败：', error)
  }
}
