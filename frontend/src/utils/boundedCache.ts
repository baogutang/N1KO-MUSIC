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

/**
 * 把缓存裁剪到字节预算之内，保留 savedAt 最新的条目。
 *
 * 只按条数封顶是不够的：一份双语 LRC 常有 4–8KB，300 条就能到 2.4MB 上下，
 * 单个键即可逼近 localStorage 的整体配额，进而让别的写入连锁失败。
 * 估算按 UTF-16 计（JS 字符串每字符 2 字节），偏保守但足够稳。
 */
export function capByBytes<T extends Timestamped>(
  cache: Record<string, T>,
  byteBudget: number
): Record<string, T> {
  const keys = Object.keys(cache)
  if (!keys.length) return cache

  const estimate = JSON.stringify(cache).length * 2
  if (estimate <= byteBudget) return cache

  const ordered = keys.sort((a, b) => (cache[b]?.savedAt ?? 0) - (cache[a]?.savedAt ?? 0))
  const next: Record<string, T> = {}
  let used = 0
  for (const key of ordered) {
    // 键名 + 值 + JSON 结构开销，粗算一遍即可
    const size = (JSON.stringify(cache[key]).length + key.length + 4) * 2
    if (used + size > byteBudget) break
    next[key] = cache[key]
    used += size
  }
  // 预算极小时至少保住最近一条，否则刚存就被清掉
  if (!Object.keys(next).length && ordered.length) {
    next[ordered[0]] = cache[ordered[0]]
  }
  return next
}
