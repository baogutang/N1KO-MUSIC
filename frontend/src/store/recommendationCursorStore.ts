/**
 * 「换一批」的批次游标。
 *
 * 这个值必须比组件活得久，而且必须全局唯一。
 * 旧实现把它放在 usePersonalizedRecommendations 内部的 useState 里：
 *  - 推荐页和首页都是 React.lazy 路由，离开再回来就重新挂载、游标归零，
 *    而那一批结果还躺在 localStorage 里且 TTL 24 小时，于是「换一批」的结果
 *    被静默回滚，再点一次又拿回同样缓存好的下一批——按钮在走一条预录的轮播带。
 *  - 首页与推荐页各持一个独立计数器，同一天的「今日推荐」两边显示不同内容。
 *
 * 按 serverId + 本地日期分桶，跨天自然归零。
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createPersistStorage } from '@/store/persistStorage'
import { STORAGE_KEYS } from '@/services/storageKeys'

interface RecommendationCursorState {
  /** key 形如 `${serverId}:${dayKey}` */
  cursors: Record<string, number>
  /** 每批展示过的曲目 key，用于「换一批」时排除 */
  shown: Record<string, string[]>
  getCursor: (scope: string) => number
  advance: (scope: string) => void
  rememberShown: (scope: string, keys: string[]) => void
  getShown: (scope: string) => string[]
}

/** 只保留最近这么多条已展示记录，避免键无限增长 */
const MAX_SHOWN_PER_SCOPE = 300
/** 只保留最近这么多个分桶（跨天/多服务器） */
const MAX_SCOPES = 8

function prune<T>(record: Record<string, T>): Record<string, T> {
  const keys = Object.keys(record)
  if (keys.length <= MAX_SCOPES) return record
  const kept = keys.slice(-MAX_SCOPES)
  const out: Record<string, T> = {}
  for (const key of kept) out[key] = record[key]
  return out
}

export const useRecommendationCursorStore = create<RecommendationCursorState>()(
  persist(
    (set, get) => ({
      cursors: {},
      shown: {},

      getCursor: (scope) => get().cursors[scope] ?? 0,

      advance: (scope) =>
        set(state => ({
          cursors: prune({ ...state.cursors, [scope]: (state.cursors[scope] ?? 0) + 1 }),
        })),

      rememberShown: (scope, keys) =>
        set(state => {
          if (!keys.length) return state
          const merged = [...(state.shown[scope] ?? []), ...keys]
          // 去重后保留最近的一段
          const deduped = Array.from(new Set(merged)).slice(-MAX_SHOWN_PER_SCOPE)
          return { shown: prune({ ...state.shown, [scope]: deduped }) }
        }),

      getShown: (scope) => get().shown[scope] ?? [],
    }),
    {
      name: STORAGE_KEYS.recommendationCursor,
      storage: createPersistStorage({ debounceMs: 400 }),
      partialize: (state) => ({ cursors: state.cursors, shown: state.shown }),
    }
  )
)
