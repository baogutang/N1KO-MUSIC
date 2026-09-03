/**
 * PluginHost：一个插件实例一个沙箱（PLAN 1.2 / PROTOCOL §8）。
 *
 * 职责：加载 blob: 文档的 sandbox iframe、init → ready、RPC 调用（30 秒超时）、
 * 转发网络请求（hostFetch + 白名单 + 请求日志）、托管私有存储与凭据回写、
 * 转发 console（按插件 id 打前缀，环形保留最近 200 条）。
 *
 * 请求日志只记时间、方法、URL、状态与耗时——不存 body 与 Cookie（红线）。
 */

import type {
  HostFetchRequest,
  HostToSandboxMessage,
  PluginEnvData,
  PluginErrorCode,
  PluginManifest,
  SandboxToHostMessage,
} from '../types'
import { createSandboxDocumentUrl } from './sandboxDocument'
import { hostFetch } from './hostFetch'

const READY_TIMEOUT_MS = 10_000
const CALL_TIMEOUT_MS = 30_000
/** 每插件保留多少条请求 / console 日志（环形） */
const LOG_RING_SIZE = 200

/** 宿主侧抛出的插件调用错误：code 可直接映射协议错误码 */
export class PluginCallError extends Error {
  readonly code: PluginErrorCode
  readonly detail?: unknown
  constructor(code: PluginErrorCode, message: string, detail?: unknown) {
    super(message)
    this.name = 'PluginCallError'
    this.code = code
    this.detail = detail
  }
}

export interface PluginRequestLogEntry {
  time: number
  method: string
  url: string
  status: number
  durationMs: number
}

export interface PluginConsoleLogEntry {
  time: number
  level: string
  args: string[]
}

/** 插件私有存储后端（pluginStore 用 IndexedDB 落地） */
export interface PluginHostStorage {
  get(pluginId: string, key: string): Promise<string | null>
  set(pluginId: string, key: string, value: string): Promise<void>
}

export interface PluginHostOptions {
  env: Omit<PluginEnvData, 'credentials'>
  credentials: string | null
  storage: PluginHostStorage
  /** 插件回写凭据（env.setCredentials / 登录流程产生新串）时通知宿主落盘 */
  onCredentialsChange?: (next: string | null) => void
  /** console 转发；缺省打到主控制台并进环形缓冲 */
  onConsoleLog?: (entry: PluginConsoleLogEntry) => void
}

export class PluginHost {
  readonly manifest: PluginManifest
  /** ready 后回填：插件实际导出的方法路径 */
  methods: string[] = []
  readonly requestLogs: PluginRequestLogEntry[] = []
  readonly consoleLogs: PluginConsoleLogEntry[] = []

  private iframe: HTMLIFrameElement | null = null
  private blobUrl: string | null = null
  private rpcSeq = 0
  private disposed = false
  private readonly options: PluginHostOptions
  private readonly pendingCalls = new Map<number, {
    resolve: (value: unknown) => void
    reject: (err: PluginCallError) => void
    timer: ReturnType<typeof setTimeout>
  }>()
  private readonly pendingFetches = new Map<number, {
    resolve: (result: ReturnType<typeof hostFetch> extends Promise<infer R> ? R : never) => void
  }>()
  private messageListener: ((event: MessageEvent) => void) | null = null

  constructor(manifest: PluginManifest, options: PluginHostOptions) {
    this.manifest = manifest
    this.options = options
  }

  /** 当前凭据（凭据诊断用它区分「匿名浏览」与「登录态过期」） */
  get credentials(): string | null {
    return this.options.credentials
  }

  /** 装载沙箱并等待 ready；返回插件导出的方法路径 */
  async init(code: string): Promise<string[]> {
    if (typeof document === 'undefined') {
      throw new PluginCallError('unsupported', 'PluginHost requires a DOM (sandbox iframe)')
    }
    this.blobUrl = createSandboxDocumentUrl(window.location.origin)

    const iframe = document.createElement('iframe')
    iframe.setAttribute('sandbox', 'allow-scripts')
    iframe.setAttribute('aria-hidden', 'true')
    iframe.style.display = 'none'
    iframe.src = this.blobUrl
    this.iframe = iframe

    const readyPromise = new Promise<string[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new PluginCallError('network', `Plugin sandbox not ready in ${READY_TIMEOUT_MS}ms: ${this.manifest.id}`))
      }, READY_TIMEOUT_MS)
      this.readyResolve = methods => {
        clearTimeout(timer)
        resolve(methods)
      }
    })

    this.messageListener = event => {
      if (this.disposed) return
      // opaque origin 的 event.origin 是 'null'，身份只认 event.source
      if (this.iframe && event.source === this.iframe.contentWindow) {
        this.handleSandboxMessage(event.data as SandboxToHostMessage)
      }
    }
    window.addEventListener('message', this.messageListener)
    document.body.appendChild(iframe)

    // blob 文档里的脚本何时就绪无从得知：周期性重发 init 直到 ready（沙箱对
    // 重复 init 幂等），或超时放弃。200ms 一发，冷启动下首轮通常就命中。
    const initMessage: HostToSandboxMessage = {
      type: 'init',
      pluginId: this.manifest.id,
      code,
      env: { ...this.options.env, credentials: this.options.credentials },
    }
    const retryTimer = setInterval(() => {
      if (this.disposed) return
      this.postToSandbox(initMessage)
    }, 200)
    try {
      const methods = await readyPromise
      this.methods = methods
      return methods
    } finally {
      clearInterval(retryTimer)
    }
  }

  private readyResolve: ((methods: string[]) => void) | null = null

  /** 调插件方法；30 秒超时，插件错误码原样抛出 */
  async call<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
    if (this.disposed) throw new PluginCallError('unsupported', 'Plugin host disposed')
    if (!this.iframe?.contentWindow) throw new PluginCallError('unsupported', 'Sandbox not initialized')
    const id = ++this.rpcSeq
    const promise = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCalls.delete(id)
        reject(new PluginCallError('network', `Plugin call timeout (${CALL_TIMEOUT_MS}ms): ${method}`))
      }, CALL_TIMEOUT_MS)
      this.pendingCalls.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      })
    })
    this.postToSandbox({ type: 'call', id, method, args })
    return promise
  }

  /** 该方法是否已导出（能力探测） */
  hasMethod(method: string): boolean {
    return this.methods.includes(method)
  }

  dispose(): void {
    this.disposed = true
    for (const { timer, reject } of this.pendingCalls.values()) {
      clearTimeout(timer)
      reject(new PluginCallError('unsupported', 'Plugin host disposed'))
    }
    this.pendingCalls.clear()
    this.pendingFetches.clear()
    if (this.messageListener) {
      window.removeEventListener('message', this.messageListener)
      this.messageListener = null
    }
    this.iframe?.remove()
    this.iframe = null
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl)
      this.blobUrl = null
    }
  }

  private postToSandbox(msg: HostToSandboxMessage): void {
    // opaque origin 只能用 '*'，沙箱侧校验 event.source
    this.iframe?.contentWindow?.postMessage(msg, '*')
  }

  private handleSandboxMessage(msg: SandboxToHostMessage): void {
    switch (msg.type) {
      case 'ready':
        this.readyResolve?.(msg.methods)
        this.readyResolve = null
        break
      case 'result': {
        const pending = this.pendingCalls.get(msg.id)
        if (!pending) return
        clearTimeout(pending.timer)
        this.pendingCalls.delete(msg.id)
        if (msg.ok) pending.resolve(msg.value)
        else pending.reject(new PluginCallError(msg.error.code, msg.error.message, msg.error.detail))
        break
      }
      case 'fetch':
        void this.handleSandboxFetch(msg.id, msg.request)
        break
      case 'storage:get':
        // .catch 必须有：宿主 storage 抛错时若不回包，沙箱侧只能等超时
        void this.options.storage.get(this.manifest.id, msg.key).then(value => {
          this.postToSandbox({ type: 'storage:result', id: msg.id, value })
        }).catch(() => {
          this.postToSandbox({ type: 'storage:result', id: msg.id, value: null })
        })
        break
      case 'storage:set':
        void this.options.storage.set(this.manifest.id, msg.key, msg.value).then(() => {
          this.postToSandbox({ type: 'storage:result', id: msg.id, value: null })
        }).catch(() => {
          this.postToSandbox({ type: 'storage:result', id: msg.id, value: null })
        })
        break
      case 'credentials':
        this.options.onCredentialsChange?.(msg.value)
        break
      case 'log': {
        const entry = { time: Date.now(), level: msg.level, args: msg.args }
        this.consoleLogs.push(entry)
        if (this.consoleLogs.length > LOG_RING_SIZE) this.consoleLogs.shift()
        if (this.options.onConsoleLog) {
          this.options.onConsoleLog(entry)
        } else {
          const line = `[plugin:${this.manifest.id}] ${msg.args.join(' ')}`
          if (msg.level === 'error') console.error(line)
          else if (msg.level === 'warn') console.warn(line)
          else console.info(line)
        }
        break
      }
    }
  }

  private async handleSandboxFetch(id: number, request: HostFetchRequest): Promise<void> {
    const startedAt = Date.now()
    let result: Awaited<ReturnType<typeof hostFetch>>
    try {
      result = await hostFetch(request, this.manifest.hosts)
    } catch (err) {
      result = {
        ok: false,
        error: { code: 'network', message: err instanceof Error ? err.message : String(err) },
      }
    }
    // 请求日志：只记元数据，不存 body 与 Cookie
    this.requestLogs.push({
      time: startedAt,
      method: request.method,
      url: request.url,
      status: result.ok ? result.status : 0,
      durationMs: Date.now() - startedAt,
    })
    if (this.requestLogs.length > LOG_RING_SIZE) this.requestLogs.shift()

    if (result.ok) {
      this.postToSandbox({
        type: 'fetch:result', id, ok: true,
        status: result.status, headers: result.headers,
        body: result.body, bodyEncoding: result.bodyEncoding,
      })
    } else {
      this.postToSandbox({
        type: 'fetch:result', id, ok: false,
        error: { code: result.error.code, message: result.error.message },
      })
    }
  }
}
