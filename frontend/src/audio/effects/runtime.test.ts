/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/platform', () => ({ isNativePlatform: false, nativeOS: 'web' }))

import { corsVerdict, probeCors, resetFxRuntimeForTests, routeFx, getFxStatus, fxWanted } from './runtime'
import { useSettingsStore } from '@/store/settingsStore'

const realLoad = HTMLMediaElement.prototype.load
let probes: HTMLMediaElement[] = []

beforeEach(() => {
  probes = []
  HTMLMediaElement.prototype.load = function (this: HTMLMediaElement) {
    if (this.getAttribute('src')) probes.push(this)
  }
  resetFxRuntimeForTests()
  useSettingsStore.setState({ fxEnabled: false })
})

afterEach(() => {
  HTMLMediaElement.prototype.load = realLoad
  vi.useRealTimers()
})

describe('跨域许可（每个源站问一次）', () => {
  it('同源、blob:、data: 不用问', () => {
    expect(corsVerdict(new URL('/stream/1', location.href).href)).toBe(true)
    expect(corsVerdict('blob:https://app.test/abc')).toBe(true)
    expect(corsVerdict('data:audio/wav;base64,AAAA')).toBe(true)
  })

  it('没问过的源站是「不知道」', () => {
    expect(corsVerdict('https://nas.test/rest/stream?id=1')).toBeNull()
  })

  it('加载得出元数据 = 允许；结果按源站记住，同站的别的地址不再问', async () => {
    const asked = probeCors('https://nas.test/rest/stream?id=1')
    expect(probes).toHaveLength(1)
    expect(probes[0].crossOrigin).toBe('anonymous')
    probes[0].dispatchEvent(new Event('loadedmetadata'))
    expect(await asked).toBe(true)
    expect(probes[0].hasAttribute('src'), '问完就放手，不把整首拉下来').toBe(false)

    expect(corsVerdict('https://nas.test/rest/stream?id=2')).toBe(true)
    expect(await probeCors('https://nas.test/rest/stream?id=2')).toBe(true)
    expect(probes).toHaveLength(1)
  })

  it('报错 = 不允许；过十分钟再重问（服务器配置可能改了）', async () => {
    const asked = probeCors('https://cdn.test/a.mp3')
    probes[0].dispatchEvent(new Event('error'))
    expect(await asked).toBe(false)
    expect(corsVerdict('https://cdn.test/b.mp3')).toBe(false)
    expect(corsVerdict('https://cdn.test/b.mp3', Date.now() + 11 * 60 * 1000)).toBeNull()
  })

  it('同一个源站同时问两次只发一次', async () => {
    const first = probeCors('https://nas.test/a')
    const second = probeCors('https://nas.test/b')
    expect(probes).toHaveLength(1)
    probes[0].dispatchEvent(new Event('loadedmetadata'))
    expect(await Promise.all([first, second])).toEqual([true, true])
  })

  it('超时不下结论，也不记', async () => {
    vi.useFakeTimers()
    const asked = probeCors('https://slow.test/a')
    await vi.advanceTimersByTimeAsync(6100)
    expect(await asked).toBeNull()
    expect(corsVerdict('https://slow.test/a')).toBeNull()
  })
})

describe('路由判断', () => {
  it('音效没开：不走处理链，状态是 off', () => {
    expect(fxWanted()).toBe(false)
    expect(routeFx('https://nas.test/a')).toBe(false)
    expect(getFxStatus()).toBe('off')
  })

  it('开着但这个环境没有 Web Audio：不走处理链，状态是 unsupported', () => {
    useSettingsStore.setState({ fxEnabled: true })
    // happy-dom 没有 AudioContext
    expect(fxWanted()).toBe(false)
    expect(routeFx('https://nas.test/a')).toBe(false)
    expect(getFxStatus()).toBe('unsupported')
  })
})
