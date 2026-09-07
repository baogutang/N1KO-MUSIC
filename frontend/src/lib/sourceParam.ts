/**
 * 读地址栏里的 `?src=<serverId>`（来源限定）。
 *
 * 为什么不直接 `searchParams.get('src')`：链接是由数据里的 `serverId` 拼出来的，
 * 而 `encodeURIComponent(undefined)` 会老老实实产出字符串 `"undefined"`。
 * v1.10.0 的 Album / Artist / Playlist / Song 都还没有 serverId（那时它是可选的、
 * 也没人写），升级上来的离线缓存里那批对象因此会拼出 `?src=undefined`，
 * 点进去就是一句「No adapter registered for server: undefined」。
 *
 * 这里把「看起来像来源、其实是空值」的几种写法一律当成没给：调用方回落主库，
 * 与不带这个参数时的行为一致。缓存被下一次成功请求刷掉之后自然就没有这种链接了。
 */
const BLANK_SOURCE = new Set(['', 'undefined', 'null'])

export function sourceParam(params: URLSearchParams): string | undefined {
  const raw = params.get('src')?.trim()
  if (!raw || BLANK_SOURCE.has(raw)) return undefined
  return raw
}
