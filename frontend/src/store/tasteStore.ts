/**
 * 口味画像的手动修正。
 *
 * 推荐是从收听行为里推出来的，而行为会撒谎：陪人听过一整张不喜欢的专辑、
 * 睡着时循环了一夜、给孩子放过儿歌——这些都会变成「你喜欢」。
 * 没有一个说「不是，别再给我推这个」的地方，画像就只能越错越深。
 *
 * 存归一化后的键（小写去空白），和推荐引擎内部用的键一致，
 * 免得展示名一改（重打标签、换语言）静音就失效。
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { STORAGE_KEYS } from '@/services/storageKeys'
import { normalizeText } from '@/utils/songIdentity'

interface TasteState {
  /** 不再推荐的歌手（归一化键） */
  mutedArtists: string[]
  /** 不再推荐的曲风（归一化键） */
  mutedGenres: string[]

  toggleArtist: (key: string) => void
  toggleGenre: (key: string) => void
  clearAll: () => void
}

function toggle(list: string[], key: string): string[] {
  return list.includes(key) ? list.filter(item => item !== key) : [...list, key]
}

/**
 * 旧屏蔽键重归一（复审 A3）：v0 存的是 trim+lower（保留空格与分隔符），
 * 画像键改为 normalizeText 后两者形状分叉——过滤仍生效（比较走
 * artistBlockedBy 的兜底），但界面 `includes` 显示「未屏蔽」，且点一下
 * 只加新键、再点只删新键，旧键永远删不掉。迁移把每个键重归一成新形态；
 * 归一后为空的键丢弃。
 */
export function migrateTasteKeys(persisted: unknown): Pick<TasteState, 'mutedArtists' | 'mutedGenres'> {
  const source = (persisted ?? {}) as { state?: { mutedArtists?: string[]; mutedGenres?: string[] } }
  const renorm = (list: string[] | undefined): string[] => {
    const seen = new Set<string>()
    for (const key of list ?? []) {
      const normalized = normalizeText(key)
      if (normalized) seen.add(normalized)
    }
    return [...seen]
  }
  return {
    mutedArtists: renorm(source.state?.mutedArtists),
    mutedGenres: renorm(source.state?.mutedGenres),
  }
}

export const useTasteStore = create<TasteState>()(
  persist(
    set => ({
      mutedArtists: [],
      mutedGenres: [],
      toggleArtist: key => set(state => ({ mutedArtists: toggle(state.mutedArtists, key) })),
      toggleGenre: key => set(state => ({ mutedGenres: toggle(state.mutedGenres, key) })),
      clearAll: () => set({ mutedArtists: [], mutedGenres: [] }),
    }),
    {
      name: STORAGE_KEYS.tasteStore,
      version: 1,
      migrate: (persisted, version) => {
        if (version >= 1) return persisted as TasteState
        /* v0：重归一旧键，界面的 includes 与 toggle 从此和画像键同一形态 */
        return { ...(persisted as object), state: migrateTasteKeys(persisted) } as unknown as TasteState
      },
    }
  )
)

/** 推荐层要的是 Set；这里集中转换一次，避免每个调用方各转各的 */
export function readMutedSets(): { artists: Set<string>; genres: Set<string> } {
  const state = useTasteStore.getState()
  return {
    artists: new Set(state.mutedArtists),
    genres: new Set(state.mutedGenres),
  }
}
