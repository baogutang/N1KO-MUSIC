/**
 * Tauri 桌面通道：@tauri-apps/plugin-http 的 fetch（不受浏览器 CORS 约束，
 * scope 由 capabilities/default.json 放行 http/https）。
 * 入口强制白名单 + 私网拒绝（whitelist.ts），只请求经 rebuildAllowedUrl
 * 重建的地址；响应归一化复用 hostFetch 里的 normalizeFetchResponse。
 */

import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import type { HostFetchResult, HostFetchRequest } from '../types'
import { isHostAllowed } from './whitelist'

export async function tauriChannel(
  request: HostFetchRequest,
  allow: readonly string[],
  target: string,
  signal?: AbortSignal,
): Promise<Response> {
  if (!isHostAllowed(request.url, allow)) {
    throw new Error(`Host not in plugin allowlist: ${request.url}`)
  }
  return tauriFetch(target, {
    method: request.method,
    headers: request.headers,
    body: request.body !== undefined && request.method !== 'GET' && request.method !== 'HEAD'
      ? request.body
      : undefined,
    // 一律 manual：跟随 3xx 由 hostFetch 的 followRedirects 逐跳复检白名单后
    // 自己走。通道自己跟随等于只在第一跳校验白名单——开放重定向直通内网。
    // Rust 侧的 manual redirect 可读 Location（QQ 登录链路本来就要读它）。
    redirect: 'manual',
    ...(signal ? { signal } : {}),
  })
}
