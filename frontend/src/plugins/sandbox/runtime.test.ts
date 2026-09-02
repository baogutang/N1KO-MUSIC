/**
 * 沙箱运行时（PLAN 1.1 验收）：用假的 postMessage 通道测
 * init → ready → call → result、fetch 往返、超时、错误码透传。
 *
 * 生产环境插件代码走 blob: 脚本（协议禁止 eval，浏览器才有这条管线），
 * 测试注入同步加载器：运行时的其余逻辑（方法收集、RPC、shim）与生产完全同一条路径。
 */

import { describe, expect, it, vi } from 'vitest'
import {
  createSandboxRuntime,
  collectMethodPaths,
  PluginError,
  type PluginCodeLoader,
  type SandboxTransport,
} from './runtime'
import type { HostFetchRequest, HostToSandboxMessage, SandboxToHostMessage } from '../types'

/** 同步代码加载器：测试专用（生产是 blob 脚本） */
const syncLoader: PluginCodeLoader = (code, invoke) => {
  // 生产环境 PluginError 由 startWindowRuntime 注入 self；测试注入 globalThis
  (globalThis as unknown as Record<string, unknown>).PluginError = PluginError
  const factory = new Function('module', 'exports', 'require', 'env', 'console', code)
  invoke(factory as never)
}


/** 一对直连的假通道：host 侧驱动、捕获沙箱发出的消息 */
function makeChannel() {
  const sentFromSandbox: SandboxToHostMessage[] = []
  let hostHandler: ((msg: HostToSandboxMessage) => void) | null = null
  const transport: SandboxTransport = {
    send: msg => { sentFromSandbox.push(msg) },
    onMessage: handler => {
      hostHandler = handler
      return () => { hostHandler = null }
    },
  }
  const hostSend = (msg: HostToSandboxMessage) => { hostHandler?.(msg) }
  const clear = () => { sentFromSandbox.length = 0 }
  return { transport, hostSend, sentFromSandbox, clear }
}

function boot(code: string) {
  const channel = makeChannel()
  const runtime = createSandboxRuntime(channel.transport, { loadPluginCode: syncLoader })
  channel.hostSend({
    type: 'init',
    pluginId: 'test-plugin',
    code,
    env: { appVersion: '1.10.0', locale: 'zh-CN', platform: 'web', userVariables: {}, credentials: 'cookie-x' },
  })
  return { ...channel, runtime }
}

const readyOf = (msgs: SandboxToHostMessage[]) =>
  msgs.find(m => m.type === 'ready') as Extract<SandboxToHostMessage, { type: 'ready' }>

/** 取某次 call 的成功值；不成功时直接让用例失败 */
function resultValue<T>(msgs: SandboxToHostMessage[], id: number): T {
  const m = msgs.find(x => x.type === 'result' && x.id === id)
  if (!m || m.type !== 'result' || !m.ok) throw new Error(`result ${id} not ok: ${JSON.stringify(m)}`)
  return m.value as T
}

/** 取某次 call 的错误码 */
function resultError(msgs: SandboxToHostMessage[], id: number): SerializedPluginErrorShape {
  const m = msgs.find(x => x.type === 'result' && x.id === id)
  if (!m || m.type !== 'result' || m.ok) throw new Error(`result ${id} unexpectedly ok`)
  return m.error
}

interface SerializedPluginErrorShape { code: string; message: string }

describe('init → ready', () => {
  it('收集顶层与 n1ko 命名空间的方法路径，跳过 platform/version 字符串', () => {
    const { sentFromSandbox } = boot(`
      module.exports = {
        platform: 'test', version: '0.1.0',
        search: async () => ({ isEnd: true, data: [] }),
        getLyric: async () => ({}),
        n1ko: {
          auth: {
            createQr: async () => ({ key: 'k', content: 'c', expiresIn: 300 }),
            checkQr: async () => ({ status: 'waiting' }),
          },
          getMediaSource: async () => ({ url: 'https://x.test/a.mp3' }),
        },
      }
    `)
    const ready = readyOf(sentFromSandbox)
    expect(ready.methods.sort()).toEqual([
      'getLyric', 'n1ko.auth.checkQr', 'n1ko.auth.createQr', 'n1ko.getMediaSource', 'search',
    ].sort())
  })

  it('插件代码加载抛错时 ready 带空方法表并转交错误日志', () => {
    const { sentFromSandbox } = boot('throw new Error("boom at module scope")')
    expect(readyOf(sentFromSandbox).methods).toEqual([])
    const log = sentFromSandbox.find(m => m.type === 'log' && m.level === 'error')
    expect(log).toMatchObject({ type: 'log', level: 'error' })
    expect((log as { args: string[] }).args[0]).toContain('boom at module scope')
  })
})

describe('call → result', () => {
  it('调顶层方法并把返回值带回来', async () => {
    const { hostSend, sentFromSandbox } = boot(`
      module.exports = { search: async (q, page) => ({ isEnd: true, data: [{ id: q + ':' + page }] }) }
    `)
    hostSend({ type: 'call', id: 7, method: 'search', args: ['summer', 1] })
    await vi.waitFor(() => {
      expect(sentFromSandbox.some(m => m.type === 'result' && m.id === 7)).toBe(true)
    })
    const result = sentFromSandbox.find(m => m.type === 'result' && m.id === 7) as
      Extract<SandboxToHostMessage, { type: 'result' }>
    expect(result.ok).toBe(true)
    expect(resultValue<{ data: Array<{ id: string }> }>(sentFromSandbox, 7).data[0].id).toBe('summer:1')
  })

  it('调 n1ko 命名空间方法（getUser）', async () => {
    const { hostSend, sentFromSandbox } = boot(`
      module.exports = { n1ko: { auth: { getUser: async () => ({ id: '1', name: 'n1ko', vip: true }) } } }
    `)
    hostSend({ type: 'call', id: 1, method: 'n1ko.auth.getUser', args: [] })
    await vi.waitFor(() => {
      expect(sentFromSandbox.some(m => m.type === 'result' && m.id === 1)).toBe(true)
    })
    const result = sentFromSandbox.find(m => m.type === 'result' && m.id === 1) as
      Extract<SandboxToHostMessage, { type: 'result' }>
    expect(result.ok).toBe(true)
    expect(resultValue<{ name: string }>(sentFromSandbox, 1).name).toBe('n1ko')
  })

  it('未初始化 / 方法不存在时回 not-found，而不是挂死', async () => {
    const { transport, hostSend, sentFromSandbox } = makeChannel()
    const runtime = createSandboxRuntime(transport, { loadPluginCode: syncLoader })
    hostSend({ type: 'call', id: 1, method: 'search', args: [] })
    await vi.waitFor(() => {
      expect(sentFromSandbox.some(m => m.type === 'result' && m.id === 1)).toBe(true)
    })
    const result = sentFromSandbox.find(m => m.type === 'result' && m.id === 1) as
      Extract<SandboxToHostMessage, { type: 'result' }>
    expect(result.ok).toBe(false)
    expect(resultError(sentFromSandbox, 1).code).toBe('not-found')
    runtime.dispose()
  })

  it('PluginError 的错误码原样透传；普通异常归为 unknown', async () => {
    const { hostSend, sentFromSandbox } = boot(`
      module.exports = {
        needLogin: async () => { throw new PluginError('unauthorized', 'cookie expired') },
        broken: async () => { throw new Error('plain failure') },
      }
    `)
    hostSend({ type: 'call', id: 1, method: 'needLogin', args: [] })
    hostSend({ type: 'call', id: 2, method: 'broken', args: [] })
    await vi.waitFor(() => {
      expect(sentFromSandbox.filter(m => m.type === 'result').length).toBe(2)
    })
    const byId = (id: number) => sentFromSandbox.find(m => m.type === 'result' && m.id === id) as
      Extract<SandboxToHostMessage, { type: 'result' }>
    expect(byId(1).ok).toBe(false)
    expect(resultError(sentFromSandbox, 1).code).toBe('unauthorized')
    expect(resultError(sentFromSandbox, 1).message).toBe('cookie expired')
    expect(resultError(sentFromSandbox, 2).code).toBe('unknown')
  })
})

describe('require("axios") 与 fetch 往返', () => {
  it('get 请求经宿主往返：params 拼接、json 解析、headers 透传', async () => {
    const { hostSend, sentFromSandbox } = boot(`
      module.exports = {
        search: async (q) => {
          const axios = require('axios')
          const resp = await axios.get('https://api.example.test/song', { params: { q, n: [1, 2] } })
          return { status: resp.status, data: resp.data, ct: resp.headers['content-type'] }
        },
      }
    `)
    hostSend({ type: 'call', id: 1, method: 'search', args: ['summer'] })

    // 沙箱应发出一条 fetch 消息
    const fetchMsg = await vi.waitFor(() => {
      const m = sentFromSandbox.find(x => x.type === 'fetch') as
        Extract<SandboxToHostMessage, { type: 'fetch' }>
      expect(m).toBeTruthy()
      return m
    })
    const req: HostFetchRequest = fetchMsg.request
    expect(req.method).toBe('GET')
    expect(req.url).toBe('https://api.example.test/song?q=summer&n=1&n=2')
    expect(req.responseType).toBe('json')

    // 宿主回包
    hostSend({
      type: 'fetch:result', id: fetchMsg.id, ok: true, status: 200,
      headers: { 'content-type': 'application/json' },
      body: '{"result":[{"id":"1"}]}', bodyEncoding: 'text',
    })
    const result = await vi.waitFor(() => {
      const m = sentFromSandbox.find(x => x.type === 'result' && x.id === 1) as
        Extract<SandboxToHostMessage, { type: 'result' }>
      expect(m).toBeTruthy()
      return m
    })
    expect(resultValue<{ status: number }>(sentFromSandbox, 1).status).toBe(200)
    expect(resultValue<{ data: { result: unknown[] } }>(sentFromSandbox, 1).data.result).toHaveLength(1)
    expect(resultValue<{ ct: string }>(sentFromSandbox, 1).ct).toBe('application/json')
  })

  it('post 的对象 data 自动 JSON 序列化并补 Content-Type', async () => {
    const { hostSend, sentFromSandbox } = boot(`
      module.exports = {
        postIt: async () => {
          const axios = require('axios')
          return await axios.post('https://api.example.test/login', { user: 'a', pw: 'b' })
        },
      }
    `)
    hostSend({ type: 'call', id: 1, method: 'postIt', args: [] })
    const fetchMsg = await vi.waitFor(() => {
      const m = sentFromSandbox.find(x => x.type === 'fetch') as
        Extract<SandboxToHostMessage, { type: 'fetch' }>
      expect(m).toBeTruthy()
      return m
    })
    expect(fetchMsg.request.method).toBe('POST')
    expect(fetchMsg.request.headers?.['Content-Type']).toBe('application/json')
    expect(fetchMsg.request.body).toBe('{"user":"a","pw":"b"}')
    hostSend({
      type: 'fetch:result', id: fetchMsg.id, ok: true, status: 204,
      headers: {}, body: '', bodyEncoding: 'text',
    })
    await vi.waitFor(() => {
      const m = sentFromSandbox.find(x => x.type === 'result' && x.id === 1) as
        Extract<SandboxToHostMessage, { type: 'result' }>
      expect(m.ok).toBe(true)
    })
  })

  it('非 2xx 默认 reject，错误对象带 response.status（axios 语义）', async () => {
    const { hostSend, sentFromSandbox } = boot(`
      module.exports = {
        fail: async () => {
          const axios = require('axios')
          try {
            await axios.get('https://api.example.test/403')
            return { thrown: false }
          } catch (e) {
            return { thrown: true, status: e.response?.status, isAxiosError: !!e.isAxiosError }
          }
        },
      }
    `)
    hostSend({ type: 'call', id: 1, method: 'fail', args: [] })
    const fetchMsg = await vi.waitFor(() => {
      const m = sentFromSandbox.find(x => x.type === 'fetch') as
        Extract<SandboxToHostMessage, { type: 'fetch' }>
      expect(m).toBeTruthy()
      return m
    })
    hostSend({
      type: 'fetch:result', id: fetchMsg.id, ok: true, status: 403,
      headers: {}, body: '{"code":403}', bodyEncoding: 'text',
    })
    const result = await vi.waitFor(() => {
      const m = sentFromSandbox.find(x => x.type === 'result' && x.id === 1) as
        Extract<SandboxToHostMessage, { type: 'result' }>
      expect(m).toBeTruthy()
      return m
    })
    const value = resultValue<{ thrown: boolean; status?: number; isAxiosError: boolean }>(sentFromSandbox, 1)
    expect(value.thrown).toBe(true)
    expect(value.status).toBe(403)
    expect(value.isAxiosError).toBe(true)
  })

  it('base64 body 按 arraybuffer 解回二进制', async () => {
    const { hostSend, sentFromSandbox } = boot(`
      module.exports = {
        binary: async () => {
          const axios = require('axios')
          const resp = await axios.get('https://api.example.test/img', { responseType: 'arraybuffer' })
          return { byteLength: resp.data.byteLength, first: new Uint8Array(resp.data)[0] }
        },
      }
    `)
    hostSend({ type: 'call', id: 1, method: 'binary', args: [] })
    const fetchMsg = await vi.waitFor(() => {
      const m = sentFromSandbox.find(x => x.type === 'fetch') as
        Extract<SandboxToHostMessage, { type: 'fetch' }>
      expect(m).toBeTruthy()
      return m
    })
    // 'AAAA' → 3 个 0 字节
    hostSend({
      type: 'fetch:result', id: fetchMsg.id, ok: true, status: 200,
      headers: {}, body: 'AAAA', bodyEncoding: 'base64',
    })
    const result = await vi.waitFor(() => {
      const m = sentFromSandbox.find(x => x.type === 'result' && x.id === 1) as
        Extract<SandboxToHostMessage, { type: 'result' }>
      expect(m).toBeTruthy()
      return m
    })
    const value = resultValue<{ byteLength: number; first: number }>(sentFromSandbox, 1)
    expect(value.byteLength).toBe(3)
    expect(value.first).toBe(0)
  })

  it('宿主拒绝（白名单外）时插件收到可读错误', async () => {
    const { hostSend, sentFromSandbox } = boot(`
      module.exports = {
        blocked: async () => {
          const axios = require('axios')
          try { await axios.get('https://evil.test/x'); return { thrown: false } }
          catch (e) { return { thrown: true, code: e.code } }
        },
      }
    `)
    hostSend({ type: 'call', id: 1, method: 'blocked', args: [] })
    const fetchMsg = await vi.waitFor(() => {
      const m = sentFromSandbox.find(x => x.type === 'fetch') as
        Extract<SandboxToHostMessage, { type: 'fetch' }>
      expect(m).toBeTruthy()
      return m
    })
    hostSend({
      type: 'fetch:result', id: fetchMsg.id, ok: false,
      error: { code: 'forbidden', message: 'host not in allowlist' },
    })
    const result = await vi.waitFor(() => {
      const m = sentFromSandbox.find(x => x.type === 'result' && x.id === 1) as
        Extract<SandboxToHostMessage, { type: 'result' }>
      expect(m).toBeTruthy()
      return m
    })
    const value = resultValue<{ thrown: boolean; code: string }>(sentFromSandbox, 1)
    expect(value.thrown).toBe(true)
    expect(value.code).toBe('forbidden')
  })

  it('宿主不回包时按 timeoutMs 超时（network 错误码）', async () => {
    vi.useFakeTimers()
    try {
      const { hostSend, sentFromSandbox } = boot(`
        module.exports = {
          slow: async () => {
            const axios = require('axios')
            try { await axios.get('https://api.example.test/never', { timeout: 500 }); return { thrown: false } }
            catch (e) { return { thrown: true, code: e.code } }
          },
        }
      `)
      hostSend({ type: 'call', id: 1, method: 'slow', args: [] })
      await vi.waitFor(() => {
        expect(sentFromSandbox.some(x => x.type === 'fetch')).toBe(true)
      })
      // 不回 fetch:result，推时间
      await vi.advanceTimersByTimeAsync(600)
      const result = sentFromSandbox.find(x => x.type === 'result' && x.id === 1) as
        Extract<SandboxToHostMessage, { type: 'result' }>
      const value = resultValue<{ thrown: boolean; code: string }>(sentFromSandbox, 1)
      expect(value.thrown).toBe(true)
      expect(value.code).toBe('network')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('env：凭据回写与私有存储', () => {
  it('setCredentials 发 credentials 消息；storage 经宿主往返', async () => {
    const { hostSend, sentFromSandbox } = boot(`
      module.exports = {
        go: async () => {
          env.setCredentials('NEW_COOKIE')
          const old = await env.storage.get('guid')
          await env.storage.set('guid', 'g-42')
          return { old }
        },
      }
    `)
    hostSend({ type: 'call', id: 1, method: 'go', args: [] })

    const getMsg = await vi.waitFor(() => {
      const m = sentFromSandbox.find(x => x.type === 'storage:get') as
        Extract<SandboxToHostMessage, { type: 'storage:get' }>
      expect(m).toBeTruthy()
      return m
    })
    hostSend({ type: 'storage:result', id: getMsg.id, value: 'g-old' })

    const setMsg = await vi.waitFor(() => {
      const m = sentFromSandbox.find(x => x.type === 'storage:set') as
        Extract<SandboxToHostMessage, { type: 'storage:set' }>
      expect(m).toBeTruthy()
      return m
    })
    expect(setMsg.value).toBe('g-42')
    hostSend({ type: 'storage:result', id: setMsg.id, value: null })

    const result = await vi.waitFor(() => {
      const m = sentFromSandbox.find(x => x.type === 'result' && x.id === 1) as
        Extract<SandboxToHostMessage, { type: 'result' }>
      expect(m).toBeTruthy()
      return m
    })
    expect(resultValue<{ old: string }>(sentFromSandbox, 1).old).toBe('g-old')
    expect(sentFromSandbox.some(m => m.type === 'credentials' && m.value === 'NEW_COOKIE')).toBe(true)
  })

  it('console 转发到宿主（log 消息）', async () => {
    const { hostSend, sentFromSandbox } = boot(`
      module.exports = { talk: async () => { console.log('hello', { a: 1 }); console.error('bad') } }
    `)
    hostSend({ type: 'call', id: 1, method: 'talk', args: [] })
    await vi.waitFor(() => {
      expect(sentFromSandbox.filter(m => m.type === 'log').length).toBe(2)
    })
    const logs = sentFromSandbox.filter(m => m.type === 'log') as Array<Extract<SandboxToHostMessage, { type: 'log' }>>
    expect(logs[0]).toEqual({ type: 'log', level: 'log', args: ['hello', '{"a":1}'] })
    expect(logs[1].level).toBe('error')
  })
})

describe('require 的其它模块', () => {
  it('crypto-js / dayjs / qs / he 可用，big-integer 覆盖 modPow，cheerio 明确拒绝', async () => {
    const { hostSend, sentFromSandbox } = boot(`
      module.exports = {
        check: async () => {
          const CryptoJS = require('crypto-js')
          const dayjs = require('dayjs')
          const qs = require('qs')
          const he = require('he')
          const bigInt = require('big-integer')
          const md5 = CryptoJS.MD5('n1ko').toString()
          const parsed = qs.parse('a=1&b=2')
          const decoded = he.decode('a&amp;b')
          const day = dayjs('2026-09-02').format('YYYY')
          const sig = bigInt('7').modPow('13', '11').toString()
          let cheerioRejected = false
          try { require('cheerio') } catch { cheerioRejected = true }
          return { md5, parsed, decoded, day, sig, cheerioRejected }
        },
      }
    `)
    hostSend({ type: 'call', id: 1, method: 'check', args: [] })
    const result = await vi.waitFor(() => {
      const m = sentFromSandbox.find(x => x.type === 'result' && x.id === 1) as
        Extract<SandboxToHostMessage, { type: 'result' }>
      expect(m).toBeTruthy()
      return m
    })
    const v = resultValue<Record<string, unknown>>(sentFromSandbox, 1)
    expect(v.md5).toBe(CryptoJSRefMd5())
    expect(v.parsed).toEqual({ a: '1', b: '2' })
    expect(v.decoded).toBe('a&b')
    expect(v.day).toBe('2026')
    expect(v.sig).toBe(String(Math.pow(7, 13) % 11))
    expect(v.cheerioRejected).toBe(true)
  })

  it('不认识的模块名回 unsupported（require 抛的 PluginError 原样透传）', async () => {
    const { hostSend, sentFromSandbox } = boot(`
      module.exports = { need: async () => { require('left-pad') } }
    `)
    hostSend({ type: 'call', id: 1, method: 'need', args: [] })
    const result = await vi.waitFor(() => {
      const m = sentFromSandbox.find(x => x.type === 'result' && x.id === 1) as
        Extract<SandboxToHostMessage, { type: 'result' }>
      expect(m).toBeTruthy()
      return m
    })
    expect(result.ok).toBe(false)
    expect(resultError(sentFromSandbox, 1).code).toBe('unsupported')
  })
})

function CryptoJSRefMd5(): string {
  // 参考值由 crypto-js 本地算出，钉住 shim 传的是真包而不是空对象
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const CryptoJS = require('crypto-js') as { MD5(v: string): { toString(): string } }
  return CryptoJS.MD5('n1ko').toString()
}

describe('collectMethodPaths', () => {
  it('独立纯函数：深度截止在 2，避免无界遍历插件私有对象', () => {
    const paths = collectMethodPaths({
      platform: 'x',
      version: '0',
      search: async () => undefined,
      nested: { deeper: { deepest: { fn: async () => undefined } } },
    })
    expect(paths).toEqual(['search']) // nested.deeper.deepest.fn 深度 3，不收集
  })
})
