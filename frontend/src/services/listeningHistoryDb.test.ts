import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Song } from '@/api/types'
import * as historyDb from '@/services/historyDb'
import { readAllEvents, resetHistoryDbForTests } from '@/services/historyDb'
import {
  initListeningHistory,
  clearListeningEvents,
  readListeningEvents,
  resetListeningHistoryCache,
  upsertListeningEvent,
  type ListeningEvent,
} from '@/services/listeningHistory'
import { STORAGE_KEYS } from '@/services/storageKeys'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return Array.from(this.values.keys())[index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

const testSong: Song = {
  id: 'song-1',
  title: 'Song 1',
  artist: 'Artist',
  album: 'Album',
  duration: 200,
  serverId: 'srv-test',
}

function listeningEvent(
  serverId: string,
  eventId: string,
  endedAt = 101_000
): ListeningEvent {
  return {
    version: 2,
    eventId,
    serverId,
    song: { ...testSong, id: `song-${eventId}`, serverId },
    startedAt: endedAt - 200_000,
    endedAt,
    listenedSeconds: 200,
    completionRate: 1,
    outcome: 'completed',
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

beforeEach(async () => {
  resetListeningHistoryCache()
  await resetHistoryDbForTests()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: new MemoryStorage(),
  })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { dispatchEvent: vi.fn() },
  })
  Object.defineProperty(globalThis, 'CustomEvent', {
    configurable: true,
    value: class {
      constructor(public type: string, public init?: unknown) {}
    },
  })
})

describe('收听历史迁移到 IndexedDB', () => {
  it('把 localStorage 里的历史搬进 IndexedDB 并释放该键', async () => {
    const legacy = [listeningEvent('server-a', 'play-1', 300_000), listeningEvent('server-a', 'play-2', 200_000)]
    localStorage.setItem(STORAGE_KEYS.playHistory, JSON.stringify(legacy))

    await initListeningHistory()

    expect(readListeningEvents('server-a').map(event => event.eventId)).toEqual(['play-1', 'play-2'])
    // 迁移完成后必须把 localStorage 配额还给播放队列等状态
    expect(localStorage.getItem(STORAGE_KEYS.playHistory)).toBeNull()
    expect((await readAllEvents<ListeningEvent>())).toHaveLength(2)
  })

  it('重复初始化不会产生重复记录', async () => {
    localStorage.setItem(
      STORAGE_KEYS.playHistory,
      JSON.stringify([listeningEvent('server-a', 'play-1')])
    )

    await initListeningHistory()
    resetListeningHistoryCache()
    await initListeningHistory()

    expect(readListeningEvents('server-a')).toHaveLength(1)
  })

  it('新记录以单条写入落库，重启后仍可读回', async () => {
    await initListeningHistory()
    upsertListeningEvent(listeningEvent('server-a', 'play-1', 100_000))
    upsertListeningEvent(listeningEvent('server-a', 'play-2', 200_000))
    // 等待异步写入完成
    await new Promise(resolve => setTimeout(resolve, 0))

    resetListeningHistoryCache()
    await initListeningHistory()

    expect(readListeningEvents('server-a').map(event => event.eventId)).toEqual(['play-2', 'play-1'])
  })

  it('同一 eventId 的续播更新覆盖旧状态而不新增记录', async () => {
    await initListeningHistory()
    upsertListeningEvent(listeningEvent('server-a', 'play-1', 100_000))
    upsertListeningEvent({
      ...listeningEvent('server-a', 'play-1', 130_000),
      listenedSeconds: 320,
    })
    await new Promise(resolve => setTimeout(resolve, 0))

    resetListeningHistoryCache()
    await initListeningHistory()

    const events = readListeningEvents('server-a')
    expect(events).toHaveLength(1)
    expect(events[0].listenedSeconds).toBe(320)
  })

  it('清除某个服务器的历史不影响其他服务器', async () => {
    await initListeningHistory()
    upsertListeningEvent(listeningEvent('server-a', 'play-a'))
    upsertListeningEvent(listeningEvent('server-b', 'play-b'))
    await new Promise(resolve => setTimeout(resolve, 0))

    clearListeningEvents('server-a')
    await new Promise(resolve => setTimeout(resolve, 0))

    resetListeningHistoryCache()
    await initListeningHistory()
    expect(readListeningEvents('server-a')).toEqual([])
    expect(readListeningEvents('server-b')).toHaveLength(1)
  })

  it('IndexedDB 写入失败时保留 localStorage 中的历史,不造成数据丢失', async () => {
    const legacy = [listeningEvent('server-a', 'play-1', 300_000)]
    const payload = JSON.stringify(legacy)
    localStorage.setItem(STORAGE_KEYS.playHistory, payload)
    const putEvents = vi.spyOn(historyDb, 'putEvents').mockResolvedValue(false)

    await initListeningHistory()

    expect(putEvents).toHaveBeenCalled()
    expect(localStorage.getItem(STORAGE_KEYS.playHistory)).toBe(payload)
    // 内存里仍然可读，本次会话不受影响
    expect(readListeningEvents('server-a')).toHaveLength(1)
  })

  it('IndexedDB 不可用时,初始化仍会保住加载期间产生的记录', async () => {
    localStorage.setItem(
      STORAGE_KEYS.playHistory,
      JSON.stringify([listeningEvent('server-a', 'stored', 100_000)])
    )
    // 模拟隐私模式/老旧 WebView：读取直接判定为不可用
    vi.spyOn(historyDb, 'readAllEvents').mockResolvedValue(null)

    const loading = initListeningHistory()
    upsertListeningEvent(listeningEvent('server-a', 'live', 500_000))
    await loading

    expect(readListeningEvents('server-a').map(event => event.eventId).sort())
      .toEqual(['live', 'stored'])
  })

  it('单条 IndexedDB 写入失败时回退到 localStorage 快照,刷新后仍可读回', async () => {
    await initListeningHistory()
    vi.spyOn(historyDb, 'putEvent').mockResolvedValue(false)

    upsertListeningEvent(listeningEvent('server-a', 'play-1', 100_000))
    await new Promise(resolve => setTimeout(resolve, 0))

    // 快照落到了 localStorage
    expect(localStorage.getItem(STORAGE_KEYS.playHistory)).not.toBeNull()

    // 下次启动会把快照合并回 IndexedDB
    vi.restoreAllMocks()
    resetListeningHistoryCache()
    await initListeningHistory()
    expect(readListeningEvents('server-a').map(event => event.eventId)).toEqual(['play-1'])
  })

  it('初始化期间产生的记录不会被加载结果覆盖', async () => {
    localStorage.setItem(
      STORAGE_KEYS.playHistory,
      JSON.stringify([listeningEvent('server-a', 'stored', 100_000)])
    )

    // 不 await：模拟加载尚未完成时用户就开始听歌
    const loading = initListeningHistory()
    upsertListeningEvent(listeningEvent('server-a', 'live', 500_000))
    await loading

    expect(readListeningEvents('server-a').map(event => event.eventId).sort())
      .toEqual(['live', 'stored'])
  })
})
