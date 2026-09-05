/**
 * @vitest-environment happy-dom
 *
 * 断开 / 移除音源时播放队列的归属（B2）。
 *
 * 钉的是一条：**断开一个音源只带走它自己的歌**。
 * 原来这里两头都错——断开插件源什么都不做（它的歌卡在队列里，播到就静默停住），
 * 断开主库却 resetForServerChange（把别的源的歌一起清掉）。
 */

import { beforeEach, describe, expect, it } from 'vitest'
import type { MusicServerAdapter, ServerConfig, Song } from '@/api/types'
import { clearAdapter, hasAdapterFor, registerAdapter, setPrimary } from '@/api'
import { usePlayerStore } from '@/store/playerStore'
import { useServerStore } from '@/store/serverStore'

const NAS = 'nas'
const WY = 'wy'

function server(id: string, type: ServerConfig['type'] = 'subsonic'): ServerConfig {
  return { id, name: id, type, url: '', username: '', token: '', isActive: false, createdAt: 0 }
}

function song(id: string, serverId: string): Song {
  return { id, title: `Song ${id}`, artist: 'Artist', album: 'Album', duration: 200, serverId }
}

function stubAdapter(): MusicServerAdapter {
  return { type: 'subsonic' } as unknown as MusicServerAdapter
}

/** 两个源都连着，主库是 NAS；队列交替混源 */
function connectBothWithMixedQueue(currentIndex: number) {
  registerAdapter(NAS, stubAdapter())
  registerAdapter(WY, stubAdapter())
  setPrimary(NAS)
  useServerStore.setState({
    servers: [server(NAS), server(WY, 'plugin')],
    connectedServerIds: [NAS, WY],
    compromisedServerIds: [],
    activeServerId: NAS,
    isConnected: true,
    username: 'niko',
    avatarUrl: null,
  })
  const queue = [song('a', NAS), song('b', WY), song('c', NAS), song('d', WY)]
  usePlayerStore.setState({
    queue,
    queueIndex: currentIndex,
    currentSong: queue[currentIndex],
    isPlaying: true,
    shuffle: false,
    shuffledIndexes: queue.map((_, i) => i),
    shuffleCursor: -1,
    history: [song('h', WY)],
  })
}

beforeEach(() => {
  clearAdapter()
  usePlayerStore.setState({
    queue: [], queueIndex: -1, currentSong: null, isPlaying: false,
    shuffle: false, shuffledIndexes: [], shuffleCursor: -1, history: [],
  })
})

describe('disconnectServer', () => {
  it('只把被断源的歌从队列里摘掉，别的源继续放', () => {
    connectBothWithMixedQueue(0)

    useServerStore.getState().disconnectServer(WY)

    expect(usePlayerStore.getState().queue.map(s => s.id)).toEqual(['a', 'c'])
    expect(usePlayerStore.getState().currentSong?.id).toBe('a')
    expect(usePlayerStore.getState().isPlaying).toBe(true)
    expect(hasAdapterFor(WY)).toBe(false)
    expect(useServerStore.getState().connectedServerIds).toEqual([NAS])
  })

  it('正在放被断源的歌时前进到下一首，而不是把队列卡在那儿', () => {
    connectBothWithMixedQueue(1) // 当前是 b（网易云）

    useServerStore.getState().disconnectServer(WY)

    expect(usePlayerStore.getState().currentSong?.id).toBe('c')
    expect(usePlayerStore.getState().isPlaying).toBe(true)
  })

  it('断开主库不清空别的源的歌——混源队列不该被连坐', () => {
    connectBothWithMixedQueue(1)

    useServerStore.getState().disconnectServer(NAS)

    expect(usePlayerStore.getState().queue.map(s => s.id)).toEqual(['b', 'd'])
    // 主库让位，但插件源的队列还在放
    expect(useServerStore.getState().activeServerId).toBeNull()
    expect(useServerStore.getState().isConnected).toBe(false)
    expect(usePlayerStore.getState().currentSong?.id).toBe('b')
  })

  it('历史里被断源的曲目一并清掉', () => {
    connectBothWithMixedQueue(0)

    useServerStore.getState().disconnectServer(WY)

    expect(usePlayerStore.getState().history).toEqual([])
  })
})

describe('removeServer', () => {
  it('删掉一个音源时它的歌离开队列，配置也一并移除', () => {
    connectBothWithMixedQueue(0)

    useServerStore.getState().removeServer(WY)

    expect(usePlayerStore.getState().queue.map(s => s.id)).toEqual(['a', 'c'])
    expect(useServerStore.getState().servers.map(s => s.id)).toEqual([NAS])
    expect(useServerStore.getState().connectedServerIds).toEqual([NAS])
  })

  it('删掉主库时别的源的歌留着，主库让位', () => {
    connectBothWithMixedQueue(1)

    useServerStore.getState().removeServer(NAS)

    expect(usePlayerStore.getState().queue.map(s => s.id)).toEqual(['b', 'd'])
    expect(useServerStore.getState().activeServerId).toBeNull()
  })
})

describe('markServerCompromised', () => {
  it('复用 disconnectServer：队列同样按来源裁剪，并留下停用标记', () => {
    connectBothWithMixedQueue(1)

    useServerStore.getState().markServerCompromised(WY, '沙箱自导航')

    expect(usePlayerStore.getState().queue.map(s => s.id)).toEqual(['a', 'c'])
    expect(useServerStore.getState().compromisedServerIds).toContain(WY)
    expect(hasAdapterFor(WY)).toBe(false)
  })
})
