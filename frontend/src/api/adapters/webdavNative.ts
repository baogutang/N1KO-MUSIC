/**
 * 安卓壳上的 WebDAV 通道（android/…/WebDavPlugin.java）。
 *
 * WebView 里的 fetch 会被 CORS 挡住，<audio> 和 <img> 也不能自己加 Authorization。
 * 列目录、读歌词和标签走这个插件；播歌走 configure 返回的 127.0.0.1 口子，
 * 原生在那里补上账号再把文件转回来。账号只活在原生内存里，每台 WebDAV 各一份。
 */

import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'

export const NATIVE_FLAC_PREFIX = 'webdav-native-flac:'

export function isNativeFlacUrl(url: string): boolean {
  return url.startsWith(NATIVE_FLAC_PREFIX)
}

export interface FlacEvent {
  generation?: number
  duration?: number
  position?: number
  buffered?: number
  code?: number
  message?: string
}

export interface WebDavNativePlugin {
  /** 记下这台 WebDAV 的账号。proxy 是播放口子的前缀，后面接 encodeURIComponent(文件地址) */
  configure(options: { baseUrl: string; username: string; password: string }): Promise<{ proxy: string }>
  propfind(options: { url: string; depth: number | 'infinity' }): Promise<{ status: number; body: string }>
  getText(options: { url: string }): Promise<{ status: number; body: string }>
  getRange(options: { url: string; length?: number }): Promise<{ status: number; body: string }>
  openFlac(options: { target: string; volume: number; rate: number }): Promise<{ generation: number }>
  resumeFlac(): Promise<void>
  pauseFlac(): Promise<void>
  seekFlac(options: { seconds: number }): Promise<void>
  volumeFlac(options: { volume: number }): Promise<void>
  rateFlac(options: { rate: number }): Promise<void>
  stopFlac(): Promise<void>
  addListener(
    eventName: 'flacReady' | 'flacTime' | 'flacEnded' | 'flacPaused' | 'flacError',
    listenerFunc: (event: FlacEvent) => void,
  ): Promise<PluginListenerHandle>
}

export const WebDavNative = registerPlugin<WebDavNativePlugin>('WebDav')

export function webDavNativeAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('WebDav')
}
