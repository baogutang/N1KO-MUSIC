/**
 * Capacitor 原生通道（iOS / Android）：CapacitorHttp 绕开 WebView 的 CORS。
 * 入口强制白名单 + 私网拒绝（whitelist.ts），只请求经 rebuildAllowedUrl
 * 重建的地址，且一律不跟随 3xx（跟随交给 hostFetch 逐跳复检）。
 * 响应归一化与其它通道一致。
 */

import { CapacitorHttp } from '@capacitor/core'
import type { HostFetchResult, HostFetchRequest } from '../types'
import { isHostAllowed } from './whitelist'

export async function capacitorChannel(
  request: HostFetchRequest,
  allow: readonly string[],
  target: string,
  signal?: AbortSignal,
): Promise<HostFetchResult> {
  if (!isHostAllowed(request.url, allow)) {
    return { ok: false, error: { code: 'forbidden', message: `Host not in plugin allowlist: ${request.url}` } }
  }
  const requestPromise = CapacitorHttp.request({
    url: target,
    method: request.method as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'HEAD' | 'PATCH',
    headers: request.headers,
    data: request.body ?? undefined,
    responseType: request.responseType === 'arraybuffer' ? 'arraybuffer' : 'text',
    // 一律不跟随 3xx：跟随由 hostFetch 的 followRedirects 逐跳复检白名单后自己
    // 走（此前只有 redirect==='manual' 才关，等于白名单只在第一跳生效——白名单
    // 主机上的开放重定向能把请求带进内网）。QQ 登录读 Location 的链路照旧。
    disableRedirects: true,
    // 原生实现读不到 set-cookie 时拿不到就拿不到（协议约定给空），不在这层补
  })
  // CapacitorHttp 没有 signal：中止时不再等它的结果（原生请求仍会跑完，
  // 但宿主侧已经不认这个响应了）
  const res = signal
    ? await Promise.race([
        requestPromise,
        new Promise<never>((_, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason ?? new Error('Request aborted')), { once: true })
        }),
      ])
    : await requestPromise

  const headers = Object.fromEntries(
    Object.entries(res.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)])
  )
  if (request.responseType === 'arraybuffer') {
    const data: unknown = res.data
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data)
      : ArrayBuffer.isView(data) ? new Uint8Array((data as ArrayBufferView).buffer, (data as ArrayBufferView).byteOffset, (data as ArrayBufferView).byteLength)
      : null
    if (bytes) {
      // 二进制手动 base64
      let binary = ''
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      }
      return { ok: true, status: res.status, headers, body: btoa(binary), bodyEncoding: 'base64' }
    }
    return { ok: true, status: res.status, headers, body: String(res.data ?? ''), bodyEncoding: 'text' }
  }
  // CapacitorHttp 可能已把 JSON 解析成对象，统一回字符串让沙箱 shim 再解析
  const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? null)
  return { ok: true, status: res.status, headers, body, bodyEncoding: 'text' }
}
