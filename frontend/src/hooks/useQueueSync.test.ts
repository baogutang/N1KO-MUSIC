/**
 * @vitest-environment happy-dom
 *
 * 跨设备续播在混源队列下写什么（B6）。
 *
 * savePlayQueue 存的是一串**主库自己的曲目 id**。混源之后，把别家的 id 写进去
 * 会让另一台设备恢复出「主库上碰巧同 id 的那首」——一首毫不相干的歌，
 * 而且看起来完全正常。
 */

import { describe, expect, it } from 'vitest'
import type { Song } from '@/api/types'
import { syncableQueueSlice } from './useQueueSync'

const NAS = 'nas'
const WY = 'wy'

function song(id: string, serverId: string): Song {
  return { id, title: `Song ${id}`, artist: 'Artist', album: 'Album', duration: 200, serverId }
}

function state(queue: Song[], queueIndex: number) {
  return { queue, queueIndex, currentSong: queue[queueIndex] ?? null }
}

describe('syncableQueueSlice', () => {
  it('单源队列照旧全量上报', () => {
    const queue = [song('a', NAS), song('b', NAS)]

    expect(syncableQueueSlice(state(queue, 0), NAS)).toEqual({ ids: ['a', 'b'], currentId: 'a' })
  })

  it('混源队列只上报主库那一段', () => {
    const queue = [song('a', NAS), song('w', WY), song('c', NAS)]

    expect(syncableQueueSlice(state(queue, 0), NAS)).toEqual({ ids: ['a', 'c'], currentId: 'a' })
  })

  it('当前曲不是主库的 → 整轮跳过，不写任何东西', () => {
    const queue = [song('a', NAS), song('w', WY)]

    expect(syncableQueueSlice(state(queue, 1), NAS)).toBeNull()
  })

  it('队列里主库一首歌都没有 → 不写', () => {
    const queue = [song('w1', WY), song('w2', WY)]

    expect(syncableQueueSlice(state(queue, 0), NAS)).toBeNull()
  })

  it('没有主库 / 没有当前曲 / 队列为空时都不写', () => {
    expect(syncableQueueSlice(state([song('a', NAS)], 0), null)).toBeNull()
    expect(syncableQueueSlice({ queue: [], queueIndex: -1, currentSong: null }, NAS)).toBeNull()
  })

  it('长队列只取当前曲附近的一段（往前 20 首，总长封顶）', () => {
    const queue = Array.from({ length: 300 }, (_, i) => song(`s${i}`, NAS))

    const result = syncableQueueSlice(state(queue, 100), NAS, 50)

    expect(result?.ids[0]).toBe('s80')
    expect(result?.ids).toHaveLength(50)
    expect(result?.currentId).toBe('s100')
  })
})
