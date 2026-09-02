/**
 * 插件测试骨架（PLAN §4.2）：在 Node 里加载沙箱形态的插件。
 *
 * 插件代码是 CommonJS 文本，与沙箱运行时同一个工厂签名包裹执行：
 *   (function (module, exports, require, env, console) { … })
 * require 提供 axios（走 undici/fetch 的最小同形实现）与 crypto-js 等实包
 * （从 frontend/node_modules 解析——测试用，不进 App 依赖）。
 */

import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const frontendRequire = createRequire(path.resolve(here, '../../frontend/package.json'))

/** undici/fetch 之上的最小 axios 同形实现（get/post/request） */
function makeAxios() {
  async function request(config) {
    const url = new URL(config.url, 'https://example.invalid')
    if (config.params) {
      for (const [k, v] of Object.entries(config.params)) {
        const values = Array.isArray(v) ? v : [v]
        for (const item of values) url.searchParams.append(k, String(item))
      }
    }
    let body = config.data
    const headers = { ...(config.headers ?? {}) }
    if (body && typeof body === 'object') {
      body = JSON.stringify(body)
      if (!Object.keys(headers).some(k => k.toLowerCase() === 'content-type')) {
        headers['Content-Type'] = 'application/json'
      }
    }
    const res = await fetch(url, {
      method: (config.method ?? 'get').toUpperCase(),
      headers,
      ...(body !== undefined && body !== null ? { body } : {}),
    })
    const text = await res.text()
    let data = text
    if ((config.responseType ?? 'json') === 'json') {
      try { data = text ? JSON.parse(text) : null } catch { /* 保持文本 */ }
    }
    const response = { status: res.status, headers: Object.fromEntries(res.headers), data, config }
    const validate = config.validateStatus === undefined
      ? (s) => s >= 200 && s < 300
      : config.validateStatus
    if (validate && !validate(res.status)) {
      const err = new Error(`Request failed with status code ${res.status}`)
      err.isAxiosError = true
      err.response = response
      throw err
    }
    return response
  }
  return {
    request,
    get: (url, config = {}) => request({ ...config, url, method: 'get' }),
    post: (url, data, config = {}) => request({ ...config, url, data, method: 'post' }),
    isAxiosError: (e) => !!e?.isAxiosError,
  }
}

// big-integer 的 shim 在沙箱里有 TS 实现；Node 测试骨架用等价的 BigInt 实现顶上
export function makeBigIntegerShim() {
  const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz'
  function parse(value, base) {
    const negative = value.startsWith('-')
    const digits = negative ? value.slice(1) : value
    let result = 0n
    for (const ch of digits.toLowerCase()) {
      const d = DIGITS.indexOf(ch)
      if (d < 0 || d >= base) throw new Error(`bigInt: invalid digit "${ch}" for base ${base}`)
      result = result * BigInt(base) + BigInt(d)
    }
    return negative ? -result : result
  }
  function wrap(value) {
    return {
      value,
      modPow(exponent, modulus) {
        const m = typeof modulus === 'object' ? modulus.value : parse(String(modulus), 10)
        const e = typeof exponent === 'object' ? exponent.value : parse(String(exponent), 10)
        let base = ((value % m) + m) % m
        let exp = e
        let result = 1n
        while (exp > 0n) {
          if (exp & 1n) result = (result * base) % m
          base = (base * base) % m
          exp >>= 1n
        }
        return wrap(result)
      },
      toString(radix = 10) {
        if (radix === 10) return value.toString()
        let rest = value < 0n ? -value : value
        let out = ''
        while (rest > 0n) {
          out = DIGITS[Number(rest % BigInt(radix))] + out
          rest /= BigInt(radix)
        }
        return (value < 0n ? '-' : '') + (out || '0')
      },
      plus(o) { return wrap(value + toBig(o)) },
      minus(o) { return wrap(value - toBig(o)) },
      times(o) { return wrap(value * toBig(o)) },
      compareTo(o) { const x = toBig(o); return value < x ? -1 : value === x ? 0 : 1 },
    }
  }
  function toBig(v) {
    if (typeof v === 'object' && v && 'value' in v) return v.value
    if (typeof v === 'number') return BigInt(v)
    return parse(String(v), 10)
  }
  return function bigInt(value, base = 10) {
    return wrap(typeof value === 'number' ? BigInt(value) : parse(String(value), base))
  }
}

/**
 * 加载一个插件目录：返回 { manifest, plugin, env }。
 * env.storage 是内存 KV；credentials 可注入。
 */
export function loadPlugin(pluginDir, { credentials = null } = {}) {
  const code = readFileSync(path.join(pluginDir, 'index.js'), 'utf8')
  const manifest = JSON.parse(readFileSync(path.join(pluginDir, 'manifest.json'), 'utf8'))

  const storageMap = new Map()
  const env = {
    appVersion: '1.10.0-test',
    locale: 'zh-CN',
    platform: 'web',
    userVariables: {},
    credentials,
    setCredentials(next) { env.credentials = next },
    storage: {
      get: async (key) => storageMap.get(key) ?? null,
      set: async (key, value) => { storageMap.set(key, value) },
    },
  }

  const bigInt = makeBigIntegerShim()
  const module = { exports: {} }
  const requireShim = function (name) {
    if (name === 'axios') return makeAxios()
    if (name === 'big-integer') return bigInt
    if (name === 'cheerio') throw new Error('cheerio is not available in the sandbox; use DOMParser')
    if (['crypto-js', 'dayjs', 'qs', 'he'].includes(name)) return frontendRequire(name)
    throw new Error(`Unknown module in sandbox: ${name}`)
  }

  // 与沙箱运行时同一个工厂签名（Node 测试骨架专用；沙箱里走 blob 脚本）
  const factory = new Function('module', 'exports', 'require', 'env', 'console', code)
  factory(module, module.exports, requireShim, env, console)

  return { manifest, plugin: module.exports, env, storageMap }
}
