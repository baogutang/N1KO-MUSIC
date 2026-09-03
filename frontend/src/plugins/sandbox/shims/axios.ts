/**
 * `require('axios')` 拿到的客户端（PROTOCOL §4.1）。
 *
 * 与 axios 同形：get / post / request，支持 params、headers、data、
 * responseType ('json' | 'text' | 'arraybuffer')，返回 { status, headers, data }。
 * 底层不发网络（沙箱 CSP 拦掉了），全部经宿主 RPC 转发。
 *
 * 语义对齐 axios 的关键两处（移植 api-enhanced 的代码依赖它们）：
 * 1. 非 2xx 默认 reject，错误对象带 .response.{status, headers, data}；
 * 2. data 为普通对象且未显式设 Content-Type 时自动 JSON 序列化。
 */

import type { HostFetchRequest, HostFetchResult } from '../../types'

export interface AxiosLikeConfig {
  url?: string
  method?: string
  params?: Record<string, unknown>
  headers?: Record<string, string>
  data?: unknown
  responseType?: 'json' | 'text' | 'arraybuffer'
  timeout?: number
  validateStatus?: ((status: number) => boolean) | null
  /** 透传宿主取流的重定向策略（'manual' 不跟随 3xx，Location 可读） */
  redirect?: 'follow' | 'manual'
}

export interface AxiosLikeResponse<T = unknown> {
  status: number
  headers: Record<string, string>
  data: T
  config: AxiosLikeConfig
}

export class AxiosLikeError extends Error {
  isAxiosError = true
  response?: AxiosLikeResponse
  code?: string
  constructor(message: string, response?: AxiosLikeResponse, code?: string) {
    super(message)
    this.name = 'AxiosError'
    this.response = response
    this.code = code
  }
}

/** 二进制 body 转 ArrayBuffer（responseType: 'arraybuffer' 用） */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

function appendParams(url: string, params: Record<string, unknown>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      // axios 的默认序列化：同名重复 a=1&a=2（Subsonic 系接口就吃这一套）
      for (const v of value) search.append(key, String(v))
    } else {
      search.append(key, String(value))
    }
  }
  const qs = search.toString()
  if (!qs) return url
  return url.includes('?') ? `${url}&${qs}` : `${url}?${qs}`
}

export type FetchViaHost = (request: HostFetchRequest) => Promise<HostFetchResult>

export function createAxiosShim(fetchViaHost: FetchViaHost) {
  async function request(config: AxiosLikeConfig): Promise<AxiosLikeResponse> {
    if (!config.url) throw new AxiosLikeError('url is required', undefined, 'ERR_INVALID_URL')
    let url = config.url
    if (config.params) url = appendParams(url, config.params)

    let body: string | undefined
    let bodyEncoding: 'text' | 'base64' | undefined
    const headers: Record<string, string> = { ...config.headers }
    if (config.data !== undefined && config.data !== null) {
      if (typeof config.data === 'string') {
        body = config.data
      } else {
        body = JSON.stringify(config.data)
        const hasCT = Object.keys(headers).some(k => k.toLowerCase() === 'content-type')
        if (!hasCT) headers['Content-Type'] = 'application/json'
      }
      bodyEncoding = 'text'
    }

    const responseType = config.responseType ?? 'json'
    const result = await fetchViaHost({
      url,
      method: (config.method ?? 'get').toUpperCase(),
      headers: Object.keys(headers).length ? headers : undefined,
      body,
      bodyEncoding,
      responseType,
      timeoutMs: config.timeout,
      redirect: config.redirect,
    })

    if (!result.ok) {
      // 宿主拒绝（白名单外 / 通道失败）：没有 HTTP 状态可言
      throw new AxiosLikeError(result.error.message, undefined, result.error.code)
    }

    let data: unknown
    if (result.bodyEncoding === 'base64') {
      data = responseType === 'arraybuffer' ? base64ToArrayBuffer(result.body) : result.body
    } else if (responseType === 'json') {
      try {
        data = result.body ? JSON.parse(result.body) : null
      } catch {
        data = result.body
      }
    } else {
      data = result.body
    }

    const response: AxiosLikeResponse = {
      status: result.status,
      headers: result.headers,
      data,
      config,
    }

    // validateStatus: null 表示永不 reject（axios 语义）
    const validate = config.validateStatus === undefined
      ? (s: number) => s >= 200 && s < 300
      : config.validateStatus
    if (validate && !validate(result.status)) {
      throw new AxiosLikeError(`Request failed with status code ${result.status}`, response)
    }
    return response
  }

  return {
    request,
    get: (url: string, config: AxiosLikeConfig = {}) => request({ ...config, url, method: 'get' }),
    post: (url: string, data?: unknown, config: AxiosLikeConfig = {}) =>
      request({ ...config, url, data, method: 'post' }),
    put: (url: string, data?: unknown, config: AxiosLikeConfig = {}) =>
      request({ ...config, url, data, method: 'put' }),
    delete: (url: string, config: AxiosLikeConfig = {}) => request({ ...config, url, method: 'delete' }),
    isAxiosError: (e: unknown): e is AxiosLikeError => e instanceof AxiosLikeError,
  }
}

export type AxiosShim = ReturnType<typeof createAxiosShim>
