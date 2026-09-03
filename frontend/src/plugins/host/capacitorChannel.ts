/**
 * Capacitor 原生通道（iOS / Android）：CapacitorHttp 绕开 WebView 的 CORS。
 * 入口强制白名单 + 私网拒绝（whitelist.ts），只请求经 rebuildAllowedUrl
 * 重建的地址。响应归一化与其它通道一致。
 */

import { CapacitorHttp } from '@capacitor/core'
import type { HostFetchResult, HostFetchRequest } from '../types'
import { isHostAllowed } from './whitelist'

export async function capacitorChannel(request: HostFetchRequest, allow: readonly string[], target: string): Promise<HostFetchResult> {
  if (!isHostAllowed(request.url, allow)) {
    return { ok: false, error: { code: 'forbidden', message: `Host not in plugin allowlist: ${request.url}` } }
  }
  const res = await CapacitorHttp.request({
    url: target,
    method: request.method as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'HEAD' | 'PATCH',
    headers: request.headers,
    data: request.body ?? undefined,
    responseType: request.responseType === 'arraybuffer' ? 'arraybuffer' : 'text',
    // manual redirect 的原生对应物是不跟随 302（QQ 登录要从 Location 读 code）；
    // 目标 URL 已在上方经 isHostAllowed 白名单 + 私网拒绝校验
    ...(request.redirect === 'manual' ? { disableRedirects: true } : {}),
    // 原生实现读不到 set-cookie 时拿不到就拿不到（协议约定给空），不在这层补
  })

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
