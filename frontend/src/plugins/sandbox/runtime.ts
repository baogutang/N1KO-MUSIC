/**
 * 插件沙箱运行时（PROTOCOL §3 / §4 / §8）。
 *
 * 这个文件会被打成两份产物：
 *  - `public/plugin-sandbox.js`（IIFE，加载进 opaque-origin iframe，见
 *    vite.sandbox.config.ts 与 host/sandboxDocument.ts）；
 *  - 单测直接 import `createSandboxRuntime`，注入假的 postMessage 通道。
 *
 * 沙箱里插件只能做三件事：执行 CommonJS 代码、经宿主发请求（require('axios')）、
 * 读写宿主托管的凭据与私有存储。CSP 把直连网络整个拦掉。
 */

import CryptoJS from 'crypto-js'
import dayjs from 'dayjs'
import qs from 'qs'
import he from 'he'

import type {
  HostFetchRequest,
  HostFetchResult,
  HostToSandboxMessage,
  PluginEnvData,
  PluginErrorCode,
  PluginExports,
  SandboxToHostMessage,
  SerializedPluginError,
} from '../types'
import { createAxiosShim } from './shims/axios'
import { bigInt } from './shims/bigInteger'

// ===================================================
// PluginError（PROTOCOL §7）：注入全局供插件代码使用
// ===================================================

export class PluginError extends Error {
  readonly code: PluginErrorCode
  readonly detail?: unknown
  constructor(code: PluginErrorCode, message: string, detail?: unknown) {
    super(message)
    this.name = 'PluginError'
    this.code = code
    this.detail = detail
  }
}

function serializeError(err: unknown): SerializedPluginError {
  if (err instanceof PluginError) {
    return { code: err.code, message: err.message, ...(err.detail !== undefined ? { detail: err.detail } : {}) }
  }
  return { code: 'unknown', message: err instanceof Error ? err.message : String(err) }
}

// ===================================================
// 传输通道与代码加载器
// ===================================================

export interface SandboxTransport {
  send(msg: SandboxToHostMessage): void
  onMessage(handler: (msg: HostToSandboxMessage) => void): () => void
}

type PluginFactory = (
  module: { exports: unknown },
  exports: Record<string, unknown>,
  require: (name: string) => unknown,
  env: unknown,
  console: Console
) => void

/**
 * 把插件 CommonJS 代码变成 factory 调用。生产用 blob 脚本（协议禁止 eval）；
 * 单测注入同步实现。加载是异步的（脚本标签），invoke 在代码执行那一刻被调。
 */
export type PluginCodeLoader = (code: string, invoke: (factory: PluginFactory) => void) => void

/** 浏览器实现：blob: 脚本。CSP `script-src {ORIGIN} blob:` 放行 */
export const browserCodeLoader: PluginCodeLoader = (code, invoke) => {
  const hook = '__n1koPluginFactory__'
  const scope = self as unknown as Record<string, unknown>
  scope[hook] = invoke
  // 行尾注释会吞掉补的 "\n})"，所以 code 后必须先换行再闭合
  const boot = `self[${JSON.stringify(hook)}](function (module, exports, require, env, console) {\n${code}\n});`
  const url = URL.createObjectURL(new Blob([boot], { type: 'text/javascript' }))
  const script = document.createElement('script')
  const cleanup = () => {
    delete scope[hook]
    URL.revokeObjectURL(url)
  }
  script.onload = () => cleanup()
  script.onerror = () => {
    cleanup()
    invoke(() => { throw new Error('Failed to load plugin script (CSP or syntax error)') })
  }
  script.src = url
  document.head.appendChild(script)
}

// ===================================================
// 方法路径收集与解析
// ===================================================

/** 导出对象上所有方法路径（'search'、'n1ko.auth.checkQr'），供宿主能力探测 */
export function collectMethodPaths(exports: object): string[] {
  const paths: string[] = []
  const walk = (obj: object, prefix: string, depth: number) => {
    for (const key of Object.keys(obj)) {
      if (prefix === '' && (key === 'platform' || key === 'version')) continue
      const value = (obj as Record<string, unknown>)[key]
      const path = prefix ? `${prefix}.${key}` : key
      if (typeof value === 'function') {
        paths.push(path)
      } else if (value && typeof value === 'object' && depth < 2) {
        walk(value, path, depth + 1)
      }
    }
  }
  walk(exports, '', 0)
  return paths
}

function resolveMethod(exports: object, method: string): ((...args: unknown[]) => unknown) | null {
  let current: unknown = exports
  for (const part of method.split('.')) {
    if (!current || typeof current !== 'object') return null
    current = (current as Record<string, unknown>)[part]
  }
  return typeof current === 'function' ? (current as (...args: unknown[]) => unknown) : null
}

function stringifyArg(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

const DEFAULT_FETCH_TIMEOUT_MS = 30_000

// ===================================================
// 运行时
// ===================================================

export interface SandboxRuntime {
  /** 断开传输、清掉在途请求；测试收尾用 */
  dispose(): void
}

export function createSandboxRuntime(
  transport: SandboxTransport,
  options: { loadPluginCode?: PluginCodeLoader } = {}
): SandboxRuntime {
  const loadPluginCode = options.loadPluginCode ?? browserCodeLoader

  let pluginExports: PluginExports | null = null
  let initialized = false
  let rpcSeq = 0

  const pendingFetches = new Map<number, {
    resolve: (result: HostFetchResult) => void
    timer: ReturnType<typeof setTimeout>
  }>()
  const pendingStorage = new Map<number, { resolve: (value: string | null) => void }>()

  const fetchViaHost = (request: HostFetchRequest): Promise<HostFetchResult> =>
    new Promise(resolve => {
      const id = ++rpcSeq
      const timeoutMs = request.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS
      const timer = setTimeout(() => {
        pendingFetches.delete(id)
        resolve({ ok: false, error: { code: 'network', message: `Request timeout after ${timeoutMs}ms: ${request.url}` } })
      }, timeoutMs)
      pendingFetches.set(id, { resolve, timer })
      transport.send({ type: 'fetch', id, request })
    })

  const requireShim = (name: string): unknown => {
    switch (name) {
      case 'axios':
        return createAxiosShim(fetchViaHost)
      case 'crypto-js':
        return CryptoJS
      case 'dayjs':
        return dayjs
      case 'qs':
        return qs
      case 'he':
        return he
      case 'big-integer':
        // 社区插件的习惯是 const bigInt = require('big-integer')，直接给可调用函数
        return bigInt
      case 'cheerio':
        throw new PluginError(
          'unsupported',
          'cheerio is not available in the sandbox; use the built-in DOMParser instead'
        )
      default:
        throw new PluginError('unsupported', `Unknown module in sandbox: ${name}`)
    }
  }

  const consoleShim: Console = {
    log: (...args: unknown[]) => transport.send({ type: 'log', level: 'log', args: args.map(stringifyArg) }),
    info: (...args: unknown[]) => transport.send({ type: 'log', level: 'info', args: args.map(stringifyArg) }),
    warn: (...args: unknown[]) => transport.send({ type: 'log', level: 'warn', args: args.map(stringifyArg) }),
    error: (...args: unknown[]) => transport.send({ type: 'log', level: 'error', args: args.map(stringifyArg) }),
  } as Console

  const storageGet = (key: string): Promise<string | null> =>
    new Promise(resolve => {
      const id = ++rpcSeq
      pendingStorage.set(id, { resolve })
      transport.send({ type: 'storage:get', id, key })
    })

  const storageSet = (key: string, value: string): Promise<void> =>
    new Promise(resolve => {
      const id = ++rpcSeq
      pendingStorage.set(id, { resolve: () => resolve() })
      transport.send({ type: 'storage:set', id, key, value })
    })

  const handleInit = (msg: Extract<HostToSandboxMessage, { type: 'init' }>) => {
    // 宿主在脚本就绪前发的 init 会丢失，因此它会重试到收到 ready 为止；
    // 重复 init 只重发 ready，不重跑插件代码（副作用会翻倍）
    if (initialized) {
      transport.send({ type: 'ready', methods: pluginExports ? collectMethodPaths(pluginExports) : [] })
      return
    }
    const env = {
      appVersion: msg.env.appVersion,
      locale: msg.env.locale,
      platform: msg.env.platform,
      userVariables: msg.env.userVariables,
      credentials: msg.env.credentials,
      setCredentials: (value: string | null) => transport.send({ type: 'credentials', value }),
      storage: { get: storageGet, set: storageSet },
    }

    loadPluginCode(msg.code, factory => {
      try {
        const module = { exports: {} as unknown }
        factory(module, module.exports as Record<string, unknown>, requireShim, env, consoleShim)
        pluginExports = (module.exports ?? {}) as PluginExports
      } catch (err) {
        transport.send({
          type: 'log',
          level: 'error',
          args: [`Plugin load failed: ${err instanceof Error ? err.message : String(err)}`],
        })
        pluginExports = null
      }
      initialized = true
      transport.send({ type: 'ready', methods: pluginExports ? collectMethodPaths(pluginExports) : [] })
    })
  }

  const handleCall = async (msg: Extract<HostToSandboxMessage, { type: 'call' }>) => {
    if (!initialized || !pluginExports) {
      transport.send({ type: 'result', id: msg.id, ok: false, error: { code: 'not-found', message: 'Sandbox not initialized' } })
      return
    }
    const method = resolveMethod(pluginExports, msg.method)
    if (!method) {
      transport.send({ type: 'result', id: msg.id, ok: false, error: { code: 'not-found', message: `Method not found: ${msg.method}` } })
      return
    }
    try {
      const value = await method(...msg.args)
      transport.send({ type: 'result', id: msg.id, ok: true, value: value ?? null })
    } catch (err) {
      transport.send({ type: 'result', id: msg.id, ok: false, error: serializeError(err) })
    }
  }

  const unsubscribe = transport.onMessage(msg => {
    switch (msg.type) {
      case 'init':
        handleInit(msg)
        break
      case 'call':
        void handleCall(msg)
        break
      case 'fetch:result': {
        const pending = pendingFetches.get(msg.id)
        if (!pending) return
        clearTimeout(pending.timer)
        pendingFetches.delete(msg.id)
        pending.resolve(msg.ok
          ? { ok: true, status: msg.status, headers: msg.headers, body: msg.body, bodyEncoding: msg.bodyEncoding }
          : { ok: false, error: msg.error })
        break
      }
      case 'storage:result': {
        const pending = pendingStorage.get(msg.id)
        if (!pending) return
        pendingStorage.delete(msg.id)
        pending.resolve(msg.value)
        break
      }
    }
  })

  return {
    dispose: () => {
      unsubscribe()
      for (const { timer } of pendingFetches.values()) clearTimeout(timer)
      pendingFetches.clear()
      pendingStorage.clear()
    },
  }
}

// ===================================================
// 浏览器入口：接到 window.message（仅当真的运行在 iframe 里）
// ===================================================

export function startWindowRuntime(): void {
  const win = window
  const transport: SandboxTransport = {
    // opaque origin 只能用 '*'；宿主侧校验 event.source
    send: msg => { win.parent.postMessage(msg, '*') },
    onMessage: handler => {
      const listener = (event: MessageEvent) => {
        if (event.source !== win.parent) return
        handler(event.data as HostToSandboxMessage)
      }
      win.addEventListener('message', listener)
      return () => win.removeEventListener('message', listener)
    },
  }
  // 注入全局，插件代码 new PluginError(...) 用
  ;(self as unknown as Record<string, unknown>).PluginError = PluginError
  createSandboxRuntime(transport)
}

if (typeof window !== 'undefined' && window.parent !== window) {
  startWindowRuntime()
}
