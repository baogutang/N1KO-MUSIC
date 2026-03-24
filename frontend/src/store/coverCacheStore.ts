/**
 * 本地封面缓存 Store
 *
 * 用于在浏览器本地存储用户通过远程 API 搜索并确认保存的封面图片 URL。
 * 优先级：本地缓存 > 远程 API > 服务器封面
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface CoverCache {
  /** 封面图片 URL */
  url: string
  /** 保存时间 */
  savedAt: number
}

interface CoverCacheState {
  /** 封面缓存，key 为 songId */
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
            [songId]: {
              url,
              savedAt: Date.now(),
            },
          },
        }))
      },

      getCover: (songId: string) => {
        return get().cache[songId]?.url ?? null
      },

      removeCover: (songId: string) => {
        set(state => {
          const { [songId]: _, ...rest } = state.cache
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
