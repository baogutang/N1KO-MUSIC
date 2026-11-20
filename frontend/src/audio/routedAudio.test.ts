/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fx = vi.hoisted(() => ({
  route: false,
  element: null as HTMLAudioElement | null,
  volume: [] as number[],
  resumed: 0,
}))
vi.mock('./effects/runtime', () => ({
  routeFx: () => fx.route,
  ensureFxElement: () => (fx.element ? { element: fx.element, graph: {} } : null),
  setFxVolume: (v: number) => { fx.volume.push(v) },
  resumeFx: () => { fx.resumed += 1 },
}))

import { RoutedAudio } from './routedAudio'

const realPlay = HTMLMediaElement.prototype.play
const realPause = HTMLMediaElement.prototype.pause
const realLoad = HTMLMediaElement.prototype.load
let played: HTMLMediaElement[] = []
let loaded: HTMLMediaElement[] = []

beforeEach(() => {
  played = []
  loaded = []
  HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) { played.push(this); return Promise.resolve() }
  HTMLMediaElement.prototype.pause = function () { /* noop */ }
  HTMLMediaElement.prototype.load = function (this: HTMLMediaElement) { loaded.push(this) }
  fx.route = false
  fx.element = new Audio()
  fx.volume = []
  fx.resumed = 0
})

afterEach(() => {
  HTMLMediaElement.prototype.play = realPlay
  HTMLMediaElement.prototype.pause = realPause
  HTMLMediaElement.prototype.load = realLoad
})

/** 包装层里实际被用到的那个元素：靠 play() 落在谁身上认 */
async function activeElement(audio: RoutedAudio) {
  played = []
  await audio.play()
  return played[0]
}

describe('RoutedAudio', () => {
  it('音效没开：就是原来那个 <audio>，带处理链的元素碰都不碰', async () => {
    const audio = new RoutedAudio()
    audio.src = 'https://nas.test/a.flac'
    audio.volume = 0.4
    const el = await activeElement(audio)
    expect(el).not.toBe(fx.element)
    expect(el.getAttribute('src')).toBe('https://nas.test/a.flac')
    expect(el.volume).toBeCloseTo(0.4)
    expect(audio.volume).toBeCloseTo(0.4)
    expect(fx.element!.hasAttribute('src')).toBe(false)
    expect(fx.volume).toEqual([])
    expect(fx.resumed).toBe(0)
  })

  it('这条流能过处理链：改用带处理链的元素，音量交给处理链，元素自己保持满格', async () => {
    const audio = new RoutedAudio()
    audio.volume = 0.3
    fx.route = true
    audio.src = 'https://nas.test/a.flac'
    const el = await activeElement(audio)
    expect(el).toBe(fx.element)
    expect(fx.element!.volume).toBe(1)
    expect(fx.volume.at(-1)).toBeCloseTo(0.3)
    expect(audio.volume).toBeCloseTo(0.3)
    expect(fx.resumed, 'play() 顺手把音频上下文叫起来').toBe(1)

    audio.volume = 0.8
    expect(fx.volume.at(-1)).toBeCloseTo(0.8)
    expect(fx.element!.volume).toBe(1)
  })

  it('换元素时旧的放手（清掉源），倍速这些带过去', async () => {
    const audio = new RoutedAudio()
    audio.src = 'https://nas.test/a.flac'
    const plain = await activeElement(audio)
    audio.defaultPlaybackRate = 1.5
    audio.playbackRate = 1.5
    audio.preload = 'auto'

    fx.route = true
    loaded = []
    audio.src = 'https://nas.test/b.flac'
    expect(plain.hasAttribute('src'), '旧元素的源清掉').toBe(false)
    expect(loaded, '旧元素 load() 一次，把连接放掉').toContain(plain)
    expect(fx.element!.getAttribute('src')).toBe('https://nas.test/b.flac')
    expect(fx.element!.playbackRate).toBe(1.5)
    expect(fx.element!.defaultPlaybackRate).toBe(1.5)

    // 下一首的服务器不允许跨域读取：换回不接处理链的元素
    fx.route = false
    audio.volume = 0.5
    audio.src = 'https://other.test/c.mp3'
    expect(fx.element!.hasAttribute('src')).toBe(false)
    expect(await activeElement(audio)).toBe(plain)
    expect(plain.volume).toBeCloseTo(0.5)
  })

  it('只转发当前元素的事件', () => {
    const audio = new RoutedAudio()
    audio.src = 'https://nas.test/a.flac'
    fx.route = true
    audio.src = 'https://nas.test/b.flac'
    const seen: string[] = []
    for (const type of ['play', 'pause', 'ended', 'error', 'canplay', 'timeupdate']) {
      audio.addEventListener(type, () => seen.push(type))
    }
    fx.element!.dispatchEvent(new Event('canplay'))
    fx.element!.dispatchEvent(new Event('play'))
    expect(seen).toEqual(['canplay', 'play'])
  })

  it('旧元素放手时排着的事件不再转发（否则会被当成「被系统暂停了」）', async () => {
    const audio = new RoutedAudio()
    audio.src = 'https://nas.test/a.flac'
    const plain = await activeElement(audio)
    fx.route = true
    audio.src = 'https://nas.test/b.flac'
    const seen: string[] = []
    audio.addEventListener('pause', () => seen.push('pause'))
    audio.addEventListener('emptied', () => seen.push('emptied'))
    plain.dispatchEvent(new Event('pause'))
    plain.dispatchEvent(new Event('emptied'))
    expect(seen).toEqual([])
  })

  it('处理链建不出来：照旧用原来的元素', async () => {
    fx.element = null
    fx.route = true
    const audio = new RoutedAudio()
    audio.src = 'https://nas.test/a.flac'
    const el = await activeElement(audio)
    expect(el.getAttribute('src')).toBe('https://nas.test/a.flac')
  })

  it('清空源（removeAttribute + load）落在当前元素上', async () => {
    const audio = new RoutedAudio()
    fx.route = true
    audio.src = 'https://nas.test/a.flac'
    audio.removeAttribute('src')
    audio.load()
    expect(fx.element!.hasAttribute('src')).toBe(false)
    expect(audio.getAttribute('src')).toBeNull()
  })
})
