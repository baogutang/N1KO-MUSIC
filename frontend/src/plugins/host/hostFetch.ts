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
 *
 * 重定向由本文件统一处理，四条通道一律「不跟随」发起（followRedirects）：
 * 通道自己跟随 3xx 等于把白名单校验丢在第一跳——白名单主机上的一个开放
 * 重定向（`https://good/redir?to=http://192.168.1.1/`）就能把请求带进内网。
 * 每一跳都重走 rebuildAllowedUrl，跨主机时剥掉 Cookie / Authorization。
 *
 * 响应统一为 { ok, status, headers, body, bodyEncoding }，二进制走 base64。
 */

import { isNativePlatform, isTauriShell } from '@/lib/platform'
import type { HostFetchResult, HostFetchRequest } from '../types'
import { isHostAllowed } from './whitelist'
import { capacitorChannel } from './capacitorChannel'
import { tauriChannel } from './tauriChannel'
import { devProxyChannel } from './devProxyChannel'

/** 最多跟随几跳（超过按网络错误处理，防重定向环） */
export const MAX_REDIRECT_HOPS = 5

/** 跨主机时必须剥掉的请求头（凭据不能跟着跳到别的域名去） */
const CREDENTIAL_HEADERS = ['cookie', 'authorization']

export interface HostFetchOptions {
  /** 插件 id：开发代理据此在服务端按 manifest 取白名单（不再信调用方给的名单） */
  pluginId?: string
  /** 宿主侧的超时 / dispose 中止信号（PluginHost 持有） */
  signal?: AbortSignal
}

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
async function browserChannel(request: HostFetchRequest, target: string, signal?: AbortSignal): Promise<HostFetchResult> {
  try {
    const res = await fetch(target, {
      method: request.method,
      headers: request.headers,
      body: request.body !== undefined && request.method !== 'GET' && request.method !== 'HEAD'
        ? request.body
        : undefined,
      // 一律不跟随：跟随由 followRedirects 逐跳复检白名单后自己走
      redirect: 'manual',
      ...(signal ? { signal } : {}),
    })
    if (res.type === 'opaqueredirect') {
      // 浏览器同源限制：跨源 manual redirect 读不到 Location，续不下去
      return networkError('跨源重定向需要 App / 桌面版通道（浏览器同源限制读不到 Location）')
    }
    return await normalizeFetchResponse(res, request.responseType)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return networkError(`浏览器直连失败（${message}）。流媒体音源需要 App 或桌面版。`)
  }
}

// ===================================================
// 重定向：逐跳复检白名单
// ===================================================

/** 3xx 且带 Location 时返回该 Location，否则 null */
function redirectLocation(result: HostFetchResult): string | null {
  if (!result.ok) return null
  if (result.status < 300 || result.status >= 400) return null
  const location = result.headers['location'] ?? result.headers['Location']
  return location ? location.trim() : null
}

/** Location 可能是相对路径，按当前 target 解析成绝对地址 */
function absoluteLocation(location: string, base: string): string | null {
  try {
    return new URL(location, base).toString()
  } catch {
    return null
  }
}

function sameHost(a: string, b: string): boolean {
  try {
    return new URL(a).host === new URL(b).host
  } catch {
    return false
  }
}

/** 跨主机跳转：Cookie / Authorization 一律不带过去 */
function stripCredentialHeaders(headers: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!headers) return headers
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (!CREDENTIAL_HEADERS.includes(key.toLowerCase())) out[key] = value
  }
  return out
}

/**
 * 跟随后的方法与 body（照 Fetch 规范，也就是各通道原本自动跟随时的行为）：
 * 303 一律转 GET；301/302 上的 POST 历来也转 GET；307/308 原样保持。
 * 转成 GET 时连 body 与描述 body 的头一起丢掉。
 */
function nextMethodAndBody(
  status: number,
  method: string,
  body: string | undefined,
  headers: Record<string, string> | undefined,
): { method: string; body: string | undefined; headers: Record<string, string> | undefined } {
  const upper = method.toUpperCase()
  const toGet = status === 303 || ((status === 301 || status === 302) && upper === 'POST')
  if (!toGet) return { method, body, headers }
  const nextHeaders = headers
    ? Object.fromEntries(
        Object.entries(headers).filter(([k]) => !['content-type', 'content-length'].includes(k.toLowerCase()))
      )
    : headers
  return { method: 'GET', body: undefined, headers: nextHeaders }
}

/**
 * 逐跳跟随重定向，每一跳都重走 rebuildAllowedUrl（白名单 + 私网拒绝）。
 * send 负责把一跳真正发出去（且**不得**自行跟随 3xx）。
 *
 * `request.redirect === 'manual'` 时不跟随，3xx 原样交回插件——QQ 登录要自己
 * 从 Location 里读 code（PROTOCOL §8.3 / DECISIONS 2026-09-03）。
 */
export async function followRedirects(
  request: HostFetchRequest,
  allow: readonly string[],
  send: (hopRequest: HostFetchRequest, target: string) => Promise<HostFetchResult>,
): Promise<HostFetchResult> {
  let target = rebuildAllowedUrl(request.url, allow)
  if (target === null) return forbidden(request.url)

  let method = request.method
  let headers = request.headers
  let body = request.body

  for (let hop = 0; ; hop++) {
    const hopRequest: HostFetchRequest = { ...request, url: target, method, headers, body }
    const result = await send(hopRequest, target)
    if (!result.ok) return result
    if (request.redirect === 'manual') return result

    const location = redirectLocation(result)
    if (!location) return result
    if (hop >= MAX_REDIRECT_HOPS) {
      return networkError(`重定向超过 ${MAX_REDIRECT_HOPS} 跳，已放弃：${target}`)
    }

    const absolute = absoluteLocation(location, target)
    // 每一跳都重判：白名单主机上的开放重定向不能成为进内网的跳板
    const next = absolute ? rebuildAllowedUrl(absolute, allow) : null
    if (!next) return forbidden(absolute ?? location)

    if (!sameHost(next, target)) headers = stripCredentialHeaders(headers)
    const rewritten = nextMethodAndBody(result.status, method, body, headers)
    method = rewritten.method
    body = rewritten.body
    headers = rewritten.headers
    target = next
  }
}

/**
 * 经宿主发出一次插件请求。allow 是该插件 manifest 的 hosts（必填）：
 * 白名单外或私网目标返回 forbidden，不会触达任何网络通道。
 * options.signal 由 PluginHost 传入（超时 / dispose 中止）。
 */
export async function hostFetch(
  request: HostFetchRequest,
  allow: readonly string[],
  options: HostFetchOptions = {},
): Promise<HostFetchResult> {
  const { signal } = options
  if (signal?.aborted) return networkError('Request aborted before dispatch')
  try {
    return await followRedirects(request, allow, async (hopRequest, target) => {
      if (signal?.aborted) return networkError('Request aborted')
      if (isNativePlatform) return await capacitorChannel(hopRequest, allow, target, signal)
      if (isTauriShell) {
        const res = await tauriChannel(hopRequest, allow, target, signal)
        return await normalizeFetchResponse(res, hopRequest.responseType)
      }
      if (import.meta.env.DEV) return await devProxyChannel(hopRequest, allow, target, options)
      return await browserChannel(hopRequest, target, signal)
    })
  } catch (err) {
    return networkError(err instanceof Error ? err.message : String(err))
  }
}
