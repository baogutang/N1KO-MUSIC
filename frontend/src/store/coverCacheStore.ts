/**
 * 本地封面缓存 Store
 *
 * 用于在浏览器本地存储用户通过远程 API 搜索并确认保存的封面图片 URL。
 * 优先级：本地缓存 > 远程 API > 服务器封面
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useServerStore } from './serverStore'
import { createPersistStorage } from '@/store/persistStorage'
import { COVER_CACHE_LIMIT, STORAGE_KEYS, STORAGE_PRESSURE_EVENT } from '@/services/storageKeys'
import { capByRecency } from '@/utils/boundedCache'
import { retargetFileUrl } from '@/api/adapters/webdavLibrary'

interface CoverCache {
  /** 封面图片 URL */
  url: string
  /** 保存时间 */
  savedAt: number
}

/**
 * 组合缓存 key：serverId:songId
 * 不同服务器的歌曲 ID 可能相同，必须按服务器隔离
 */
function scopedKey(songId: string): string {
  const serverId = useServerStore.getState().activeServerId ?? 'default'
  return `${serverId}:${songId}`
}

interface CoverCacheState {
  /** 封面缓存，key 为 serverId:songId（旧版数据为裸 songId，读取时兼容回退） */
  cache: Record<string, CoverCache>

  /** 保存封面到本地缓存 */
  saveCover: (songId: string, url: string) => void

  /** 获取本地缓存的封面 URL */
  getCover: (songId: string) => string | null

  /** 删除本地缓存的封面 */
  removeCover: (songId: string) => void

  /** 清除所有缓存 */
  clearCache: () => void

  /** 裁剪到指定条数（保留最近保存的），用于响应存储配额压力 */
  trimTo: (limit: number) => void

  /** 服务器换地址后，把这个源的曲目键改到新文件地址。外站封面链接不动。 */
  retargetFileUrls: (serverId: string, base: string) => void
}

export const useCoverCacheStore = create<CoverCacheState>()(
  persist(
    (set, get) => ({
      cache: {},

      saveCover: (songId: string, url: string) => {
        set(state => ({
          cache: capByRecency(
            {
              ...state.cache,
              [scopedKey(songId)]: {
                url,
                savedAt: Date.now(),
              },
            },
            COVER_CACHE_LIMIT
          ),
        }))
      },

      getCover: (songId: string) => {
        const cache = get().cache
        // 旧版数据用裸 songId 作 key，找不到作用域 key 时兼容回退
        return cache[scopedKey(songId)]?.url ?? cache[songId]?.url ?? null
      },

      removeCover: (songId: string) => {
        set(state => {
          const { [scopedKey(songId)]: _, [songId]: __, ...rest } = state.cache
          return { cache: rest }
        })
      },

      clearCache: () => {
        set({ cache: {} })
      },

      trimTo: (limit: number) => {
        set(state => {
          const cache = capByRecency(state.cache, Math.max(0, limit))
          return cache === state.cache ? state : { cache }
        })
      },

      retargetFileUrls: (serverId, base) => {
        const prefix = `${serverId}:`
        set(state => {
          let changed = false
          const next: typeof state.cache = {}
          for (const [key, value] of Object.entries(state.cache)) {
            const songId = key.startsWith(prefix) ? key.slice(prefix.length) : key
            const owned = key.startsWith(prefix) || key.startsWith('http://') || key.startsWith('https://')
            if (!owned) {
              next[key] = value
              continue
            }
            const mapped = songId.startsWith('http://') || songId.startsWith('https://')
              ? retargetFileUrl(songId, base)
              : songId
            const nextKey = key.startsWith(prefix) ? prefix + mapped : mapped
            let nextUrl = value.url
            if (nextUrl.startsWith('http://') || nextUrl.startsWith('https://')) {
              try {
                if (new URL(songId).origin === new URL(nextUrl).origin) nextUrl = retargetFileUrl(nextUrl, base)
              } catch {
                nextUrl = value.url
              }
            }
            if (nextKey !== key || nextUrl !== value.url) changed = true
            next[nextKey] = nextUrl === value.url ? value : { ...value, url: nextUrl }
          }
          return changed ? { cache: next } : state
        })
      },
    }),
    {
      name: STORAGE_KEYS.coverCache,
      storage: createPersistStorage(),
    }
  )
)

// 配额告急时主动减半，否则回收掉的条目会被下一次 persist 原样写回
if (typeof window !== 'undefined') {
  window.addEventListener(STORAGE_PRESSURE_EVENT, () => {
    useCoverCacheStore.getState().trimTo(Math.floor(COVER_CACHE_LIMIT / 2))
  })
}
