/**
 * 详情页地址的唯一拼法（阶段 1.3）：
 * `?src=` 是详情页解析「这条数据属于哪个源」的唯一线索——漏了它，
 * 插件源的 id 会被拿去问主库，一律「找不到」。此前 8 处 navigate 各拼各的，
 * 其中 6 处漏 src。全仓跳详情统一走这里。
 */
export function detailPath(kind: 'albums' | 'artists' | 'songs', id: string | undefined, serverId?: string | null): string {
  if (!id) return ''
  const base = `/${kind}/${encodeURIComponent(id)}`
  return serverId ? `${base}?src=${encodeURIComponent(serverId)}` : base
}
