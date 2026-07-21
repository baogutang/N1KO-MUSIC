/**
 * 本地歌词缓存 Store
 *
 * 用于在浏览器本地存储用户通过远程 API 搜索并确认保存的歌词。
 * 因为某些媒体服务器（如 Navidrome）不支持保存歌词到服务器，
 * 所以我们需要在前端本地缓存这些歌词。
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useServerStore } from '@/store/serverStore'

interface LyricCache {
  /** 歌词文本（LRC 格式） */
  text: string
  /** 保存时间 */
  savedAt: number
}

/**
 * 缓存 key 需带上当前服务器 id：不同服务器（尤其 Subsonic/Airsonic 的数字自增 id）
 * 的 songId 会互相冲突，仅用 songId 会串词并抑制正确歌词的请求。
 */
function cacheKey(songId: string): string {
  const serverId = useServerStore.getState().activeServerId ?? ''
  return `${serverId}:${songId}`
}

interface LyricCacheState {
  /** 歌词缓存，key 为 `${serverId}:${songId}` */
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
            [cacheKey(songId)]: {
              text,
              savedAt: Date.now(),
            },
          },
        }))
      },

      getLyrics: (songId: string) => {
        return get().cache[cacheKey(songId)]?.text ?? null
      },

      removeLyrics: (songId: string) => {
        set(state => {
          const { [cacheKey(songId)]: _, ...rest } = state.cache
          return { cache: rest }
        })
      },

      clearCache: () => {
        set({ cache: {} })
      },
    }),
    {
      name: 'msp-lyrics-cache',
      version: 1,
      // v0 的条目只按 songId 存储，无法归属到具体服务器，直接丢弃以免跨服务器串词
      migrate: (persisted, version) => {
        if (version < 1) {
          return { ...(persisted as object), cache: {} } as LyricCacheState
        }
        return persisted as LyricCacheState
      },
    }
  )
)
