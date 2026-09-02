/**
 * 宿主网络通道（PLAN §4.3）：沙箱插件的所有请求经这里出网。
 *
 * 四条通道，按运行环境选一条：
 *  - iOS / Android：CapacitorHttp（capacitorChannel.ts，绕开 WebView CORS）
 *  - Tauri 桌面：@tauri-apps/plugin-http（tauriChannel.ts，不受浏览器 CORS 约束）
 *  - 浏览器开发态：Vite 中间件 /__n1ko_proxy（devProxyChannel.ts，服务端再校验白名单）
 *  - 浏览器正式版：原生 fetch；CORS 失败翻译成可读提示（流媒体音源需要 App 或桌面版）
 *
 * 安全边界（SSRF 防线）：manifest hosts 白名单 + 私网/回环地址拒绝（whitelist.ts）。
 * 入口先判白名单，再由 rebuildAllowedUrl 用校验过的部分（协议字面量 + 白名单命中
 * 的 hostname）重建目标地址——原始串里的 userinfo 被丢弃，也不给「校验用一个
 * 解析器、请求用另一个」的差分绕过留口子。通道只请求重建后的 target。
 * 响应统一为 { ok, status, headers, body, bodyEncoding }，二进制走 base64。
 */

import { isNativePlatform, isTauriShell } from '@/lib/platform'
import type { HostFetchResult, HostFetchRequest } from '../types'
import { isHostAllowed } from './whitelist'
import { capacitorChannel } from './capacitorChannel'
import { tauriChannel } from './tauriChannel'
import { devProxyChannel } from './devProxyChannel'

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

const networkError = (message: string): HostFetchResult => ({
  ok: false,
  error: { code: 'network', message },
})

/** 白名单外 / 私网目标的统一拒绝 */
const forbidden = (rawUrl: string): HostFetchResult => {
  let host = rawUrl
  try { host = new URL(rawUrl).hostname } catch { /* 保留原串 */ }
  return { ok: false, error: { code: 'forbidden', message: `Host not in plugin allowlist: ${host}` } }
}

/**
 * 校验并重建目标 URL：协议只认 https/http，hostname 必须命中 manifest
 * allowlist（精确或一级子域通配）且不是私网/回环段。返回重建串（丢 userinfo，
 * 保留 port/path/search）；不通过返回 null。规则与 isHostAllowed 一致
 * （whitelist.test.ts 钉住）。
 */
export function rebuildAllowedUrl(rawUrl: string, allow: readonly string[]): string | null {
  if (!isHostAllowed(rawUrl, allow)) return null
  let u: URL
  try {
    u = new URL(rawUrl)
  } catch {
    return null
  }
  const scheme = u.protocol === 'https:' ? 'https' : u.protocol === 'http:' ? 'http' : null
  if (!scheme) return null
  const host = u.hostname.toLowerCase()
  const port = u.port ? `:${u.port}` : ''
  return `${scheme}://${host}${port}${u.pathname}${u.search}`
}

/** fetch 系响应（Tauri / 浏览器）的公共归一化 */
async function normalizeFetchResponse(res: Response, responseType: HostFetchRequest['responseType']): Promise<HostFetchResult> {
  const headers: Record<string, string> = {}
  res.headers.forEach((value, key) => {
    // 多值头（set-cookie 在 fetch 里是逗号拼接的）保留拼接形态
    headers[key.toLowerCase()] = value
  })
  const buffer = new Uint8Array(await res.arrayBuffer())
  if (responseType === 'arraybuffer') {
    return { ok: true, status: res.status, headers, body: bytesToBase64(buffer), bodyEncoding: 'base64' }
  }
  return { ok: true, status: res.status, headers, body: new TextDecoder().decode(buffer), bodyEncoding: 'text' }
}

/** 浏览器正式版：原生 fetch，CORS 失败给可读提示 */
async function browserChannel(request: HostFetchRequest, target: string): Promise<HostFetchResult> {
  try {
    const res = await fetch(target, {
      method: request.method,
      headers: request.headers,
      body: request.body !== undefined && request.method !== 'GET' && request.method !== 'HEAD'
        ? request.body
        : undefined,
    })
    return await normalizeFetchResponse(res, request.responseType)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return networkError(`浏览器直连失败（${message}）。流媒体音源需要 App 或桌面版。`)
  }
}

/**
 * 经宿主发出一次插件请求。allow 是该插件 manifest 的 hosts（必填）：
 * 白名单外或私网目标返回 forbidden，不会触达任何网络通道。
 */
export async function hostFetch(request: HostFetchRequest, allow: readonly string[]): Promise<HostFetchResult> {
  const target = rebuildAllowedUrl(request.url, allow)
  if (target === null) return forbidden(request.url)
  try {
    if (isNativePlatform) return await capacitorChannel(request, allow, target)
    if (isTauriShell) {
      const res = await tauriChannel(request, allow, target)
      return await normalizeFetchResponse(res, request.responseType)
    }
    if (import.meta.env.DEV) return await devProxyChannel(request, allow, target)
    return await browserChannel(request, target)
  } catch (err) {
    return networkError(err instanceof Error ? err.message : String(err))
  }
}
