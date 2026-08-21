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
  /**
   * 每批展示过的曲目 key，用于「换一批」时排除。
   * 按 `${scope}#${batch}` 分桶：排除时只取更早的批次，
   * 否则 queryFn 一旦重跑（StrictMode、refetch）就会把用户正看着的这批整批排掉。
   */
  shown: Record<string, string[]>
  getCursor: (scope: string) => number
  advance: (scope: string) => void
  rememberShown: (scope: string, batch: number, keys: string[]) => void
  /** 取该 scope 下所有早于 batch 的批次展示过的 key */
  getShownBefore: (scope: string, batch: number) => string[]
}

/** 只保留最近这么多条已展示记录，避免键无限增长 */
const MAX_SHOWN_PER_SCOPE = 300
/**
 * 只保留最近这么多个分桶。
 * 每个「服务器 + 日期」下每按一次换一批就多一个桶，因此这个上限要放宽一些。
 */
const MAX_SCOPES = 40

/**
 * 裁剪到 MAX_SCOPES 个键。
 *
 * JS 字符串键按插入顺序遍历，但**已存在的键被重新赋值时位置不变**，
 * 所以不能简单地认为尾部就是最新的。这里显式保住 keepKey，
 * 避免刚写进去的当前批次被自己挤掉。
 */
function prune<T>(record: Record<string, T>, keepKey?: string): Record<string, T> {
  const keys = Object.keys(record)
  if (keys.length <= MAX_SCOPES) return record
  const kept = new Set(keys.slice(-MAX_SCOPES))
  if (keepKey && record[keepKey] !== undefined) kept.add(keepKey)
  const out: Record<string, T> = {}
  for (const key of keys) if (kept.has(key)) out[key] = record[key]
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
          cursors: prune({ ...state.cursors, [scope]: (state.cursors[scope] ?? 0) + 1 }, scope),
        })),

      rememberShown: (scope, batch, keys) =>
        set(state => {
          if (!keys.length) return state
          const bucket = `${scope}#${batch}`
          const existing = state.shown[bucket] ?? []
          // 同一批次重跑时覆盖而不是累加，避免桶无意义地膨胀
          const deduped = Array.from(new Set(keys)).slice(0, MAX_SHOWN_PER_SCOPE)
          if (existing.length === deduped.length && existing.every((k, i) => k === deduped[i])) {
            return state
          }
          return { shown: prune({ ...state.shown, [bucket]: deduped }, bucket) }
        }),

      getShownBefore: (scope, batch) => {
        const shown = get().shown
        const out: string[] = []
        for (let i = 0; i < batch; i++) {
          const bucket = shown[`${scope}#${i}`]
          if (bucket) out.push(...bucket)
        }
        return out
      },
    }),
    {
      name: STORAGE_KEYS.recommendationCursor,
      storage: createPersistStorage({ debounceMs: 400 }),
      partialize: (state) => ({ cursors: state.cursors, shown: state.shown }),
    }
  )
)
