/**
 * 安卓原生壳里，http://IP 上的封面和音频改走原生代取（android/…/LanMediaProxy.java）。
 *
 * 页面是 https://localhost，Chromium 对 https 页面引用 http://IP 地址的图片、音频、视频一律拦下，
 * WebView 的「允许混合内容」也管不了（IP 地址没法自动升级 https）。接口请求不受影响，
 * 于是局域网 NAS 用 http://192.168.x.x 登录时：能列出歌，没有封面，也放不出声。
 * 用主机名（http://nas.local）不受影响，只改写 IP 地址。
 *
 * 改写成同源的 https://localhost/_n1ko_lan/{主机:端口}/{路径}?{参数}。主机端口放在路径里：
 * HLS 播放列表里的相对地址解析出来仍落在这个前缀下。
 */

import { nativeOS } from '@/lib/platform'

const PREFIX = '/_n1ko_lan/'

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/

function isIpHost(hostname: string): boolean {
  return IPV4.test(hostname) || hostname.startsWith('[')
}

/** 纯函数版：origin 是页面的源（https://localhost），测试直接调它 */
export function toLanProxyUrl(url: string, origin: string): string {
  if (!url.startsWith('http://')) return url
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return url
  }
  if (!isIpHost(parsed.hostname)) return url
  return `${origin}${PREFIX}${parsed.host}${parsed.pathname}${parsed.search}`
}

/** 代取地址还原成服务器上的原地址（给原生那一侧用：锁屏 / 通知栏的封面由原生去取，不经过 WebView） */
export function fromLanProxyUrl(url: string, origin: string): string {
  const head = `${origin}${PREFIX}`
  return url.startsWith(head) ? `http://${url.slice(head.length)}` : url
}

const proxyOrigin =
  nativeOS === 'android' && typeof location !== 'undefined' && location.protocol === 'https:'
    ? location.origin
    : null

/** 封面、音频地址过一道：只在安卓原生壳里、只对 http://IP 生效，其余原样返回 */
export function lanMediaUrl(url: string): string {
  return proxyOrigin ? toLanProxyUrl(url, proxyOrigin) : url
}

export function originalMediaUrl(url: string): string {
  return proxyOrigin ? fromLanProxyUrl(url, proxyOrigin) : url
}
