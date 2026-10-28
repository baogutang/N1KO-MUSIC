/**
 * @vitest-environment happy-dom
 *
 * 耳机断开的判断只看输出设备的数量，所以它自己得防误判（「播着播着自己暂停」的嫌疑之一）：
 * 数到变少要隔一会儿再数一遍确认；页面在后台时不据此停歌。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }))

import { useAudioInterruptions } from './useAudioInterruptions'
import { usePlayerStore } from '@/store/playerStore'
import { getPauseRecords, readPauseContext, recordPause, resetPauseTrailForTests } from '@/lib/playbackTrail'

function Probe() {
  useAudioInterruptions()
  return null
}

let root: Root | null = null
let unsubscribe: (() => void) | null = null
let counts: number[] = []
let onDeviceChange: (() => void) | null = null
let visibility: DocumentVisibilityState = 'visible'

function outputs(n: number) {
  return Array.from({ length: n }, (_, i) => ({ kind: 'audiooutput', deviceId: `d${i}`, label: '' }))
}

const flush = () => act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve() })
const wait = (ms: number) => act(async () => { await new Promise(r => setTimeout(r, ms)) })

beforeEach(() => {
  counts = [2]
  visibility = 'visible'
  resetPauseTrailForTests()
  Object.defineProperty(document, 'visibilityState', { get: () => visibility, configurable: true })
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      // 每数一次取下一个值，取完就一直是最后那个
      enumerateDevices: async () => outputs(counts.length > 1 ? counts.shift()! : counts[0]),
      addEventListener: (_: string, cb: () => void) => { onDeviceChange = cb },
      removeEventListener: () => { onDeviceChange = null },
    },
  })
  usePlayerStore.setState({
    currentSong: { id: 's1', title: 'T', artist: 'A', album: 'AL', duration: 200, serverId: 'srv' },
    isPlaying: true,
  } as never)
  // 和 useAudioEngine 里一样：isPlaying 由真变假时把留下的原因记下来
  unsubscribe = usePlayerStore.subscribe((state, prev) => {
    if (prev.isPlaying && !state.isPlaying) recordPause(readPauseContext(new Audio()))
  })
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  unsubscribe?.()
  act(() => { root?.unmount() })
  root = null
  document.body.innerHTML = ''
})

async function mount() {
  act(() => { root!.render(<Probe />) })
  await flush()
}

describe('耳机断开的判断', () => {
  it('数到变少、隔一会儿再数还是少：停下，并记成「耳机断开」', { timeout: 10_000 }, async () => {
    await mount()
    counts = [1, 1]
    act(() => { onDeviceChange?.() })
    await wait(700)
    expect(usePlayerStore.getState().isPlaying).toBe(false)
    expect(getPauseRecords().at(-1)?.reason).toBe('device')
  })

  it('只是切换时抖了一下（再数又回来了）：不停', { timeout: 10_000 }, async () => {
    await mount()
    counts = [1, 2]
    act(() => { onDeviceChange?.() })
    await wait(700)
    expect(usePlayerStore.getState().isPlaying).toBe(true)
  })

  it('页面在后台（锁屏 / 切走）：设备列表不作数，不停', { timeout: 10_000 }, async () => {
    await mount()
    visibility = 'hidden'
    counts = [0, 0]
    act(() => { onDeviceChange?.() })
    await wait(700)
    expect(usePlayerStore.getState().isPlaying).toBe(true)
  })
})
