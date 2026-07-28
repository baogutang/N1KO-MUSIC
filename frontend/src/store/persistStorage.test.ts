import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPersistStorage, flushPersistedStores } from '@/store/persistStorage'
import { RECOMMENDATION_CACHE_PREFIX, STORAGE_KEYS } from '@/services/storageKeys'

/** 可模拟配额上限的内存 Storage，并统计真实落盘次数 */
class QuotaStorage implements Storage {
  private values = new Map<string, string>()
  limit = Number.POSITIVE_INFINITY
  writes = 0

  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return Array.from(this.values.keys())[index] ?? null }
  removeItem(key: string) { this.values.delete(key) }

  setItem(key: string, value: string) {
    let projected = key.length + value.length
    for (const [existingKey, existingValue] of this.values) {
      if (existingKey === key) continue
      projected += existingKey.length + existingValue.length
    }
    if (projected > this.limit) {
      const error = new Error('The quota has been exceeded.')
      error.name = 'QuotaExceededError'
      throw error
    }
    this.values.set(key, value)
    this.writes++
  }
}

let storage: QuotaStorage
/** 每个用例用独立的键，避开模块级快照缓存造成的用例间串扰 */
let keySeq = 0

function uniqueName(): string {
  keySeq += 1
  return `test-store-${keySeq}`
}

beforeEach(() => {
  vi.useFakeTimers()
  storage = new QuotaStorage()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('persist 存储适配器', () => {
  it('partialize 结果未变化时完全不落盘', () => {
    const name = uniqueName()
    const adapter = createPersistStorage({ debounceMs: 10 })
    const queue = [{ id: 'a' }]
    // 播放中 setCurrentTime 每 200ms 触发一次 setItem，但 partialize 结果引用不变
    for (let i = 0; i < 20; i++) {
      adapter.setItem(name, { state: { queue, queueIndex: 0 }, version: 0 })
      vi.advanceTimersByTime(200)
    }
    expect(storage.writes).toBe(1)
  })

  it('合并窗口内的连续变更只产生一次写入', () => {
    const name = uniqueName()
    const adapter = createPersistStorage({ debounceMs: 100 })
    adapter.setItem(name, { state: { queueIndex: 0 }, version: 0 })
    adapter.setItem(name, { state: { queueIndex: 1 }, version: 0 })
    adapter.setItem(name, { state: { queueIndex: 2 }, version: 0 })
    expect(storage.writes).toBe(0)

    vi.advanceTimersByTime(100)
    expect(storage.writes).toBe(1)
    expect(adapter.getItem(name)).toEqual({ state: { queueIndex: 2 }, version: 0 })
  })

  it('debounceMs 为 0 时同步落盘', () => {
    const name = uniqueName()
    const adapter = createPersistStorage({ debounceMs: 0 })
    adapter.setItem(name, { state: { theme: 'dark' }, version: 0 })
    expect(storage.writes).toBe(1)
    expect(adapter.getItem(name)).toEqual({ state: { theme: 'dark' }, version: 0 })
  })

  it('配额不足时回收可重建缓存并重试，不向调用方抛出', () => {
    const name = uniqueName()
    // 推荐缓存占满空间，正是导致播放白屏的那类遗留数据
    storage.setItem(`${RECOMMENDATION_CACHE_PREFIX}server:2026-07-01:0:30`, 'x'.repeat(400))
    storage.limit = 500

    const adapter = createPersistStorage({ debounceMs: 0 })
    expect(() =>
      adapter.setItem(name, { state: { queue: 'y'.repeat(200) }, version: 0 })
    ).not.toThrow()

    expect(adapter.getItem(name)).not.toBeNull()
    expect(storage.getItem(`${RECOMMENDATION_CACHE_PREFIX}server:2026-07-01:0:30`)).toBeNull()
  })

  it('回收后依然写不进时静默降级，不抛出也不破坏已有数据', () => {
    const name = uniqueName()
    storage.setItem(STORAGE_KEYS.serverStore, 'critical')
    storage.limit = 40

    const adapter = createPersistStorage({ debounceMs: 0 })
    expect(() =>
      adapter.setItem(name, { state: { queue: 'z'.repeat(500) }, version: 0 })
    ).not.toThrow()

    // 不可重建的服务器凭据不参与回收
    expect(storage.getItem(STORAGE_KEYS.serverStore)).toBe('critical')
  })

  it('flush 会立即提交待写入内容', () => {
    const name = uniqueName()
    const adapter = createPersistStorage({ debounceMs: 5000 })
    adapter.setItem(name, { state: { volume: 0.5 }, version: 0 })
    expect(storage.writes).toBe(0)

    flushPersistedStores()
    expect(storage.writes).toBe(1)
    expect(adapter.getItem(name)).toEqual({ state: { volume: 0.5 }, version: 0 })
  })

  it('removeItem 取消尚未落盘的写入', () => {
    const name = uniqueName()
    const adapter = createPersistStorage({ debounceMs: 100 })
    adapter.setItem(name, { state: { volume: 0.5 }, version: 0 })
    adapter.removeItem(name)

    vi.advanceTimersByTime(200)
    expect(storage.getItem(name)).toBeNull()
  })
})
