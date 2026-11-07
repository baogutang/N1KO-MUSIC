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

/** 封面图。网页里交给浏览器加载；平板上取回后做成图片地址。 */
export async function fetchExternalImage(url: string, headers?: Record<string, string>): Promise<string | null> {
  if (!Capacitor.isNativePlatform()) {
    const res = await fetch(url, { headers })
    if (!res.ok) return null
    const blob = await res.blob()
    if (!blob.size || (blob.type && !blob.type.startsWith('image/'))) return null
    return URL.createObjectURL(blob)
  }
  const res = await CapacitorHttp.get({
    url,
    headers,
    responseType: 'blob',
    connectTimeout: 12000,
    readTimeout: 20000,
  })
  if (res.status < 200 || res.status >= 300 || !res.data) return null
  const type = (headerValue(res.headers, 'content-type') || 'image/jpeg').split(';')[0]
  if (!type.startsWith('image/')) return null
  return `data:${type};base64,${res.data}`
}
