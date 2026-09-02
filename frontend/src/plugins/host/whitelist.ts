/**
 * manifest hosts 域名白名单匹配（PROTOCOL §2 / §8）。
 *
 * 纯函数、无 DOM / Node 依赖：宿主（hostFetch / PluginHost）与 Vite 开发代理
 * 中间件（vite.config.ts）共用同一份规则，不会出现两边判得不一致。
 *
 * 规则：
 * - 只匹配 hostname，端口不参与（manifest 列的是域名不是服务端口）；
 * - hostname 大小写不敏感（DNS 本身如此，URL 解析已归一化为小写，双保险）；
 * - `*.example.com` 通配**一级**子域：a.example.com 匹配，example.com 不匹配，
 *   a.b.example.com 不匹配；
 * - 非 http(s) 协议一律拒绝；
 * - 私网 / 回环 / 链路本地主机一律拒绝（SSRF 防线：即使 manifest 写了
 *   localhost 也不放行——插件音源全部是公网 API，本地测试走 Mock 插件的数据 URL）。
 */

/** 私网与本地主机段（按 hostname 字面判定，不解析 DNS） */
const PRIVATE_HOST_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^0\./,
  /^\[?::1\]?$/,
  /^\[?fe80:/i,
  /^\[?fc[0-9a-f]{2}:/i,
  /\.local$/i,
  /\.internal$/i,
]

export function isPrivateHost(hostname: string): boolean {
  return PRIVATE_HOST_PATTERNS.some(re => re.test(hostname))
}

export function isHostAllowed(rawUrl: string, hosts: readonly string[]): boolean {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '')
  if (isPrivateHost(hostname)) return false

  return hosts.some(pattern => {
    const p = pattern.trim().toLowerCase().replace(/\.$/, '')
    if (!p) return false
    if (p.startsWith('*.')) {
      const base = p.slice(2)
      // 一级子域：hostname 去掉最后一段 base 后必须恰好剩一段
      if (hostname.endsWith('.' + base)) {
        const head = hostname.slice(0, -(base.length + 1))
        return head.length > 0 && !head.includes('.')
      }
      return false
    }
    return hostname === p
  })
}
