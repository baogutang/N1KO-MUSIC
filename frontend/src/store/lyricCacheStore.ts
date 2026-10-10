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
import { createPersistStorage } from '@/store/persistStorage'
import {
  LYRICS_BYTE_BUDGET,
  LYRICS_CACHE_LIMIT,
  STORAGE_KEYS,
  STORAGE_PRESSURE_EVENT,
} from '@/services/storageKeys'
import { capByBytes, capByRecency } from '@/utils/boundedCache'

interface LyricCache {
  /** 歌词文本（LRC 格式） */
  text: string
  /** 保存时间 */
  savedAt: number
}

/**
 * 缓存 key 按**歌曲自己的来源**分域（阶段 3.1）。
 *
 * 原先取的是「当前主库」：外源歌曲的歌词会记到主库名下；换一次主库，
 * 同一首歌的缓存就找不到了，而两个音源同 id 时还会互相串词。
 * serverId 由调用方（useLyricsQuery / SongDetail）从歌曲身上带过来；
 * 缺省回落主库只作兼容旧调用。
 */
function cacheKey(songId: string, serverId?: string): string {
  const owner = serverId ?? useServerStore.getState().activeServerId ?? ''
  return `${owner}:${songId}`
}

interface LyricCacheState {
  /** 歌词缓存，key 为 `${serverId}:${songId}` */
  cache: Record<string, LyricCache>

  /** 保存歌词到本地缓存（serverId 是歌曲自己的来源，缺省按主库） */
  saveLyrics: (songId: string, text: string, serverId?: string) => void

  /** 获取本地缓存的歌词 */
  getLyrics: (songId: string, serverId?: string) => string | null

  /** 删除本地缓存的歌词 */
  removeLyrics: (songId: string, serverId?: string) => void

  /** 删除某个音源名下的全部条目（删源时清理，不留读不到的死词） */
  removeServerEntries: (serverId: string) => void

  /** 清除所有缓存 */
  clearCache: () => void

  /** 裁剪到指定条数（保留最近保存的），用于响应存储配额压力 */
  trimTo: (limit: number) => void
}

export const useLyricCacheStore = create<LyricCacheState>()(
  persist(
    (set, get) => ({
      cache: {},

      saveLyrics: (songId, text, serverId) => {
        set(state => ({
          // 条数与字节双重封顶：条数挡住键爆炸，字节挡住单条超大的 LRC
          cache: capByBytes(
            capByRecency(
              {
                ...state.cache,
                [cacheKey(songId, serverId)]: {
                  text,
                  savedAt: Date.now(),
                },
              },
              LYRICS_CACHE_LIMIT
            ),
            LYRICS_BYTE_BUDGET
          ),
        }))
      },

      getLyrics: (songId, serverId) => {
        return get().cache[cacheKey(songId, serverId)]?.text ?? null
      },

      removeLyrics: (songId, serverId) => {
        set(state => {
          const { [cacheKey(songId, serverId)]: _, ...rest } = state.cache
          return { cache: rest }
        })
      },

      removeServerEntries: (serverId) => {
        const prefix = `${serverId}:`
        set(state => {
          let changed = false
          const rest: typeof state.cache = {}
          for (const [key, value] of Object.entries(state.cache)) {
            if (key.startsWith(prefix)) changed = true
            else rest[key] = value
          }
          return changed ? { cache: rest } : state
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
      name: STORAGE_KEYS.lyricsCache,
      storage: createPersistStorage(),
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

// 配额告急时主动减半，否则回收掉的条目会被下一次 persist 原样写回
if (typeof window !== 'undefined') {
  window.addEventListener(STORAGE_PRESSURE_EVENT, () => {
    useLyricCacheStore.getState().trimTo(Math.floor(LYRICS_CACHE_LIMIT / 2))
  })
}
