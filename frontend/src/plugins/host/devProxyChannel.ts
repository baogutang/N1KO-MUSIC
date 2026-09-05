/**
 * 浏览器开发态通道：经 Vite 中间件 /__n1ko_proxy 转发（绕开本机开发的 CORS）。
 * 入口强制白名单 + 私网拒绝（whitelist.ts），且只把重建过的 target 交给中间件。
 *
 * 服务端不再信任请求体里的白名单——只收 pluginId，自己按 plugins/<id>/manifest.json
 * 读 hosts（vite.config.ts）。「拿调用方给的名单校验调用方给的地址」等于没校验。
 * `X-N1KO-Proxy: 1` 是故意加的自定义头：跨源请求带它必须先过预检，浏览器里
 * 别的页面因此发不出这个请求（服务端还会另外查 Origin）。
 *
 * 一律以 redirect:'manual' 发起：跟随 3xx 由 hostFetch 的 followRedirects
 * 逐跳复检白名单后自己走。请求参数走 POST body：转发目标不拼进 URL。
 */

import type { HostFetchResult, HostFetchRequest } from '../types'
import { isHostAllowed } from './whitelist'

const forbidden = (rawUrl: string): HostFetchResult => ({
  ok: false,
  error: { code: 'forbidden', message: `Host not in plugin allowlist: ${rawUrl}` },
})

export async function devProxyChannel(
  request: HostFetchRequest,
  allow: readonly string[],
  target: string,
  options: { pluginId?: string; signal?: AbortSignal } = {},
): Promise<HostFetchResult> {
  if (!isHostAllowed(request.url, allow)) return forbidden(request.url)
  const res = await fetch('/__n1ko_proxy', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // 自定义头 → 跨源必须预检；中间件把没有它的请求直接 403
      'X-N1KO-Proxy': '1',
    },
    body: JSON.stringify({
      url: target,
      pluginId: options.pluginId ?? '',
      method: request.method,
      responseType: request.responseType,
      headers: request.headers ?? {},
      body: request.body ?? null,
      // 服务端也不跟随；跟随由宿主侧逐跳复检后自己走
      redirect: 'manual',
    }),
    ...(options.signal ? { signal: options.signal } : {}),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    // 403 是中间件的白名单 / 来源校验拒绝，按 forbidden 回给插件（不是网络故障）
    if (res.status === 403) {
      return { ok: false, error: { code: 'forbidden', message: `Dev proxy refused: ${text.slice(0, 200)}` } }
    }
    return { ok: false, error: { code: 'network', message: `Dev proxy error ${res.status}: ${text.slice(0, 200)}` } }
  }
  const json = await res.json() as { status: number; headers: Record<string, string>; bodyBase64: string }
  if (request.responseType === 'arraybuffer') {
    return { ok: true, status: json.status, headers: json.headers, body: json.bodyBase64, bodyEncoding: 'base64' }
  }
  const text = new TextDecoder().decode(Uint8Array.from(atob(json.bodyBase64), c => c.charCodeAt(0)))
  return { ok: true, status: json.status, headers: json.headers, body: text, bodyEncoding: 'text' }
}
