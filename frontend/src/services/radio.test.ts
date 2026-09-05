/**
 * 电台的音源归属（K1 / B1）。
 *
 * 钉两条：
 *  - **能不能起电台，只由种子自己那个音源说了算**：回落主库会让入口在一个
 *    根本做不到的源上亮起来，点下去空手而归；
 *  - **续上来的候选保留自己的 serverId**：盖成主库 id 之后，播放引擎会拿
 *    主库适配器去取一个外源的曲目 id，必然失败。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MusicServerAdapter, Song } from '@/api/types'
import { clearAdapter, registerAdapter, setPrimary } from '@/api'
import { usePlayerStore } from '@/store/playerStore'
import { canStartRadio, refillRadio } from './radio'

// 排序只关心「谁被选中」，历史与静音表是外部存储，测试里给空即可
vi.mock('@/services/listeningHistory', () => ({ readListeningEvents: () => [] }))
vi.mock('@/store/tasteStore', () => ({
  readMutedSets: () => ({ artists: new Set<string>(), genres: new Set<string>() }),
}))

/** 只挂被测方法的最小适配器替身 */
function stub(methods: Partial<MusicServerAdapter>): MusicServerAdapter {
  return { type: 'subsonic', ...methods } as unknown as MusicServerAdapter
}

const NAS = 'nas'
const WY = 'wy'

/** 主库（NAS）三种电台能力齐全；网易云一种都没有 */
function connectBoth() {
  registerAdapter(NAS, stub({
    getSimilarSongs: async () => [],
    getArtistSongs: async () => [],
    getGenreSongs: async () => [],
  }))
  registerAdapter(WY, stub({}))
  setPrimary(NAS)
}

afterEach(() => {
  clearAdapter()
})

describe('canStartRadio', () => {
  it('种子源自己有这个能力 → 可以起', () => {
    connectBoth()
    expect(canStartRadio({ kind: 'song', id: 's1', serverId: NAS })).toBe(true)
    expect(canStartRadio({ kind: 'artist', name: 'A', serverId: NAS })).toBe(true)
    expect(canStartRadio({ kind: 'genre', name: 'Jazz', serverId: NAS })).toBe(true)
  })

  it('种子源没有能力时，主库有也不算数——这正是入口亮着却起不来的那个 bug', () => {
    connectBoth()
    expect(canStartRadio({ kind: 'song', id: 'w1', serverId: WY })).toBe(false)
    expect(canStartRadio({ kind: 'artist', name: 'A', serverId: WY })).toBe(false)
    expect(canStartRadio({ kind: 'genre', name: 'Jazz', serverId: WY })).toBe(false)
  })

  it('种子源已断开 → false，不拿主库顶替（顶替出来的是另一个库的歌）', () => {
    connectBoth()
    expect(canStartRadio({ kind: 'song', id: 'x', serverId: 'gone' })).toBe(false)
  })

  it('种子没带 serverId 才回落主库：旧的单源调用方语义不变', () => {
    connectBoth()
    expect(canStartRadio({ kind: 'song', id: 's1' })).toBe(true)
  })

  it('一个源都没连时一律 false', () => {
    expect(canStartRadio({ kind: 'song', id: 's1' })).toBe(false)
  })
})

// ===================================================
// B1：自动续播不改候选的来源
// ===================================================

function song(id: string, serverId: string, artist = `Artist ${id}`): Song {
  return { id, title: `Song ${id}`, artist, album: 'Album', duration: 200, serverId }
}

/** 队列长到足以触发续播，且当前曲来自外源 */
function seedForeignQueue() {
  const queue = Array.from({ length: 3 }, (_, i) => song(`w${i}`, WY))
  usePlayerStore.setState({
    queue,
    queueIndex: 2,
    currentSong: queue[2],
    isPlaying: true,
    shuffle: false,
    shuffledIndexes: queue.map((_, i) => i),
    shuffleCursor: -1,
    history: [],
  })
}

describe('refillRadio 的候选来源', () => {
  it('外源候选入队后 serverId 不变，不会被盖成主库 id', async () => {
    // 主库是 NAS，当前放的是网易云的歌：候选由网易云给出
    registerAdapter(NAS, stub({ getSimilarSongs: async () => [] }))
    registerAdapter(WY, stub({
      getSimilarSongs: async () => [song('n1', WY), song('n2', WY), song('n3', WY)],
    }))
    setPrimary(NAS)
    seedForeignQueue()

    const added = await refillRadio()

    expect(added).toBeGreaterThan(0)
    const appended = usePlayerStore.getState().queue.slice(3)
    expect(appended.length).toBe(added)
    expect(appended.every(s => s.serverId === WY)).toBe(true)
    expect(appended.some(s => s.serverId === NAS)).toBe(false)
  })

  it('候选真的没带来源时，才补上当前曲的源（兜底而不是覆盖）', async () => {
    registerAdapter(WY, stub({
      // 老插件可能漏填 serverId：这时候兜底成当前曲的源，而不是主库
      getSimilarSongs: async () => [
        { ...song('x1', WY), serverId: '' } as Song,
        { ...song('x2', WY), serverId: '' } as Song,
      ],
    }))
    registerAdapter(NAS, stub({ getSimilarSongs: async () => [] }))
    setPrimary(NAS)
    seedForeignQueue()

    await refillRadio()

    const appended = usePlayerStore.getState().queue.slice(3)
    expect(appended.length).toBeGreaterThan(0)
    expect(appended.every(s => s.serverId === WY)).toBe(true)
  })

  it('候选来自主库时照旧标主库——单源行为不变', async () => {
    registerAdapter(NAS, stub({
      getSimilarSongs: async () => [song('a1', NAS), song('a2', NAS)],
    }))
    setPrimary(NAS)
    const queue = Array.from({ length: 3 }, (_, i) => song(`p${i}`, NAS))
    usePlayerStore.setState({
      queue, queueIndex: 2, currentSong: queue[2], isPlaying: true,
      shuffle: false, shuffledIndexes: queue.map((_, i) => i), shuffleCursor: -1, history: [],
    })

    await refillRadio()

    expect(usePlayerStore.getState().queue.slice(3).every(s => s.serverId === NAS)).toBe(true)
  })
})
