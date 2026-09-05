/**
 * PluginHost：一个插件实例一个沙箱（PLAN 1.2 / PROTOCOL §8）。
 *
 * 职责：加载 blob: 文档的 sandbox iframe、init → ready、RPC 调用（30 秒超时）、
 * 转发网络请求（hostFetch + 白名单 + 超时 + 请求日志）、托管私有存储与凭据回写、
 * 转发 console（按插件 id 打前缀，环形保留最近 200 条）。
 *
 * 请求日志只记时间、方法、origin+pathname、状态与耗时——不存 query、body 与
 * Cookie（红线）：query 里就是凭据本身（QQ 登录 CGI 的 ptqrtoken、流地址的 vkey）。
 *
 * 沙箱自导航防线：`sandbox="allow-scripts"` 挡不住 iframe 自己 location.replace
 * 到外站（把凭据当 query 带走）。第一道是父文档的 CSP `frame-src blob:`
 * （index.html / tauri.conf.json）；这里是第二道——ready 之后 iframe 再触发
 * load 只可能是它自己导航走了，立刻 dispose 并标记 compromised。
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
/** 宿主代发请求的默认超时（插件可用 request.timeoutMs 调小） */
const FETCH_TIMEOUT_MS = 30_000
/** 插件给的 timeoutMs 上限：再大也不允许一个请求永远挂着占住宿主 */
const FETCH_TIMEOUT_MAX_MS = 120_000
/** 每插件保留多少条请求 / console 日志（环形） */
const LOG_RING_SIZE = 200
/** 凭据串上限 64 KiB：几 MB 的串会把加密清单连同 NAS 的 token 一起写崩 localStorage */
const MAX_CREDENTIALS_BYTES = 64 * 1024

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

// ===================================================
// 消息与日志的净化（沙箱来的东西一律当不可信输入）
// ===================================================

/**
 * 请求日志里的 URL 只留 origin + pathname。
 * query 本身就是凭据：QQ 登录 CGI 的 ptqrtoken/login_sig、取流地址的 vkey、
 * 网易云的 csrf_token 全在 query 上。用户把音源设置里的请求日志截图求助时，
 * 整条 URL 就跟着出去了。
 */
export function logSafeUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl)
    return `${u.origin}${u.pathname}`
  } catch {
    // 解析不了的串宁可不记：不能赌它里面没有凭据
    return '(unparseable url)'
  }
}

/**
 * 凭据回写的合法形状：字符串或 null，且 ≤ 64 KiB。
 * 不限类型/长度就直接进加密清单的话，一个几 MB 的串会把 localStorage 配额
 * 撑爆——连带同一份清单里 NAS 音乐服务器的 token 一起写盘失败。
 */
export function isValidCredentialsValue(value: unknown): value is string | null {
  if (value === null) return true
  if (typeof value !== 'string') return false
  // UTF-8 字节数恒 ≥ 字符数，先按字符数短路，几 MB 的串不必真去编码
  if (value.length > MAX_CREDENTIALS_BYTES) return false
  return new TextEncoder().encode(value).length <= MAX_CREDENTIALS_BYTES
}

/** ready 报的方法表必须是 string[]：不是数组时 hasMethod 里的 includes 会直接抛 */
export function isMethodList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(m => typeof m === 'string')
}

/** 插件给的 timeoutMs 落进 (0, 120s]，非法值回落默认 30s */
export function resolveFetchTimeout(timeoutMs: unknown): number {
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) return FETCH_TIMEOUT_MS
  return Math.min(timeoutMs, FETCH_TIMEOUT_MAX_MS)
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
  /** 沙箱越界（自导航外泄）时通知调用方：此时沙箱已被拆掉，该音源不可再用 */
  onCompromised?: (reason: string) => void
}

export class PluginHost {
  readonly manifest: PluginManifest
  /** ready 后回填：插件实际导出的方法路径 */
  methods: string[] = []
  readonly requestLogs: PluginRequestLogEntry[] = []
  readonly consoleLogs: PluginConsoleLogEntry[] = []
  /** 沙箱越界（ready 之后自己导航走）：置位后沙箱已拆，这个实例不再可用 */
  compromised = false

  private iframe: HTMLIFrameElement | null = null
  private blobUrl: string | null = null
  private rpcSeq = 0
  private disposed = false
  private ready = false
  private readonly options: PluginHostOptions
  private readonly pendingCalls = new Map<number, {
    resolve: (value: unknown) => void
    reject: (err: PluginCallError) => void
    timer: ReturnType<typeof setTimeout>
  }>()
  /** 在途请求的中止句柄：dispose 时全部 abort，不让沙箱拆了请求还在跑 */
  private readonly pendingFetchAborts = new Set<AbortController>()
  private messageListener: ((event: MessageEvent) => void) | null = null
  private loadListener: (() => void) | null = null

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
    // 自导航防线（CSP frame-src 之后的第二道）：blob 文档只会 load 一次，
    // ready 之后再来一次 load 只可能是插件自己 location.replace 走了——
    // 那一跳的 URL 里可能就带着 env.credentials。立刻拆掉，并标记该插件越界。
    this.loadListener = () => {
      if (this.disposed || !this.ready) return
      this.markCompromised('sandbox navigated away after ready')
    }
    iframe.addEventListener('load', this.loadListener)
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
      this.ready = true
      return methods
    } catch (err) {
      /*
       * ready 超时或初始化失败：必须把沙箱整个拆掉。
       * 不拆的话 iframe 仍挂在 body 上、message 监听仍在、blob 未 revoke——
       * 一个「宿主认为连接失败」的沙箱还能无限期通过宿主代发白名单内的请求，
       * pluginRuntime 从没登记过它，登出 / 断开都够不着，每次重试再叠一个。
       */
      this.dispose()
      throw err
    } finally {
      clearInterval(retryTimer)
    }
  }

  /** 沙箱越界：拆掉并记一条 error，调用方（pluginRuntime / 音源设置）可读 compromised */
  private markCompromised(reason: string): void {
    this.compromised = true
    console.error(`[plugin:${this.manifest.id}] 沙箱越界，已拆除：${reason}`)
    this.options.onCompromised?.(reason)
    this.dispose()
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
    // 在途请求一并中止：沙箱都拆了还让请求跑完，等于凭据继续在网上飞
    for (const controller of this.pendingFetchAborts) controller.abort()
    this.pendingFetchAborts.clear()
    if (this.messageListener) {
      window.removeEventListener('message', this.messageListener)
      this.messageListener = null
    }
    if (this.loadListener) {
      this.iframe?.removeEventListener('load', this.loadListener)
      this.loadListener = null
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

  /** 畸形消息不处理，只留一条 warn（沙箱来的东西一律当不可信输入） */
  private warnMalformed(what: string): void {
    console.warn(`[plugin:${this.manifest.id}] 忽略畸形沙箱消息：${what}`)
  }

  private handleSandboxMessage(msg: SandboxToHostMessage): void {
    switch (msg.type) {
      case 'ready':
        // methods 不是 string[] 时 hasMethod 的 includes 会直接抛（沙箱能靠
        // 一条畸形 ready 把能力探测搞崩）——按没收到 ready 处理，init 自会超时
        if (!isMethodList(msg.methods)) {
          this.warnMalformed('ready.methods 不是 string[]')
          break
        }
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
        // 类型/长度都不限就直接进加密清单的话，几 MB 的串能把 localStorage
        // 配额撑爆，同一份清单里 NAS 的 token 会跟着写盘失败
        if (!isValidCredentialsValue(msg.value)) {
          this.warnMalformed(`credentials 必须是 ≤${MAX_CREDENTIALS_BYTES} 字节的字符串或 null`)
          break
        }
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

  /**
   * 给一个 controller 挂上超时。首选 AbortSignal.timeout（原生计时器）；
   * 老 WebView 上没有它时退回 setTimeout——这一步绝不能抛，否则
   * handleSandboxFetch 直接炸，沙箱等不到任何回包，只能干等自己的超时。
   */
  private startFetchTimeout(timeoutMs: number, controller: AbortController): () => void {
    const abort = () => controller.abort(new Error(`Host fetch timeout after ${timeoutMs}ms`))
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      const signal = AbortSignal.timeout(timeoutMs)
      if (signal.aborted) {
        abort()
        return () => {}
      }
      signal.addEventListener('abort', abort, { once: true })
      return () => signal.removeEventListener('abort', abort)
    }
    const timer = setTimeout(abort, timeoutMs)
    return () => clearTimeout(timer)
  }

  private async handleSandboxFetch(id: number, request: HostFetchRequest): Promise<void> {
    const startedAt = Date.now()
    // 超时与 dispose 共用一个 controller：任一触发都真正掐断在途请求。
    // （此前 request.timeoutMs 被完全忽略，dispose 之后请求照跑到底。）
    const controller = new AbortController()
    const clearFetchTimeout = this.startFetchTimeout(resolveFetchTimeout(request.timeoutMs), controller)
    this.pendingFetchAborts.add(controller)

    let result: Awaited<ReturnType<typeof hostFetch>>
    try {
      result = await hostFetch(request, this.manifest.hosts, {
        pluginId: this.manifest.id,
        signal: controller.signal,
      })
    } catch (err) {
      result = {
        ok: false,
        error: { code: 'network', message: err instanceof Error ? err.message : String(err) },
      }
    } finally {
      this.pendingFetchAborts.delete(controller)
      clearFetchTimeout()
    }
    // 请求日志：只记元数据，URL 只留 origin+pathname（query 里就是凭据），
    // 不存 body 与 Cookie
    this.requestLogs.push({
      time: startedAt,
      method: request.method,
      url: logSafeUrl(request.url),
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
