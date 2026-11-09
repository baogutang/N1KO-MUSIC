import { Capacitor, CapacitorHttp } from '@capacitor/core'

function headerValue(headers: Record<string, string> | undefined, name: string): string {
  if (!headers) return ''
  const found = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())
  return found ? String(found[1]) : ''
}

/**
 * 远程接口「没问到答案」的 HTTP 错误。
 *
 * 封面 / 歌词接口的结果会被 react-query 缓存（封面整个会话、歌词 30 分钟），
 * 所以「没有」和「没问到」必须分开：只有服务器明确答复（404、成功但内容为空）才返回 null / 空；
 * 限流、鉴权失败、服务端故障要抛这个错，让 query 进 error 态、之后还能再试。
 */
export class ExternalHttpError extends Error {
  readonly status: number
  constructor(status: number) {
    super(`HTTP ${status}`)
    this.name = 'ExternalHttpError'
    this.status = status
  }
}

/**
 * 这个非 2xx 状态是不是「没问到答案」（该抛错、不能缓存成「没有」）：
 * 429 限流、401/403 鉴权失败、408 超时、所有 5xx。
 * 其余 4xx（404、400…）是服务器对这个请求的确定答复：重问一遍结果一样，缓存成「没有」即可。
 */
export function isUnansweredStatus(status: number): boolean {
  return status >= 500 || status === 429 || status === 408 || status === 401 || status === 403
}

/**
 * 远程封面 / 歌词 query 的重试策略。
 * 只对「可能瞬时恢复」的失败（网络错误、5xx、408）重试一次；
 * 429 再发一次只会加重限流，401/403 重发也一样失败——这几类直接进 error 态，
 * 下次组件重新挂载时自然会再问，不在这里连环重发。
 */
export function shouldRetryExternal(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1) return false
  if (error instanceof ExternalHttpError) return error.status >= 500 || error.status === 408
  return true
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
    if (!res.ok) {
      if (isUnansweredStatus(res.status)) throw new ExternalHttpError(res.status)
      return null
    }
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
    if (isUnansweredStatus(res.status)) throw new ExternalHttpError(res.status)
    if (res.status < 200 || res.status >= 300 || !res.data) return null
    const type = imageMediaType(headerValue(res.headers, 'content-type'))
    if (!type) return null
    return `data:${type};base64,${res.data}`
  }
  return null
}
