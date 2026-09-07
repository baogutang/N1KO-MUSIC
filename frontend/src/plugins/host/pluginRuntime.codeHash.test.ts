/**
 * @vitest-environment happy-dom
 *
 * 插件更新后必须换掉在跑的沙箱：只比凭据的话，设置页显示「已更新」而执行的
 * 还是旧代码，要重启 App 才生效（2026-09-07 审阅 F04）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PluginManifest } from '../types'

const manifest: PluginManifest = {
  id: 'mock', name: 'Mock', version: '0.1.0', protocol: 1, platform: 'mock',
  entry: 'index.js', auth: { kind: 'qr' }, hosts: ['music.163.com'],
  capabilities: ['search'], disclaimer: 'x',
}

const installed = vi.hoisted(() => ({ code: 'v1', codeHash: 'hash-v1' }))
vi.mock('./pluginStore', () => ({
  usePluginStore: {
    getState: () => ({
      getInstalled: async () => ({ id: 'mock', manifest, code: installed.code, codeHash: installed.codeHash }),
    }),
  },
}))

const { ensurePluginHost } = await import('./pluginRuntime')

/** 等一个**新的** iframe 出现再回 ready：重建时旧的会被拆掉，不能认旧那个 */
async function answerReady(previous?: HTMLIFrameElement): Promise<HTMLIFrameElement> {
  let iframe: HTMLIFrameElement | null = null
  for (let i = 0; i < 400; i++) {
    const found = [...document.querySelectorAll('iframe')].find(f => f !== previous)
    if (found) { iframe = found as HTMLIFrameElement; break }
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  if (!iframe) throw new Error('sandbox iframe never appeared')
  window.dispatchEvent(new MessageEvent('message', {
    data: { type: 'ready', methods: ['search'] }, source: iframe.contentWindow,
  }))
  return iframe
}

/** 每个用例用独立 serverId：liveHosts 是模块级的，共用 id 会把上一个用例的沙箱复用过来 */
let seq = 0
const configFor = (id: string) => ({
  id, type: 'plugin' as const, pluginId: 'mock', name: 'Mock',
  url: '', username: '', token: '', credentials: 'SAME', isActive: true, createdAt: 0,
})

beforeEach(() => {
  installed.code = 'v1'
  installed.codeHash = 'hash-v1'
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  document.querySelectorAll('iframe').forEach(f => f.remove())
  vi.restoreAllMocks()
})

describe('ensurePluginHost 的沙箱身份', () => {
  it('代码没变、凭据没变 → 复用同一个沙箱', async () => {
    const config = configFor(`srv-reuse-${++seq}`)
    const first = ensurePluginHost(config)
    await answerReady()
    const a = await first
    expect(await ensurePluginHost(config)).toBe(a)
  })

  it('插件更新（代码哈希变了）→ 即使凭据没变也不复用旧沙箱', async () => {
    const config = configFor(`srv-rebuild-${++seq}`)
    const first = ensurePluginHost(config)
    await answerReady()
    await first

    installed.code = 'v2'
    installed.codeHash = 'hash-v2'
    /*
     * 复用的话会**立刻**兑现（同步返回已在跑的 host）；重建则要等新沙箱 ready。
     * 这里不喂 ready，因此「一直悬着」本身就是「没有复用旧的」的证据——
     * 比去比较两个实例更稳，不依赖 happy-dom 的 iframe 时序。
     */
    const second = ensurePluginHost(config)
    second.catch(() => { /* 本用例不喂 ready，最终会超时失败，与断言无关 */ })
    const settled = await Promise.race([
      second.then(() => 'reused'),
      new Promise<string>(resolve => setTimeout(() => resolve('rebuilding'), 40)),
    ])
    expect(settled).toBe('rebuilding')
  })
})
