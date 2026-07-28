/**
 * 收听历史的 IndexedDB 存储层。
 *
 * 历史此前存在 localStorage 里，带来两个结构性问题：
 * 1. 全域配额只有约 5MB，历史与播放队列、歌词封面缓存互相挤占，撑满后写入抛错；
 * 2. 每次追加都要把整份历史 JSON.parse + JSON.stringify 重写一遍，播放中每 30 秒
 *    在主线程上做一次 O(n) 序列化。
 *
 * IndexedDB 配额通常按磁盘剩余空间的百分比计算（远大于 5MB），
 * 且支持按主键单条写入，追加一条记录不再需要重写全部数据。
 *
 * 本模块只做存储，不含业务语义；不可用时全部接口安全降级。
 */

const DB_NAME = 'n1ko-music'
const DB_VERSION = 1
const STORE_NAME = 'listening-events'
const SERVER_INDEX = 'by-server'

/** IndexedDB 不可用（隐私模式、老旧 WebView）时缓存该判定，避免反复尝试 */
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
      console.warn('[historyDb] 打开数据库失败，降级到 localStorage：', error)
      resolve(null)
      return
    }

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'eventId' })
        store.createIndex(SERVER_INDEX, 'serverId', { unique: false })
      }
    }
    request.onsuccess = () => {
      const db = request.result
      // 其他标签页触发版本升级时必须让出连接，否则会永久阻塞
      db.onversionchange = () => {
        db.close()
        dbPromise = null
      }
      resolve(db)
    }
    request.onerror = () => {
      unavailable = true
      console.warn('[historyDb] 打开数据库失败，降级到 localStorage：', request.error)
      resolve(null)
    }
    request.onblocked = () => {
      console.warn('[historyDb] 数据库升级被其他标签页阻塞')
      resolve(null)
    }
  })
}

function getDb(): Promise<IDBDatabase | null> {
  if (!dbPromise) dbPromise = openDb()
  return dbPromise
}

export function isHistoryDbAvailable(): boolean {
  return !unavailable
}

/** 仅供测试：断开连接并重置模块级状态 */
export async function resetHistoryDbForTests(): Promise<void> {
  const db = await getDb().catch(() => null)
  db?.close()
  dbPromise = null
  unavailable = false
  await new Promise<void>(resolve => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => Promise<T>
): Promise<T | null> {
  const db = await getDb()
  if (!db) return null
  try {
    const transaction = db.transaction(STORE_NAME, mode)
    const result = await run(transaction.objectStore(STORE_NAME))
    // 读事务无需等待，写事务要确认落盘后才算成功
    if (mode === 'readonly') return result
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
    return result
  } catch (error) {
    console.warn('[historyDb] 事务失败：', error)
    return null
  }
}

/** 读取全部记录；返回 null 表示存储不可用（与「确实为空」区分开） */
export async function readAllEvents<T>(): Promise<T[] | null> {
  return withStore('readonly', store => requestToPromise(store.getAll() as IDBRequest<T[]>))
}

export async function putEvent(event: { eventId: string }): Promise<boolean> {
  const result = await withStore('readwrite', async store => {
    store.put(event)
    return true
  })
  return result === true
}

/** 返回是否确实落盘成功；调用方据此决定能否删除迁移来源 */
export async function putEvents(events: Array<{ eventId: string }>): Promise<boolean> {
  if (!events.length) return true
  const result = await withStore('readwrite', async store => {
    for (const event of events) store.put(event)
    return true
  })
  return result === true
}

export async function deleteEventsByServer(serverId: string): Promise<void> {
  await withStore('readwrite', async store => {
    const keys = await requestToPromise(
      store.index(SERVER_INDEX).getAllKeys(serverId) as IDBRequest<IDBValidKey[]>
    )
    for (const key of keys) store.delete(key)
  })
}

export async function deleteEvents(eventIds: string[]): Promise<void> {
  if (!eventIds.length) return
  await withStore('readwrite', async store => {
    for (const id of eventIds) store.delete(id)
  })
}
