import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  estimateStorageBytes,
  pruneRecommendationCache,
  recommendationDayKey,
  reclaimStorage,
  runStorageMaintenance,
  trimHistoryToBudget,
} from '@/services/storageMaintenance'
import {
  LEGACY_COVER_KEY_PREFIX,
  RECOMMENDATION_CACHE_LIMIT,
  RECOMMENDATION_CACHE_PREFIX,
  STORAGE_KEYS,
} from '@/services/storageKeys'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return Array.from(this.values.keys())[index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

/** dayKey 取本地日历天，固定时刻用本地时间构造以免断言依赖运行机器的时区 */
const NOW = new Date(2026, 6, 28, 10, 0, 0, 0)
const DAY_MS = 86_400_000

/** 相对 NOW 的前 n 天，用于构造"过期"的缓存键 */
function daysBefore(days: number): string {
  return recommendationDayKey(new Date(NOW.getTime() - days * DAY_MS))
}

function recommendationKey(day: string, batch = 0): string {
  return `${RECOMMENDATION_CACHE_PREFIX}server-a:${day}:${batch}:30`
}

function historyEvent(endedAt: number) {
  return {
    version: 2,
    eventId: `event-${endedAt}`,
    serverId: 'server-a',
    song: { id: `song-${endedAt}`, title: 'T', artist: 'A', album: 'B', duration: 200, path: 'p'.repeat(200) },
    startedAt: endedAt - 200_000,
    endedAt,
    listenedSeconds: 200,
    completionRate: 1,
    outcome: 'completed',
  }
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: new MemoryStorage(),
  })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { dispatchEvent: vi.fn() },
  })
  Object.defineProperty(globalThis, 'CustomEvent', {
    configurable: true,
    value: class {
      constructor(public type: string, public init?: unknown) {}
    },
  })
})

describe('推荐缓存清理', () => {
  it('删除所有非当天的缓存键', () => {
    const today = recommendationDayKey(NOW)
    const yesterday = daysBefore(1)
    const earlier = daysBefore(2)
    localStorage.setItem(recommendationKey(today), JSON.stringify({ savedAt: 1, songs: [] }))
    localStorage.setItem(recommendationKey(yesterday), JSON.stringify({ savedAt: 1, songs: [] }))
    localStorage.setItem(recommendationKey(earlier), JSON.stringify({ savedAt: 1, songs: [] }))

    pruneRecommendationCache(NOW)

    expect(localStorage.getItem(recommendationKey(today))).not.toBeNull()
    expect(localStorage.getItem(recommendationKey(yesterday))).toBeNull()
    expect(localStorage.getItem(recommendationKey(earlier))).toBeNull()
  })

  it('清除旧版把 endedAt 写进键名而不断累积的遗留缓存', () => {
    // 旧格式：...:{batch}:{eventId}:{endedAt}:{size}，播放中每 30 秒新增一条
    for (let i = 0; i < 50; i++) {
      localStorage.setItem(
        `${RECOMMENDATION_CACHE_PREFIX}server-a:2026-7-28:0:event-1:${1_700_000_000 + i * 30}:30`,
        JSON.stringify([{ id: 'song' }])
      )
    }
    expect(localStorage.length).toBe(50)

    pruneRecommendationCache(NOW)
    expect(localStorage.length).toBe(0)
  })

  it('当天缓存超过上限时按保存时间淘汰最旧的', () => {
    const today = recommendationDayKey(NOW)
    const total = RECOMMENDATION_CACHE_LIMIT + 4
    for (let batch = 0; batch < total; batch++) {
      localStorage.setItem(
        recommendationKey(today, batch),
        JSON.stringify({ savedAt: batch, songs: [] })
      )
    }

    pruneRecommendationCache(NOW)

    expect(localStorage.length).toBe(RECOMMENDATION_CACHE_LIMIT)
    // savedAt 最小的批次先被淘汰
    expect(localStorage.getItem(recommendationKey(today, 0))).toBeNull()
    expect(localStorage.getItem(recommendationKey(today, total - 1))).not.toBeNull()
  })
})

describe('收听历史体积裁剪', () => {
  it('超出预算时保留最近记录并丢弃最旧的', () => {
    const events = Array.from({ length: 200 }, (_, i) => historyEvent(1_000_000 + i * 1000))
    localStorage.setItem(STORAGE_KEYS.playHistory, JSON.stringify(events))

    const freed = trimHistoryToBudget(20_000)
    expect(freed).toBeGreaterThan(0)

    const kept = JSON.parse(localStorage.getItem(STORAGE_KEYS.playHistory)!) as Array<{ endedAt: number }>
    expect(kept.length).toBeLessThan(200)
    expect(kept.length).toBeGreaterThan(0)
    // 保留的必须是时间最新的那批
    expect(kept[0].endedAt).toBe(1_000_000 + 199 * 1000)
  })

  it('写不进去时保留原值,绝不整键抹掉有效历史', () => {
    const events = Array.from({ length: 50 }, (_, i) => historyEvent(1_000_000 + i * 1000))
    const payload = JSON.stringify(events)
    localStorage.setItem(STORAGE_KEYS.playHistory, payload)
    // 任何写入都失败（模拟配额已被其他键占满）
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('The quota has been exceeded.')
    })

    expect(trimHistoryToBudget(1000)).toBe(0)
    vi.restoreAllMocks()
    expect(localStorage.getItem(STORAGE_KEYS.playHistory)).toBe(payload)
  })

  it('内容损坏无法解析成数组时才删除该键', () => {
    localStorage.setItem(STORAGE_KEYS.playHistory, JSON.stringify({ not: 'an array' }))
    expect(trimHistoryToBudget(10)).toBeGreaterThan(0)
    expect(localStorage.getItem(STORAGE_KEYS.playHistory)).toBeNull()
  })

  it('未超预算时不做任何写入', () => {
    const events = [historyEvent(1_000_000)]
    const payload = JSON.stringify(events)
    localStorage.setItem(STORAGE_KEYS.playHistory, payload)

    expect(trimHistoryToBudget(1_000_000)).toBe(0)
    expect(localStorage.getItem(STORAGE_KEYS.playHistory)).toBe(payload)
  })
})

describe('配额回收分级', () => {
  it('优先回收完全可重建的缓存，不动播放器与服务器状态', () => {
    localStorage.setItem(STORAGE_KEYS.playerStore, 'player')
    localStorage.setItem(STORAGE_KEYS.serverStore, 'server')
    localStorage.setItem(STORAGE_KEYS.settingsStore, 'settings')
    localStorage.setItem(STORAGE_KEYS.themeStore, 'theme')
    localStorage.setItem(`${LEGACY_COVER_KEY_PREFIX}song-1`, 'cover')
    localStorage.setItem(recommendationKey('2026-07-28'), JSON.stringify({ savedAt: 1, songs: [] }))
    localStorage.setItem(STORAGE_KEYS.lyricsCache, 'lyrics')

    const freed = reclaimStorage(STORAGE_KEYS.playerStore)

    expect(freed).toBeGreaterThan(0)
    expect(localStorage.getItem(`${LEGACY_COVER_KEY_PREFIX}song-1`)).toBeNull()
    expect(localStorage.getItem(recommendationKey('2026-07-28'))).toBeNull()
    // 一级回收已腾出空间，二级的歌词缓存本轮不动
    expect(localStorage.getItem(STORAGE_KEYS.lyricsCache)).toBe('lyrics')
    expect(localStorage.getItem(STORAGE_KEYS.playerStore)).toBe('player')
    expect(localStorage.getItem(STORAGE_KEYS.serverStore)).toBe('server')
    expect(localStorage.getItem(STORAGE_KEYS.settingsStore)).toBe('settings')
    expect(localStorage.getItem(STORAGE_KEYS.themeStore)).toBe('theme')
  })

  it('一级无可回收时才动歌词与封面缓存，且跳过正在写入的键', () => {
    localStorage.setItem(STORAGE_KEYS.lyricsCache, 'lyrics')
    localStorage.setItem(STORAGE_KEYS.coverCache, 'covers')

    reclaimStorage(STORAGE_KEYS.lyricsCache)

    expect(localStorage.getItem(STORAGE_KEYS.lyricsCache)).toBe('lyrics')
    expect(localStorage.getItem(STORAGE_KEYS.coverCache)).toBeNull()
  })
})

describe('启动自愈', () => {
  it('清掉遗留推荐缓存并统计占用', () => {
    // runStorageMaintenance 读真实时钟，因此"过期"的日期必须相对真实今天推算，
    // 不能写死日期字面量（否则某一天跑测试时它恰好就是今天）。
    for (let i = 0; i < 30; i++) {
      const staleDay = recommendationDayKey(new Date(Date.now() - (i + 1) * DAY_MS))
      localStorage.setItem(
        `${RECOMMENDATION_CACHE_PREFIX}server-a:${staleDay}:0:event:${i}:30`,
        JSON.stringify([{ id: 'song' }])
      )
    }
    localStorage.setItem(STORAGE_KEYS.playerStore, 'player')

    expect(estimateStorageBytes()).toBeGreaterThan(0)
    runStorageMaintenance()

    expect(localStorage.getItem(STORAGE_KEYS.playerStore)).toBe('player')
    expect(localStorage.length).toBe(1)
  })
})
