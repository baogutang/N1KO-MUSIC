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
  /*
   * `Origin`：插件没写就送一个空串。
   *
   * tauri-plugin-http 会给每个请求补 `Origin: tauri://localhost`（见 crate 的
   * commands.rs），而开发态走 Node 代理时根本没有这个头——两条通道对同一个
   * 插件发出的请求并不一样，而「能用」只在开发态被验证过。空串是这个 crate
   * 留的显式出口：开了 unsafe-headers 时它见到空 Origin 会整个删掉，于是桌面版
   * 发出的头与开发态一致（原生客户端本来也不带 Origin）。
   */
  const headers = { ...(request.headers ?? {}) }
  const hasOrigin = Object.keys(headers).some(k => k.toLowerCase() === 'origin')
  if (!hasOrigin) headers.Origin = ''

  return tauriFetch(target, {
    method: request.method,
    headers,
    body: request.body !== undefined && request.method !== 'GET' && request.method !== 'HEAD'
      ? request.body
      : undefined,
    /*
     * 不跟随重定向：跟随由 hostFetch 的 followRedirects 逐跳复检白名单后自己走。
     *
     * 注意**不能**只写 fetch 的 `redirect: 'manual'`——这个 crate 压根不认它
     * （它只读自己的 `maxRedirections`，见 commands.rs 里对 Policy 的处理），
     * 写了等于没写，reqwest 默认会跟随最多 10 跳。后果不只是白名单只在第一跳
     * 生效：QQ 扫码要读 check_sig 那一跳 302 的 set-cookie 才能拿到 p_skey，
     * 被跟掉之后就永远是「QQ 授权失败（没有 p_skey）」。
     */
    maxRedirections: 0,
    redirect: 'manual',
    ...(signal ? { signal } : {}),
  })
}
