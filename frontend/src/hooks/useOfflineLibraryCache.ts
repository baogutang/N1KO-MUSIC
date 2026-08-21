/**
 * 把曲库列表的查询结果落到 IndexedDB，冷启动时先摆出来。
 *
 * React Query 的缓存只在内存里，关掉标签页就没了；每次冷启动都是白屏 → 转圈 →
 * 等服务器。这一层订阅查询缓存，把「值得离线摆出来」的那几类结果写进
 * IndexedDB，并在启动时把它们喂回 React Query 作为初始数据。
 *
 * 三条规矩：
 *   1. 只缓存列表与详情这类**元数据**，不碰音频，也不碰任何带凭据的东西；
 *   2. 缓存条目带 serverId，换服务器绝不会把上一台的内容闪出来；
 *   3. 落盘的永远是「服务器刚给的那份」，页面上不会出现一份缓存写回去又被
 *      当成新数据再存一次的循环。
 */

import { useEffect } from 'react'
import { useQueryClient, type Query } from '@tanstack/react-query'
import { useServerStore } from '@/store/serverStore'
import {
  clearCacheForServer, pruneCache, readCacheEntry, writeCacheEntry,
  LIBRARY_CACHE_TTL_MS,
} from '@/services/libraryCacheDb'

/**
 * 值得离线保留的查询类别。
 *
 * 白名单而不是黑名单：搜索结果、随机曲目、正在播放的人这类东西离线摆出来
 * 只会误导——它们的意义就在于「此刻」。
 */
const CACHEABLE = new Set(['albums', 'artists', 'playlists', 'starred', 'genres'])

/**
 * queryKey 的第一段是 serverKey()，第二段是类别。
 *
 * 详情页（albums/<id>、artists/<id>）与列表共用第二段，因此一并被覆盖——
 * 这正是想要的：翻回上次看过的那张专辑时不该再白屏一次。
 */
function categoryOf(queryKey: readonly unknown[]): string | null {
  const category = queryKey[1]
  return typeof category === 'string' && CACHEABLE.has(category) ? category : null
}

function cacheKeyOf(queryKey: readonly unknown[]): string {
  return JSON.stringify(queryKey)
}

export function useOfflineLibraryCache(): void {
  const queryClient = useQueryClient()
  const serverId = useServerStore(s => s.activeServerId)

  useEffect(() => {
    if (!serverId) return
    let cancelled = false
    /**
     * 已经尝试恢复过的查询键：同一个键不必反复读盘。
     *
     * 命中缓存并成功恢复的键会被移出去。否则一旦 React Query 把那条查询回收，
     * 下一次再进同一个页面就不会再从盘上恢复——离线时看到的是错误态，
     * 而盘上明明有内容。
     */
    const attempted = new Set<string>()

    const restore = async (query: Query<unknown, unknown, unknown, readonly unknown[]>) => {
      if (cancelled) return
      if (!categoryOf(query.queryKey)) return
      // 已经有数据（内存缓存命中、或刚拉到）就不要用旧的去盖
      if (query.state.data !== undefined) return
      const key = cacheKeyOf(query.queryKey)
      if (attempted.has(key)) return
      attempted.add(key)

      const entry = await readCacheEntry(key)
      if (cancelled || !entry || entry.serverId !== serverId) return
      // 读盘期间网络可能已经回来了，别再把旧的盖上去
      if (queryClient.getQueryData(query.queryKey) !== undefined) return

      queryClient.setQueryData(query.queryKey, entry.value)
      // 恢复成功：把标记撤掉，这条查询被回收后再回来还能再恢复一次
      attempted.delete(key)
      /**
       * 过期的仍然摆出来，但立刻标记为陈旧去拉新的。
       * 「先看到上次的东西，再被悄悄换成新的」好过白屏等一秒；
       * 反过来「拿着一天前的数据装作是新的」则不可接受。
       */
      if (Date.now() - entry.updatedAt > LIBRARY_CACHE_TTL_MS) {
        void queryClient.invalidateQueries({ queryKey: query.queryKey, exact: true })
      }
    }

    const cache = queryClient.getQueryCache()
    // 挂载时已经存在的那些
    for (const query of cache.getAll()) {
      void restore(query as Query<unknown, unknown, unknown, readonly unknown[]>)
    }

    /**
     * 也要盯着**之后**才出现的查询。
     *
     * 这个 hook 挂在布局层，而页面是懒加载的路由，它们的查询几乎总是在这之后
     * 才被创建。只扫一次已有的查询，等于只覆盖到了首页那几条。
     */
    const unsubscribe = cache.subscribe(event => {
      const query = event.query as Query<unknown, unknown, unknown, readonly unknown[]>
      if (event.type === 'added') {
        void restore(query)
        return
      }
      if (event.type !== 'updated') return
      if (event.action.type !== 'success') return
      /**
       * manual 为真表示这次数据来自 setQueryData——也就是我们刚从盘上读回来的
       * 那一份。再写一次会把 updatedAt 刷新成「现在」，缓存于是永远不会过期。
       */
      if ((event.action as { manual?: boolean }).manual) return
      if (!categoryOf(query.queryKey)) return
      const data = query.state.data
      if (data === undefined) return
      void writeCacheEntry(cacheKeyOf(query.queryKey), serverId, data)
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [queryClient, serverId])

  // 定期裁剪，避免缓存无限长
  useEffect(() => {
    const timer = window.setTimeout(() => { void pruneCache() }, 8_000)
    return () => window.clearTimeout(timer)
  }, [])

  // 换服务器时把上一台的缓存清掉
  useEffect(() => {
    let previous = serverId
    return useServerStore.subscribe(state => {
      if (state.activeServerId === previous) return
      const stale = previous
      previous = state.activeServerId
      if (stale) void clearCacheForServer(stale)
    })
  }, [serverId])
}
