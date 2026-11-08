import { Capacitor, CapacitorHttp } from '@capacitor/core'

function headerValue(headers: Record<string, string> | undefined, name: string): string {
  if (!headers) return ''
  const found = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())
  return found ? String(found[1]) : ''
}

export interface ExternalText {
  ok: boolean
  status: number
  text: string
  contentType: string
}

/** 平板上的网页请求会被跨域拦住，歌词和封面改走系统网络。 */
export async function fetchExternalText(url: string, headers?: Record<string, string>): Promise<ExternalText> {
  if (Capacitor.isNativePlatform()) {
    const res = await CapacitorHttp.get({
      url,
      headers,
      responseType: 'text',
      connectTimeout: 12000,
      readTimeout: 20000,
    })
    const text = typeof res.data === 'string' ? res.data : ''
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      text,
      contentType: headerValue(res.headers, 'content-type'),
    }
  }
  const res = await fetch(url, { headers })
  return {
    ok: res.ok,
    status: res.status,
    text: await res.text(),
    contentType: res.headers.get('content-type') ?? '',
  }
}

/**
 * 封面接口经常 301 到图床，而且目标有时是 http。
 * 系统网络不会跟着跳到明文地址，于是封面被当成「没有」。
 * 这里自己跟过去，并把 http 换成 https（同一地址两边都能打开）。
 */
export function nextImageLocation(current: string, status: number, location: string): string | null {
  if (status < 300 || status >= 400 || !location) return null
  let next: URL
  try {
    next = new URL(location, current)
  } catch {
    return null
  }
  if (next.protocol === 'http:') next.protocol = 'https:'
  if (next.protocol !== 'https:') return null
  const resolved = next.toString()
  return resolved === current ? null : resolved
}

function imageMediaType(raw: string): string | null {
  const type = (raw || 'image/jpeg').split(';')[0].trim().toLowerCase()
  if (type === 'image/jpg') return 'image/jpeg'
  return type.startsWith('image/') ? type : null
}

/** 封面图。网页里交给浏览器加载；平板上取回后做成图片地址。 */
export async function fetchExternalImage(url: string, headers?: Record<string, string>): Promise<string | null> {
  if (!Capacitor.isNativePlatform()) {
    const res = await fetch(url, { headers })
    if (!res.ok) return null
    const blob = await res.blob()
    if (!blob.size || (blob.type && !blob.type.startsWith('image/'))) return null
    return URL.createObjectURL(blob)
  }
  let current = url
  for (let hop = 0; hop < 4; hop++) {
    const res = await CapacitorHttp.get({
      url: current,
      headers,
      responseType: 'blob',
      connectTimeout: 12000,
      readTimeout: 20000,
    })
    const next = nextImageLocation(current, res.status, headerValue(res.headers, 'location'))
    if (next) {
      current = next
      continue
    }
    if (res.status < 200 || res.status >= 300 || !res.data) return null
    const type = imageMediaType(headerValue(res.headers, 'content-type'))
    if (!type) return null
    return `data:${type};base64,${res.data}`
  }
  return null
}
