/**
 * @vitest-environment happy-dom
 *
 * PluginHost 的宿主侧防线：
 *  - 沙箱自导航（ready 之后 iframe 再 load）立即拆沙箱并标记 compromised；
 *  - 请求日志只留 origin+pathname（query 里就是 ptqrtoken / vkey 这类凭据）；
 *  - 沙箱来的消息按形状校验（畸形的忽略 + 一条 warn）；
 *  - 代发请求带超时信号，dispose 时在途请求全部 abort。
 *
 * 沙箱真链路（blob 文档 + 运行时）由浏览器走查覆盖；这里用 postMessage
 * 直接扮演沙箱，只测宿主这一侧的判断。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HostFetchRequest, HostFetchResult, PluginManifest } from '../types'
import {
  PluginHost,
  isMethodList,
  isValidCredentialsValue,
  logSafeUrl,
  resolveFetchTimeout,
  type PluginHostOptions,
} from './PluginHost'

/** hostFetch 桩：记下调用参数，默认永不 resolve（模拟在途请求） */
const fetchCalls = vi.hoisted(() => ({
  list: [] as Array<{ request: HostFetchRequest; options: { pluginId?: string; signal?: AbortSignal } }>,
  resolveNext: null as ((result: HostFetchResult) => void) | null,
}))
vi.mock('./hostFetch', () => ({
  hostFetch: (request: HostFetchRequest, _allow: readonly string[], options: { pluginId?: string; signal?: AbortSignal } = {}) => {
    fetchCalls.list.push({ request, options })
    return new Promise<HostFetchResult>(resolve => { fetchCalls.resolveNext = resolve })
  },
}))

const manifest: PluginManifest = {
  id: 'mock', name: 'Mock', version: '0.1.0', protocol: 1, platform: 'mock',
  entry: 'index.js', auth: { kind: 'none' }, hosts: ['music.163.com'],
  capabilities: ['search'], disclaimer: 'x',
}

const storage = { get: async () => null, set: async () => {} }

/** 装一个沙箱并扮演它回 ready；返回 host 与那个 iframe */
async function bootHost(options: Partial<PluginHostOptions> = {}) {
  const host = new PluginHost(manifest, {
    env: { appVersion: '1.0.0', locale: 'zh-CN', platform: 'web', userVariables: {} },
    credentials: null,
    storage,
    ...options,
  })
  const ready = host.init('module.exports = {}')
  const iframe = document.querySelector('iframe') as HTMLIFrameElement
  postFromSandbox(iframe, { type: 'ready', methods: ['search'] })
  await ready
  return { host, iframe }
}

/** 以「沙箱窗口」的身份给宿主发一条消息（宿主只认 event.source） */
function postFromSandbox(iframe: HTMLIFrameElement, data: unknown): void {
  window.dispatchEvent(new MessageEvent('message', { data, source: iframe.contentWindow }))
}

beforeEach(() => {
  fetchCalls.list = []
  fetchCalls.resolveNext = null
  // happy-dom 会真的去导航 iframe 的 blob: 地址并报「blob scheme 不支持」——
  // 与被测逻辑无关的噪音，静音掉（各用例要断言的 error 自己再 spy）
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  document.querySelectorAll('iframe').forEach(f => f.remove())
  vi.restoreAllMocks()
})

describe('logSafeUrl（请求日志不记 query）', () => {
  it('只留 origin + pathname', () => {
    expect(logSafeUrl('https://ssl.ptlogin2.qq.com/ptqrlogin?ptqrtoken=1234567&login_sig=abc'))
      .toBe('https://ssl.ptlogin2.qq.com/ptqrlogin')
    expect(logSafeUrl('https://isure.stream.qqmusic.qq.com/C400.m4a?vkey=SECRET&guid=1'))
      .toBe('https://isure.stream.qqmusic.qq.com/C400.m4a')
  })

  it('端口保留（origin 的一部分），hash / 参数一律不留', () => {
    expect(logSafeUrl('https://music.163.com:8443/api/x?csrf_token=t#frag'))
      .toBe('https://music.163.com:8443/api/x')
  })

  it('解析不了的串不原样记（宁可不记也不赌里面没有凭据）', () => {
    expect(logSafeUrl('not a url?token=secret')).toBe('(unparseable url)')
  })
})

describe('消息形状校验', () => {
  it('credentials 只认字符串 / null 且 ≤ 64 KiB', () => {
    expect(isValidCredentialsValue('MUSIC_U=abc')).toBe(true)
    expect(isValidCredentialsValue(null)).toBe(true)
    expect(isValidCredentialsValue(undefined)).toBe(false)
    expect(isValidCredentialsValue(42)).toBe(false)
    expect(isValidCredentialsValue({ a: 1 })).toBe(false)
    expect(isValidCredentialsValue('x'.repeat(64 * 1024))).toBe(true)
    expect(isValidCredentialsValue('x'.repeat(64 * 1024 + 1))).toBe(false)
    // 按 UTF-8 字节数算：中文 3 字节一个，2 万多字就超
    expect(isValidCredentialsValue('中'.repeat(30_000))).toBe(false)
  })

  it('methods 必须是 string[]', () => {
    expect(isMethodList(['search', 'n1ko.auth.getUser'])).toBe(true)
    expect(isMethodList([])).toBe(true)
    expect(isMethodList('search')).toBe(false)
    expect(isMethodList(null)).toBe(false)
    expect(isMethodList(['search', 42])).toBe(false)
  })

  it('畸形 ready 不 resolve init，只记一条 warn（hasMethod 不会因此抛）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const host = new PluginHost(manifest, {
      env: { appVersion: '1.0.0', locale: 'zh-CN', platform: 'web', userVariables: {} },
      credentials: null, storage,
    })
    let settled = false
    const ready = host.init('module.exports = {}').then(() => { settled = true }).catch(() => { settled = true })
    const iframe = document.querySelector('iframe') as HTMLIFrameElement
    postFromSandbox(iframe, { type: 'ready', methods: 'search' })
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(warn).toHaveBeenCalled()
    expect(() => host.hasMethod('search')).not.toThrow()
    // 正常 ready 仍能收尾（不必等 10 秒超时）
    postFromSandbox(iframe, { type: 'ready', methods: ['search'] })
    await ready
    expect(host.hasMethod('search')).toBe(true)
  })

  it('畸形 credentials 不落盘，合法的照常回调', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const changes: Array<string | null> = []
    const { iframe } = await bootHost({ onCredentialsChange: next => { changes.push(next) } })

    postFromSandbox(iframe, { type: 'credentials', value: { evil: true } })
    postFromSandbox(iframe, { type: 'credentials', value: 'x'.repeat(64 * 1024 + 1) })
    expect(changes).toEqual([])
    expect(warn).toHaveBeenCalled()

    postFromSandbox(iframe, { type: 'credentials', value: 'MUSIC_U=abc' })
    postFromSandbox(iframe, { type: 'credentials', value: null })
    expect(changes).toEqual(['MUSIC_U=abc', null])
  })
})

describe('沙箱自导航（S2 兜底）', () => {
  it('ready 之后 iframe 再 load → 拆沙箱并标记 compromised', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const reasons: string[] = []
    const { host, iframe } = await bootHost({ onCompromised: reason => { reasons.push(reason) } })
    expect(host.compromised).toBe(false)

    // 插件自己 location.replace 走了 → 第二次 load
    iframe.dispatchEvent(new Event('load'))

    expect(host.compromised).toBe(true)
    expect(reasons).toHaveLength(1)
    // 沙箱已拆：iframe 不在文档里，后续调用直接报废
    expect(document.querySelector('iframe')).toBeNull()
    await expect(host.call('search')).rejects.toThrow(/disposed/)
  })

  it('ready 之前的 load（首次装载）不算越界', async () => {
    const host = new PluginHost(manifest, {
      env: { appVersion: '1.0.0', locale: 'zh-CN', platform: 'web', userVariables: {} },
      credentials: null, storage,
    })
    const ready = host.init('module.exports = {}')
    const iframe = document.querySelector('iframe') as HTMLIFrameElement
    iframe.dispatchEvent(new Event('load'))
    expect(host.compromised).toBe(false)
    postFromSandbox(iframe, { type: 'ready', methods: [] })
    await ready
    expect(host.compromised).toBe(false)
    host.dispose()
  })
})

describe('代发请求的超时与中止（S8）', () => {
  it('timeoutMs 落进 (0, 120s]，非法值回落 30s', () => {
    expect(resolveFetchTimeout(undefined)).toBe(30_000)
    expect(resolveFetchTimeout(5_000)).toBe(5_000)
    expect(resolveFetchTimeout(0)).toBe(30_000)
    expect(resolveFetchTimeout(-1)).toBe(30_000)
    expect(resolveFetchTimeout('20000')).toBe(30_000)
    expect(resolveFetchTimeout(Number.POSITIVE_INFINITY)).toBe(30_000)
    expect(resolveFetchTimeout(10 ** 9)).toBe(120_000)
  })

  it('请求带 signal 与 pluginId；dispose 时在途请求被 abort', async () => {
    const { host, iframe } = await bootHost()
    postFromSandbox(iframe, {
      type: 'fetch', id: 1,
      request: { url: 'https://music.163.com/api?csrf_token=secret', method: 'GET', responseType: 'json' },
    })
    await Promise.resolve()
    expect(fetchCalls.list).toHaveLength(1)
    const { options } = fetchCalls.list[0]
    expect(options.pluginId).toBe('mock')
    expect(options.signal?.aborted).toBe(false)

    host.dispose()
    expect(options.signal?.aborted).toBe(true)
  })

  it('请求日志只存 origin+pathname，不存 query', async () => {
    const { host, iframe } = await bootHost()
    postFromSandbox(iframe, {
      type: 'fetch', id: 1,
      request: { url: 'https://music.163.com/weapi/song?csrf_token=SECRET', method: 'GET', responseType: 'json' },
    })
    await Promise.resolve()
    fetchCalls.resolveNext?.({ ok: true, status: 200, headers: {}, body: '{}', bodyEncoding: 'text' })
    await new Promise(r => setTimeout(r, 0))

    expect(host.requestLogs).toHaveLength(1)
    expect(host.requestLogs[0].url).toBe('https://music.163.com/weapi/song')
    expect(host.requestLogs[0].status).toBe(200)
    host.dispose()
  })
})

describe('init 失败时的回收', () => {
  it('ready 超时：iframe 被拆、后续 call 抛 disposed，不留能代发请求的孤儿沙箱', async () => {
    vi.useFakeTimers()
    try {
      const host = new PluginHost(manifest, {
        env: { appVersion: '1.0.0', locale: 'zh-CN', platform: 'web', userVariables: {} },
        credentials: null, storage,
      })
      const ready = host.init('module.exports = {}')
      const rejected = ready.then(() => 'resolved', (e: Error) => e.message)
      expect(document.querySelector('iframe')).not.toBeNull()
      await vi.advanceTimersByTimeAsync(10_001)
      expect(await rejected).toMatch(/not ready/)
      expect(document.querySelector('iframe')).toBeNull()
      await expect(host.call('search', [])).rejects.toThrow()
    } finally {
      vi.useRealTimers()
    }
  })
})
