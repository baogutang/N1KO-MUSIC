/**
 * 浏览器开发态通道：经 Vite 中间件 /__n1ko_proxy 转发（绕开本机开发的 CORS）。
 * 入口强制白名单 + 私网拒绝（whitelist.ts），且只把重建过的 target 交给中间件；
 * 中间件在服务端再校验一次白名单（vite.config.ts），两侧规则共用 whitelist.ts。
 * 请求参数走 POST body：转发目标不拼进 URL。
 */

import type { HostFetchResult, HostFetchRequest } from '../types'
import { isHostAllowed } from './whitelist'

const forbidden = (rawUrl: string): HostFetchResult => ({
  ok: false,
  error: { code: 'forbidden', message: `Host not in plugin allowlist: ${rawUrl}` },
})

export async function devProxyChannel(request: HostFetchRequest, allow: readonly string[], target: string): Promise<HostFetchResult> {
  if (!isHostAllowed(request.url, allow)) return forbidden(request.url)
  const res = await fetch('/__n1ko_proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: target,
      allow: allow.join(','),
      method: request.method,
      responseType: request.responseType,
      headers: request.headers ?? {},
      body: request.body ?? null,
      redirect: request.redirect ?? 'follow',
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return { ok: false, error: { code: 'network', message: `Dev proxy error ${res.status}: ${text.slice(0, 200)}` } }
  }
  const json = await res.json() as { status: number; headers: Record<string, string>; bodyBase64: string }
  if (request.responseType === 'arraybuffer') {
    return { ok: true, status: json.status, headers: json.headers, body: json.bodyBase64, bodyEncoding: 'base64' }
  }
  const text = new TextDecoder().decode(Uint8Array.from(atob(json.bodyBase64), c => c.charCodeAt(0)))
  return { ok: true, status: json.status, headers: json.headers, body: text, bodyEncoding: 'text' }
}
