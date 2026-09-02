/**
 * 插件的 IndexedDB 持久化（PLAN §4.2：db `n1ko-music-plugins`）。
 *
 * 三个对象仓：
 *  - plugins：已安装插件（manifest + 代码 + 哈希 + 来源）
 *  - meta：杂项（插件目录地址等）
 *  - storage：插件私有 KV（guid、匿名 cookie 等非敏感数据；键带 pluginId 前缀）
 *
 * 凭据不在这里——凭据走 serverStore 的 securePersistStorage 加密清单（红线）。
 */

import { openDB, type IDBPDatabase } from 'idb'

const DB_NAME = 'n1ko-music-plugins'
const DB_VERSION = 1

export interface StoredPlugin {
  manifest: {
    id: string
    [k: string]: unknown
  }
  code: string
  codeHash: string
  installedAt: number
  /** 目录或直链来源（manifest 地址），更新检查用 */
  sourceUrl?: string
}

let dbPromise: Promise<IDBPDatabase> | null = null

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('plugins')) db.createObjectStore('plugins', { keyPath: 'manifest.id' })
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta')
        if (!db.objectStoreNames.contains('storage')) db.createObjectStore('storage')
      },
    })
  }
  return dbPromise
}

// ---------------- 插件记录 ----------------

export async function readAllPlugins(): Promise<StoredPlugin[]> {
  const db = await getDb()
  return db.getAll('plugins') as Promise<StoredPlugin[]>
}

export async function readPlugin(id: string): Promise<StoredPlugin | undefined> {
  const db = await getDb()
  return db.get('plugins', id) as Promise<StoredPlugin | undefined>
}

export async function writePlugin(plugin: StoredPlugin): Promise<void> {
  const db = await getDb()
  await db.put('plugins', plugin)
}

/** 卸载清理：代码记录 + 私有 KV 一起删（PROTOCOL §9） */
export async function removePlugin(id: string): Promise<void> {
  const db = await getDb()
  await db.delete('plugins', id)
  const tx = db.transaction('storage', 'readwrite')
  const prefix = `${id}:`
  let cursor = await tx.objectStore('storage').openCursor()
  while (cursor) {
    if (String(cursor.key).startsWith(prefix)) await cursor.delete()
    cursor = await cursor.continue()
  }
  await tx.done
}

// ---------------- 私有 KV（PluginHostStorage 的落地） ----------------

function storageKey(pluginId: string, key: string): string {
  return `${pluginId}:${key}`
}

export async function pluginStorageGet(pluginId: string, key: string): Promise<string | null> {
  const db = await getDb()
  return ((await db.get('storage', storageKey(pluginId, key))) as string | undefined) ?? null
}

export async function pluginStorageSet(pluginId: string, key: string, value: string): Promise<void> {
  const db = await getDb()
  await db.put('storage', value, storageKey(pluginId, key))
}

// ---------------- meta ----------------

export async function readMeta(key: string): Promise<unknown> {
  const db = await getDb()
  return db.get('meta', key)
}

export async function writeMeta(key: string, value: unknown): Promise<void> {
  const db = await getDb()
  await db.put('meta', value, key)
}

// ---------------- 测试隔离 ----------------

/** 单测用：换一个全新内存态（fake-indexeddb 删库重建） */
export async function resetPluginDbForTests(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise
    db.close()
    dbPromise = null
  }
  indexedDB.deleteDatabase(DB_NAME)
}
