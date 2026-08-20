/**
 * zustand persist 的存储适配器。
 *
 * zustand v4 在**每次** setState 之后都会无条件调用 storage.setItem，与
 * partialize 无关（见 zustand/middleware.js 的 `set(...); void setItem()`）。
 * 播放中 setCurrentTime 每 200ms 触发一次，默认适配器因此会把整个播放队列
 * 反复 JSON.stringify 并同步写盘：500 首队列约等于 1MB/s 的主线程写入，
 * 并且在配额耗尽时同步抛出 QuotaExceededError —— 抛在 useEffect 里会冒泡到
 * ErrorBoundary，表现为「页面出现问题」白屏。
 *
 * 本适配器做三件事：
 * 1. 浅比较 partialize 结果，未变化直接跳过（播放稳态下零序列化、零写入）
 * 2. 合并写入窗口，吸收连续变更
 * 3. 写入失败先回收空间重试一次，最终失败只告警，绝不向调用方抛出
 */

import type { PersistStorage, StorageValue } from 'zustand/middleware'
import { reclaimStorage } from '@/services/storageMaintenance'

const DEFAULT_DEBOUNCE_MS = 600

interface PendingWrite {
  value: StorageValue<unknown>
  timer: ReturnType<typeof setTimeout> | null
}

const pendingWrites = new Map<string, PendingWrite>()
/** 最近一次已排入写入队列的快照，用于跳过无变化的重复写入 */
const lastSnapshot = new Map<string, StorageValue<unknown>>()

/** SSR / 测试环境没有 localStorage，属于预期情况而非错误 */
function hasLocalStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined'
  } catch {
    return false
  }
}

/**
 * partialize 每次都会产出新的外层对象，但内部引用（如 queue 数组、currentSong 对象）
 * 只在真正变更时才更换，因此浅比较足以识别「这次 set 与持久化内容无关」。
 */
function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const leftKeys = Object.keys(left)
  if (leftKeys.length !== Object.keys(right).length) return false
  return leftKeys.every(key => Object.is(left[key], right[key]))
}

/**
 * 记录「这个键在回收之后仍然写不进去的体量」。
 * 后续同等或更大的载荷直接放弃，不再触发一轮无意义的缓存回收。
 */
const hopelessSize = new Map<string, number>()

function commit(name: string): void {
  const pending = pendingWrites.get(name)
  if (!pending) return
  if (pending.timer !== null) clearTimeout(pending.timer)
  pendingWrites.delete(name)
  if (!hasLocalStorage()) return

  const payload = JSON.stringify(pending.value)
  try {
    localStorage.setItem(name, payload)
    // 写成功说明配额压力已缓解，允许下次再触发回收
    hopelessSize.delete(name)
    return
  } catch {
    // 配额不足，进入回收后重试
  }

  // 已知这个体量回收过也写不进去，就不要再回收一次。
  // 否则长队列会变成：每次切歌写入失败 → 清空封面/歌词/推荐缓存 → 仍然写不进，
  // 缓存被反复抹掉而持久化永远不会成功。
  const hopeless = hopelessSize.get(name)
  if (hopeless !== undefined && payload.length >= hopeless) {
    lastSnapshot.delete(name)
    return
  }

  try {
    reclaimStorage(name)
    localStorage.setItem(name, payload)
    hopelessSize.delete(name)
  } catch (error) {
    // 回收后仍写不进：放弃本次持久化，内存状态照常可用，下次变更再试。
    lastSnapshot.delete(name)
    hopelessSize.set(name, payload.length)
    console.warn(`[persist] ${name} 写入失败，本次变更仅存在于内存：`, error)
  }
}

/** 立即落盘所有待写入内容，用于页面隐藏/卸载前避免丢失 */
export function flushPersistedStores(): void {
  for (const name of Array.from(pendingWrites.keys())) commit(name)
}

/**
 * 注册生命周期钩子：移动端（Capacitor）与浏览器都可能在不触发 unload 的情况下
 * 直接冻结或杀掉页面，pagehide 与 visibilitychange 是最可靠的两个时机。
 */
export function registerPersistFlushHooks(): void {
  if (typeof window === 'undefined') return
  window.addEventListener('pagehide', flushPersistedStores)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPersistedStores()
  })
}

interface PersistStorageOptions {
  /**
   * 写入合并窗口（毫秒）。0 表示同步写入，适用于体积小且不可重建的状态
   * （服务器凭据、设置、主题），避免进程被杀时丢失。
   */
  debounceMs?: number
}

export function createPersistStorage<T>(
  { debounceMs = DEFAULT_DEBOUNCE_MS }: PersistStorageOptions = {}
): PersistStorage<T> {
  return {
    getItem: name => {
      if (!hasLocalStorage()) return null
      try {
        const raw = localStorage.getItem(name)
        if (!raw) return null
        return JSON.parse(raw) as StorageValue<T>
      } catch (error) {
        console.warn(`[persist] ${name} 解析失败，按未持久化处理：`, error)
        return null
      }
    },

    setItem: (name, value) => {
      const previous = lastSnapshot.get(name)
      if (previous && previous.version === value.version && shallowEqual(previous.state, value.state)) {
        return
      }
      lastSnapshot.set(name, value as StorageValue<unknown>)

      const existing = pendingWrites.get(name)
      if (existing) {
        existing.value = value as StorageValue<unknown>
        return
      }

      if (debounceMs <= 0) {
        pendingWrites.set(name, { value: value as StorageValue<unknown>, timer: null })
        commit(name)
        return
      }

      const entry: PendingWrite = { value: value as StorageValue<unknown>, timer: null }
      pendingWrites.set(name, entry)
      entry.timer = setTimeout(() => commit(name), debounceMs)
    },

    removeItem: name => {
      const pending = pendingWrites.get(name)
      if (pending?.timer) clearTimeout(pending.timer)
      pendingWrites.delete(name)
      lastSnapshot.delete(name)
      if (!hasLocalStorage()) return
      try {
        localStorage.removeItem(name)
      } catch (error) {
        console.warn(`[persist] ${name} 清除失败：`, error)
      }
    },
  }
}
