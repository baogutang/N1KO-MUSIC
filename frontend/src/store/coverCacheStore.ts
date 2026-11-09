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

interface CoverCache {
  /** 封面图片 URL */
  url: string
  /** 保存时间 */
  savedAt: number
}

/**
 * 组合缓存 key：serverId:songId
 * 不同服务器的歌曲 ID 可能相同，必须按服务器隔离。
 *
 * serverId 取**歌曲自己的来源**（与歌词缓存同一规矩）：只取「当前主库」的话，
 * 外源歌曲钉住的封面会记到主库名下，和主库里同 id 的另一首歌撞键。
 * 缺省回落主库只作兼容旧调用。
 */
function scopedKey(songId: string, serverId?: string): string {
  // `||`：持久化的老队列里歌曲可能没有 serverId 或是空串，别拼出 ':id' 这种键
  const owner = serverId || useServerStore.getState().activeServerId || 'default'
  return `${owner}:${songId}`
}

/**
 * 在缓存里查这首歌钉住的封面：带音源的键优先，旧版裸 songId 键兜底
 * （旧数据不迁移、不删除，只在读取时兼容）。
 * 纯函数：组件用它做 selector，直接订阅「这首歌对应的那一项」。
 */
export function lookupPinnedCover(
  cache: Record<string, CoverCache>,
  songId: string,
  serverId?: string
): string | null {
  return cache[scopedKey(songId, serverId)]?.url ?? cache[songId]?.url ?? null
}

interface CoverCacheState {
  /** 封面缓存，key 为 serverId:songId（旧版数据为裸 songId，读取时兼容回退） */
  cache: Record<string, CoverCache>

  /** 保存封面到本地缓存（serverId 是歌曲自己的来源，缺省按主库） */
  saveCover: (songId: string, url: string, serverId?: string) => void

  /** 获取本地缓存的封面 URL */
  getCover: (songId: string, serverId?: string) => string | null

  /** 删除本地缓存的封面（带音源的键与旧版裸键一并清，否则旧键会让封面「移除不掉」） */
  removeCover: (songId: string, serverId?: string) => void

  /** 清除所有缓存 */
  clearCache: () => void

  /** 裁剪到指定条数（保留最近保存的），用于响应存储配额压力 */
  trimTo: (limit: number) => void
}

export const useCoverCacheStore = create<CoverCacheState>()(
  persist(
    (set, get) => ({
      cache: {},

      saveCover: (songId: string, url: string, serverId?: string) => {
        set(state => ({
          cache: capByRecency(
            {
              ...state.cache,
              [scopedKey(songId, serverId)]: {
                url,
                savedAt: Date.now(),
              },
            },
            COVER_CACHE_LIMIT
          ),
        }))
      },

      getCover: (songId: string, serverId?: string) =>
        // 旧版数据用裸 songId 作 key，找不到作用域 key 时兼容回退
        lookupPinnedCover(get().cache, songId, serverId),

      removeCover: (songId: string, serverId?: string) => {
        set(state => {
          const { [scopedKey(songId, serverId)]: _, [songId]: __, ...rest } = state.cache
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
