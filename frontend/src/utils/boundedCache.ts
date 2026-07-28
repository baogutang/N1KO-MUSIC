/**
 * 按保存时间淘汰的定长缓存工具。
 *
 * 歌词与封面缓存都以 Record 形式整体持久化到 localStorage，没有上限时会
 * 一直增长并挤占其他键的配额，因此写入侧必须自带淘汰。
 */

interface Timestamped {
  savedAt: number
}

/**
 * 把缓存裁剪到最多 limit 条，保留 savedAt 最新的条目。
 * 未超限时返回原对象引用，便于调用方跳过无意义的状态更新。
 */
export function capByRecency<T extends Timestamped>(
  cache: Record<string, T>,
  limit: number
): Record<string, T> {
  const keys = Object.keys(cache)
  if (keys.length <= limit) return cache

  const kept = keys
    .sort((a, b) => (cache[b]?.savedAt ?? 0) - (cache[a]?.savedAt ?? 0))
    .slice(0, limit)

  const next: Record<string, T> = {}
  for (const key of kept) next[key] = cache[key]
  return next
}
