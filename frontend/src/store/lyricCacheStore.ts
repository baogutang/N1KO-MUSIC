/**
 * 本地歌词缓存 Store
 * 
 * 用于在浏览器本地存储用户通过远程 API 搜索并确认保存的歌词。
 * 因为某些媒体服务器（如 Navidrome）不支持保存歌词到服务器，
 * 所以我们需要在前端本地缓存这些歌词。
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface LyricCache {
  /** 歌词文本（LRC 格式） */
  text: string
  /** 保存时间 */
  savedAt: number
}

interface LyricCacheState {
  /** 歌词缓存，key 为 songId */
  cache: Record<string, LyricCache>

  /** 保存歌词到本地缓存 */
  saveLyrics: (songId: string, text: string) => void

  /** 获取本地缓存的歌词 */
  getLyrics: (songId: string) => string | null

  /** 删除本地缓存的歌词 */
  removeLyrics: (songId: string) => void

  /** 清除所有缓存 */
  clearCache: () => void
}

export const useLyricCacheStore = create<LyricCacheState>()(
  persist(
    (set, get) => ({
      cache: {},

      saveLyrics: (songId: string, text: string) => {
        set(state => ({
          cache: {
            ...state.cache,
            [songId]: {
              text,
              savedAt: Date.now(),
            },
          },
        }))
      },

      getLyrics: (songId: string) => {
        return get().cache[songId]?.text ?? null
      },

      removeLyrics: (songId: string) => {
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
      name: 'msp-lyrics-cache',
    }
  )
)
