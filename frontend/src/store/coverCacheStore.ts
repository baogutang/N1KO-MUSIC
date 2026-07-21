/**
 * 本地封面缓存 Store
 *
 * 用于在浏览器本地存储用户通过远程 API 搜索并确认保存的封面图片 URL。
 * 优先级：本地缓存 > 远程 API > 服务器封面
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useServerStore } from './serverStore'

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
}

export const useCoverCacheStore = create<CoverCacheState>()(
  persist(
    (set, get) => ({
      cache: {},

      saveCover: (songId: string, url: string) => {
        set(state => ({
          cache: {
            ...state.cache,
            [scopedKey(songId)]: {
              url,
              savedAt: Date.now(),
            },
          },
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
    }),
    {
      name: 'msp-cover-cache',
    }
  )
)
