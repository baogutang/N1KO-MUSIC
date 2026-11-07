/**
 * 安卓壳上的 WebDAV 通道。
 *
 * WebView 里的 fetch 会被 CORS 挡住，<audio> 也不能自己加 Authorization。
 * 目录列举走原生插件；真正播歌时由 WebViewClient 按已配置的账号补上认证头。
 */

import { Capacitor, registerPlugin } from '@capacitor/core'

export interface WebDavNativePlugin {
  configure(options: { baseUrl: string; username: string; password: string }): Promise<void>
  propfind(options: { url: string; depth: number | 'infinity' }): Promise<{ status: number; body: string }>
  getText(options: { url: string }): Promise<{ status: number; body: string }>
  streamUrl(options: { target: string }): Promise<{ url: string }>
}

export const WebDavNative = registerPlugin<WebDavNativePlugin>('WebDav')

export function webDavNativeAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('WebDav')
}
