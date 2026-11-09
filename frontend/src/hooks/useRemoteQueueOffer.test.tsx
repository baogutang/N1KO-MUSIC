/**
 * @vitest-environment happy-dom
 *
 * 「从别处继续」接受后会在随后约 2 秒里反复定位到上次的位置。
 * 这期间用户换了歌，定位就不该再落到新歌上（原来新歌会被拽到 3 分多钟处）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

const { seekHowl, getPlayQueue } = vi.hoisted(() => ({
  seekHowl: vi.fn(),
  getPlayQueue: vi.fn(),
}))
vi.mock('@/hooks/useAudioEngine', () => ({
  seekHowl,
  getAudioCurrentTime: () => 0,
}))
vi.mock('@/api', () => ({
  getAdapter: () => ({ getPlayQueue }),
  hasAdapter: () => true,
}))

import { useRemoteQueueOffer } from './useQueueSync'
import { usePlayerStore } from '@/store/playerStore'
import { useServerStore } from '@/store/serverStore'
import type { Song } from '@/api/types'

const song = (id: string): Song => ({ id, title: `歌${id}`, artist: 'A', album: 'AL', duration: 300, serverId: 'nas' })

let root: Root | null = null
let offer: ReturnType<typeof useRemoteQueueOffer> | null = null
function Probe() {
  offer = useRemoteQueueOffer()
  return null
}

beforeEach(() => {
  vi.useFakeTimers()
  getPlayQueue.mockResolvedValue({ songs: [song('r1'), song('r2'), song('r3')], currentId: 'r1', positionMs: 200_000 })
  usePlayerStore.setState({ currentSong: null, queue: [], queueIndex: -1, isPlaying: false, history: [] } as never)
  useServerStore.setState({ isConnected: true, activeServerId: 'nas' } as never)
})
afterEach(() => {
  act(() => { root?.unmount() })
  root = null
  offer = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('从别处继续：接受后的定位', () => {
  it('定到上次的位置', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => { root!.render(<Probe />) })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(offer?.offer).not.toBeNull()

    act(() => { offer!.accept() })
    await act(async () => { await vi.advanceTimersByTimeAsync(400) })

    expect(seekHowl).toHaveBeenCalledWith(200)
  })

  it('定位重试期间换了歌：不再定到新歌上', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => { root!.render(<Probe />) })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })

    act(() => { offer!.accept() })
    await act(async () => { await vi.advanceTimersByTimeAsync(400) })
    seekHowl.mockClear()

    vi.setSystemTime(Date.now() + 100)
    act(() => { usePlayerStore.getState().next() })
    await act(async () => { await vi.advanceTimersByTimeAsync(2500) })

    expect(usePlayerStore.getState().currentSong?.id).toBe('r2')
    expect(seekHowl).not.toHaveBeenCalled()
  })
})
