/**
 * 曲库元数据的离线缓存。
 *
 * React Query 的缓存活在内存里：关掉标签页就没了。于是每次冷启动都是同一个流程——
 * 白屏、转圈、等服务器。在弱网、在通勤路上、在服务器还没醒过来的时候，
 * 这段等待就是整个软件给人的第一印象。
 *
 * 这里把列表结果按查询键落到 IndexedDB：下次打开先把上次的内容摆出来，
 * 网络回来了再悄悄替换。**它不是离线下载**——音频一个字节都不缓存，
 * 缓存的只是「有哪些专辑、哪些歌手、上次那一页长什么样」。
 *
 * 存储层不含任何业务语义，不可用时全部接口安全降级为 no-op。
 */

const DB_NAME = 'n1ko-music-library'
const DB_VERSION = 1
const STORE_NAME = 'query-cache'
const UPDATED_INDEX = 'by-updated'

/** 缓存条目的保鲜期。过期的仍然会被摆出来（总比白屏好），但会立刻去拉新的。 */
export const LIBRARY_CACHE_TTL_MS = 24 * 60 * 60 * 1000
/** 条目数上限。曲库列表本身不大，这个数量足够覆盖常用视图。 */
export const MAX_CACHE_ENTRIES = 240

export interface CacheEntry<T = unknown> {
  /** 查询键序列化后的字符串 */
  key: string
  /** 所属服务器，换服务器时用来整批清掉 */
  serverId: string
  updatedAt: number
  value: T
}

let unavailable = false
let dbPromise: Promise<IDBDatabase | null> | null = null

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function openDb(): Promise<IDBDatabase | null> {
  if (unavailable) return Promise.resolve(null)
  if (typeof indexedDB === 'undefined') {
    unavailable = true
    return Promise.resolve(null)
  }
  return new Promise(resolve => {
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION)
    } catch (error) {
      unavailable = true
      console.warn('[libraryCache] 打开数据库失败，本次会话不使用离线缓存：', error)
      resolve(null)
      return
    }
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' })
        store.createIndex(UPDATED_INDEX, 'updatedAt', { unique: false })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => {
      unavailable = true
      console.warn('[libraryCache] 数据库不可用，本次会话不使用离线缓存')
      resolve(null)
    }
  })
}

function getDb(): Promise<IDBDatabase | null> {
  if (!dbPromise) dbPromise = openDb()
  return dbPromise
}

export async function readCacheEntry<T>(key: string): Promise<CacheEntry<T> | null> {
  const db = await getDb()
  if (!db) return null
  try {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const entry = await requestToPromise(tx.objectStore(STORE_NAME).get(key))
    return (entry as CacheEntry<T> | undefined) ?? null
  } catch {
    return null
  }
}

export async function writeCacheEntry<T>(
  key: string,
  serverId: string,
  value: T,
  now = Date.now()
): Promise<void> {
  const db = await getDb()
  if (!db) return
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put({ key, serverId, updatedAt: now, value } satisfies CacheEntry<T>)
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    // 配额满、隐私模式：缓存写不进去不影响任何功能
  }
}

/**
 * 上限裁剪：按更新时间从旧到新删。
 *
 * 用索引游标而不是「取出全部再排序」——全部取出会把整份缓存读进内存，
 * 而这个函数存在的意义恰恰是控制内存和磁盘占用。
 */
export async function pruneCache(max = MAX_CACHE_ENTRIES): Promise<number> {
  const db = await getDb()
  if (!db) return 0
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const total = await requestToPromise(store.count())
    if (total <= max) return 0

    let toDelete = total - max
    const cursorRequest = store.index(UPDATED_INDEX).openCursor()
    await new Promise<void>((resolve, reject) => {
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result
        if (!cursor || toDelete <= 0) { resolve(); return }
        cursor.delete()
        toDelete--
        cursor.continue()
      }
      cursorRequest.onerror = () => reject(cursorRequest.error)
    })
    return total - max
  } catch {
    return 0
  }
}

/** 换服务器 / 退出登录时清掉该服务器的缓存，别让上一台的内容闪在新一台上 */
export async function clearCacheForServer(serverId: string): Promise<void> {
  const db = await getDb()
  if (!db) return
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const cursorRequest = store.openCursor()
    await new Promise<void>((resolve, reject) => {
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result
        if (!cursor) { resolve(); return }
        if ((cursor.value as CacheEntry).serverId === serverId) cursor.delete()
        cursor.continue()
      }
      cursorRequest.onerror = () => reject(cursorRequest.error)
    })
  } catch {
    // 清不掉也不影响：条目会因为 serverId 不匹配而不被读取
  }
}

/** 仅供测试重置模块级状态 */
export function resetLibraryCacheForTests(): void {
  unavailable = false
  dbPromise = null
}
