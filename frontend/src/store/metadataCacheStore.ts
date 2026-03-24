/**
 * 本地元信息缓存 Store
 *
 * 用于在浏览器本地存储用户手动编辑的歌曲元信息。
 * 因为某些媒体服务器（如 Navidrome）不支持保存元信息到服务器，
 * 所以需要在前端本地缓存这些修改。
 *
 * 优先级：本地缓存 > 服务器原始数据
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Song } from '@/api/types'

interface MetadataCacheEntry {
  /** 修改后的元信息（只存变化的字段） */
  metadata: Partial<Pick<Song, 'title' | 'album' | 'artist' | 'year' | 'genre' | 'track'>>
  /** 保存时间 */
  savedAt: number
}

interface MetadataCacheState {
  /** 元信息缓存，key 为 songId */
  cache: Record<string, MetadataCacheEntry>

  /** 保存元信息到本地缓存 */
  saveMetadata: (songId: string, metadata: MetadataCacheEntry['metadata']) => void

  /** 获取本地缓存的元信息 */
  getMetadata: (songId: string) => MetadataCacheEntry['metadata'] | null

  /** 删除本地缓存的元信息 */
  removeMetadata: (songId: string) => void

  /** 清除所有缓存 */
  clearCache: () => void

  /**
   * 合并服务器原始数据与本地缓存，返回优先使用缓存的合并结果
   * 用于在详情页和播放器中展示
   */
  getMergedSong: (song: Song) => Song
}

export const useMetadataCacheStore = create<MetadataCacheState>()(
  persist(
    (set, get) => ({
      cache: {},

      saveMetadata: (songId: string, metadata: MetadataCacheEntry['metadata']) => {
        set(state => ({
          cache: {
            ...state.cache,
            [songId]: {
              metadata,
              savedAt: Date.now(),
            },
          },
        }))
      },

      getMetadata: (songId: string) => {
        return get().cache[songId]?.metadata ?? null
      },

      removeMetadata: (songId: string) => {
        set(state => {
          const { [songId]: _, ...rest } = state.cache
          return { cache: rest }
        })
      },

      clearCache: () => {
        set({ cache: {} })
      },

      getMergedSong: (song: Song) => {
        const cached = get().cache[song.id]?.metadata
        if (!cached) return song
        return { ...song, ...cached }
      },
    }),
    {
      name: 'msp-metadata-cache',
    }
  )
)
