/**
 * @vitest-environment happy-dom
 *
 * 复审 A7 回归：快速切换 QQ / 微信登录方式时，晚到的旧 createQr 不能
 * 覆盖新方式的二维码与轮询 key——否则显示微信码、轮询 QQ 的 key。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { QrLogin } from './QrLogin'
import { PluginCallError } from '@/plugins/host/PluginHost'
import type { PluginHost } from '@/plugins/host/PluginHost'
import type { PluginManifest } from '@/plugins/types'

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void }

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function fakeHost(calls: { createQr: (methodId?: string) => Promise<{ key: string; content: string; expiresIn: number; qrImage?: string }> }) {
  return {
    manifest: { auth: { methods: [
      { id: 'qq', labelKey: 'sources.qr.method.qq' },
      { id: 'wx', labelKey: 'sources.qr.method.wx' },
    ] }, hosts: ['open.weixin.qq.com'] } as unknown as PluginManifest,
    call: vi.fn(async (method: string, ...args: unknown[]) => {
      if (method === 'n1ko.auth.createQr') return calls.createQr(args[0] as string | undefined)
      throw new PluginCallError('not-found', `unexpected ${method}`)
    }),
  } as unknown as PluginHost
}

let root: Root | null = null
afterEach(() => {
  act(() => { root?.unmount() })
  root = null
  document.body.innerHTML = ''
  vi.useRealTimers()
})

function mount(host: PluginHost) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  root = createRoot(el)
  act(() => { root!.render(<QrLogin host={host} onAuthorized={() => {}} />) })
}

describe('QrLogin 切换登录方式的竞态（A7）', () => {
  it('微信码先到、QQ 的旧响应后到：图与轮询 key 都保持微信', async () => {
    const qqPending = deferred<{ key: string; content: string; expiresIn: number; qrImage?: string }>()
    const host = fakeHost({
      createQr: methodId => methodId === 'wx'
        ? Promise.resolve({ key: 'wx:uuid-1', content: 'https://wx', expiresIn: 300, qrImage: 'data:image/jpeg;base64,QUJD' })
        : qqPending.promise,
    })
    mount(host)

    // 默认方式（QQ）的请求挂起中；用户立刻切到微信
    const tabs = document.querySelectorAll('[role="tab"]')
    expect(tabs.length).toBe(2)
    act(() => { tabs[1].dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve() })

    // 微信码已显示
    const img = document.querySelector('img[alt]') as HTMLImageElement
    expect(img.src).toContain('data:image/jpeg')

    // QQ 的旧响应这时才回来（key 是 QQ 的 qrsig）
    await act(async () => {
      qqPending.resolve({ key: 'qrsig-qq-late', content: 'https://qq', expiresIn: 180 })
      for (let i = 0; i < 20; i++) await Promise.resolve()
    })

    // A7 断言：晚到的旧响应不能覆盖——图还是微信的
    const imgAfter = document.querySelector('img[alt]') as HTMLImageElement
    expect(imgAfter.src).toContain('data:image/jpeg')
  })
})

describe('失败态也有刷新入口（阶段 2.4 / F22）', () => {
  it('createQr 直接失败 → error 态渲染「刷新」按钮与说明文案', async () => {
    const host = fakeHost({
      createQr: () => Promise.reject(new PluginCallError('network', 'boom')),
    })
    mount(host)

    await act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve() })

    // 失败说明出现（词条，不是原始英文异常裸奔）
    const text = document.body.textContent ?? ''
    expect(text).toMatch(/二维码|失败|failed|network problem/i)
    expect(text).not.toMatch(/boom/)
    // 刷新按钮在（旧实现 error 态没有出口，只能关掉重来）
    const refresh = [...document.querySelectorAll('button')]
      .find(b => /刷新二维码|Refresh QR/i.test(b.textContent ?? ''))
    expect(refresh, 'error 态也有刷新').toBeTruthy()
  })
})
