/**
 * @vitest-environment happy-dom
 *
 * 沙箱里的 WebRTC 必须在插件代码执行之前就被拿掉（2026-11-12 加固）。
 *
 * 沙箱文档的 CSP `connect-src 'none'` 管不到 WebRTC：RTCPeerConnection 的 ICE 收集
 * 与数据通道能绕开宿主的 hosts 白名单往外发数据。这里走真实入口 startWindowRuntime
 * （沙箱脚本加载时的第一站，早于任何 init），看全局上那几个构造器还在不在。
 */

import { afterEach, describe, expect, it } from 'vitest'
import { disableWebRTC, startWindowRuntime, WEBRTC_GLOBALS } from './runtime'

const scope = window as unknown as Record<string, unknown>

afterEach(() => {
  for (const name of WEBRTC_GLOBALS) {
    try {
      delete scope[name]
    } catch {
      // 不可配置的那条留着无妨：每个用例都会重新定义要用的名字
    }
  }
})

/** 装一个假的 WebRTC 构造器（happy-dom 本身没有） */
function plant(name: string, descriptor: PropertyDescriptor = {}): void {
  Object.defineProperty(scope, name, {
    value: class FakeRTC {},
    writable: true,
    configurable: true,
    ...descriptor,
  })
}

describe('沙箱入口拿掉 WebRTC', () => {
  it('startWindowRuntime 之后五个构造器都不在全局上', () => {
    for (const name of WEBRTC_GLOBALS) plant(name)
    startWindowRuntime()
    for (const name of WEBRTC_GLOBALS) {
      expect(scope[name], name).toBeUndefined()
      expect(name in scope, name).toBe(false)
    }
  })

  it('删不掉的（不可配置）覆盖成 undefined', () => {
    // 用一个不会和其它用例共享的作用域，免得不可配置属性残留
    const isolated: Record<string, unknown> = {}
    Object.defineProperty(isolated, 'RTCPeerConnection', { value: class FakeRTC {}, writable: true, configurable: false })
    Object.defineProperty(isolated, 'RTCDataChannel', { value: class FakeRTC {}, writable: true, configurable: true })
    disableWebRTC(isolated)
    expect(isolated.RTCPeerConnection).toBeUndefined()
    expect('RTCDataChannel' in isolated).toBe(false)
  })

  it('本来就没有的不去凭空定义', () => {
    const isolated: Record<string, unknown> = {}
    disableWebRTC(isolated)
    for (const name of WEBRTC_GLOBALS) expect(name in isolated, name).toBe(false)
  })
})
