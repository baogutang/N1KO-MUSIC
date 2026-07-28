import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Song } from '@/api/types'

vi.mock('@/api/syncClient', () => ({
  pushScrobble: vi.fn(async () => undefined),
  fetchRemoteHistory: vi.fn(async () => ({ items: [], total: 0 })),
  checkSyncService: vi.fn(async () => ({ ok: true })),
  registerSyncAccount: vi.fn(),
  loginSyncAccount: vi.fn(),
  pushFavorite: vi.fn(),
  removeFavorite: vi.fn(),
  describeSyncError: (error: unknown) => String(error),
}))

import { fetchRemoteHistory, pushScrobble } from '@/api/syncClient'
import {
  backfillPendingScrobbles,
  enqueueLocalBacklog,
  flushOutbox,
  pendingScrobbleCount,
  pullRemoteHistory,
  queueScrobble,
  resetHistorySyncForTests,
} from '@/services/historySync'
import {
  initListeningHistory,
  readListeningEvents,
  resetListeningHistoryCache,
  upsertListeningEvent,
  type ListeningEvent,
} from '@/services/listeningHistory'
import { resetHistoryDbForTests } from '@/services/historyDb'
import { useSyncStore } from '@/store/syncStore'
import { useServerStore } from '@/store/serverStore'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return Array.from(this.values.keys())[index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

const SERVER_ID = 'server-a'

function song(id: string, overrides: Partial<Song> = {}): Song {
  return {
    id,
    serverId: SERVER_ID,
    title: `Song ${id}`,
    artist: 'Artist',
    album: 'Album',
    duration: 200,
    ...overrides,
  }
}

function listeningEvent(eventId: string, listenedSeconds = 180, endedAt = 1_700_000_000_000): ListeningEvent {
  return {
    version: 2,
    eventId,
    serverId: SERVER_ID,
    song: song(`song-${eventId}`),
    startedAt: endedAt - listenedSeconds * 1000,
    endedAt,
    listenedSeconds,
    completionRate: listenedSeconds / 200,
    outcome: 'completed',
  }
}

function unauthorized(): Error {
  const error = new Error('Unauthorized') as Error & { isAxiosError: boolean; response: { status: number } }
  error.isAxiosError = true
  error.response = { status: 401 }
  return error
}

function enableSync() {
  useSyncStore.setState({ enabled: true, baseUrl: 'http://sync.local', token: 'token-1', username: 'niko' })
}

beforeEach(async () => {
  vi.clearAllMocks()
  resetHistorySyncForTests()
  resetListeningHistoryCache()
  await resetHistoryDbForTests()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: new MemoryStorage() })
  // 历史写入会广播 msp-history-updated，缺少 window 会让写入路径中途抛错
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { dispatchEvent: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() },
  })
  Object.defineProperty(globalThis, 'CustomEvent', {
    configurable: true,
    value: class {
      constructor(public type: string, public init?: unknown) {}
    },
  })
  useServerStore.setState({ activeServerId: SERVER_ID })
  useSyncStore.setState({
    enabled: false,
    baseUrl: '',
    token: null,
    username: null,
    lastError: null,
    lastSyncedAt: null,
  })
  await initListeningHistory()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('上报出队', () => {
  it('未配置同步时不入队,也不产生任何请求', async () => {
    queueScrobble(listeningEvent('event-1'))
    expect(pendingScrobbleCount()).toBe(0)
    await flushOutbox()
    expect(pushScrobble).not.toHaveBeenCalled()
  })

  it('开启同步后入队并在冲刷时批量上报', async () => {
    enableSync()
    queueScrobble(listeningEvent('event-1'))
    queueScrobble(listeningEvent('event-2'))
    expect(pendingScrobbleCount()).toBe(2)

    await flushOutbox()
    expect(pushScrobble).toHaveBeenCalledTimes(2)
    expect(pendingScrobbleCount()).toBe(0)
    expect(useSyncStore.getState().lastSyncedAt).not.toBeNull()
  })

  it('同一次收听多次刷新只上报最新状态,不会重复打点', async () => {
    enableSync()
    queueScrobble(listeningEvent('event-1', 30))
    queueScrobble(listeningEvent('event-1', 90))
    queueScrobble(listeningEvent('event-1', 180))
    expect(pendingScrobbleCount()).toBe(1)

    await flushOutbox()
    expect(pushScrobble).toHaveBeenCalledTimes(1)
    expect(vi.mocked(pushScrobble).mock.calls[0][2]).toMatchObject({
      eventId: 'event-1',
      duration: 180,
    })
  })

  it('上报使用秒级时间戳,与后端契约一致', async () => {
    enableSync()
    queueScrobble(listeningEvent('event-1', 180, 1_700_000_000_000))
    await flushOutbox()
    expect(vi.mocked(pushScrobble).mock.calls[0][2].playedAt).toBe(1_700_000_000)
  })

  it('令牌失效时清空出队并要求重新登录,避免无意义重试', async () => {
    enableSync()
    vi.mocked(pushScrobble).mockRejectedValueOnce(unauthorized())
    queueScrobble(listeningEvent('event-1'))

    await flushOutbox()
    expect(pendingScrobbleCount()).toBe(0)
    expect(useSyncStore.getState().token).toBeNull()
    expect(useSyncStore.getState().lastError).toContain('过期')
  })

  it('网络故障时保留出队等待重试,不丢记录', async () => {
    enableSync()
    vi.mocked(pushScrobble).mockRejectedValue(new Error('network down'))
    queueScrobble(listeningEvent('event-1'))

    await flushOutbox()
    expect(pendingScrobbleCount()).toBe(1)
    expect(useSyncStore.getState().lastSyncedAt).toBeNull()

    // 恢复后重试成功
    vi.mocked(pushScrobble).mockResolvedValue(undefined)
    await flushOutbox()
    expect(pendingScrobbleCount()).toBe(0)
  })

  it('本地已有历史可以补推,让绑定账号前的记录也参与同步', async () => {
    upsertListeningEvent(listeningEvent('old-1'))
    upsertListeningEvent(listeningEvent('old-2'))
    enableSync()

    expect(enqueueLocalBacklog()).toBe(2)
    expect(pendingScrobbleCount()).toBe(2)
  })

  it('上报期间同一次收听又刷新时,不会把更新后的那份删掉', async () => {
    enableSync()
    const stale = listeningEvent('event-1', 30)
    const fresh = listeningEvent('event-1', 200)
    // 在上报进行中模拟播放继续推进
    vi.mocked(pushScrobble).mockImplementationOnce(async () => {
      queueScrobble(fresh)
    })
    queueScrobble(stale)

    await flushOutbox()
    expect(pendingScrobbleCount()).toBe(1)

    await flushOutbox()
    expect(vi.mocked(pushScrobble).mock.calls.at(-1)?.[2]).toMatchObject({ duration: 200 })
    expect(pendingScrobbleCount()).toBe(0)
  })

  it('启动补推只取上次同步之后的记录,避免每次启动重推全部历史', async () => {
    const base = 1_700_000_000_000
    upsertListeningEvent(listeningEvent('very-old', 180, base - 10 * 86_400_000))
    upsertListeningEvent(listeningEvent('recent', 180, base))
    enableSync()
    useSyncStore.setState({ lastSyncedAt: base - 60_000 })

    expect(backfillPendingScrobbles()).toBe(1)
    await flushOutbox()
    expect(vi.mocked(pushScrobble).mock.calls[0][2].eventId).toBe('recent')
  })

  it('从未同步过时启动补推会带上全部本地历史', async () => {
    upsertListeningEvent(listeningEvent('old-1'))
    upsertListeningEvent(listeningEvent('old-2'))
    enableSync()
    useSyncStore.setState({ lastSyncedAt: null })

    expect(backfillPendingScrobbles()).toBe(2)
  })
})

describe('拉取远端历史', () => {
  function remoteEntry(overrides: Record<string, unknown> = {}) {
    return {
      event_id: 'remote-1',
      song_id: 'song-remote',
      server_id: SERVER_ID,
      played_at: 1_700_000_000,
      duration: 190,
      songData: { id: 'song-remote', title: 'Remote Song', artist: 'Remote Artist', album: 'A', duration: 200 },
      ...overrides,
    }
  }

  it('未配置同步时直接返回 0,不发请求', async () => {
    expect(await pullRemoteHistory()).toBe(0)
    expect(fetchRemoteHistory).not.toHaveBeenCalled()
  })

  it('把远端记录转换并合并进本地历史', async () => {
    enableSync()
    vi.mocked(fetchRemoteHistory).mockResolvedValueOnce({ items: [remoteEntry()], total: 1 })

    expect(await pullRemoteHistory()).toBe(1)
    const local = readListeningEvents(SERVER_ID)
    expect(local).toHaveLength(1)
    expect(local[0].eventId).toBe('remote-1')
    // played_at 是秒级，本地统一用毫秒
    expect(local[0].endedAt).toBe(1_700_000_000_000)
    expect(local[0].listenedSeconds).toBe(190)
    expect(local[0].outcome).toBe('completed')
  })

  it('重复拉取同一条记录不会翻倍', async () => {
    enableSync()
    vi.mocked(fetchRemoteHistory).mockResolvedValue({ items: [remoteEntry()], total: 1 })

    await pullRemoteHistory()
    await pullRemoteHistory()
    expect(readListeningEvents(SERVER_ID)).toHaveLength(1)
  })

  it('远端缺少 event_id 时用可复现的组合键,重复拉取仍不翻倍', async () => {
    enableSync()
    vi.mocked(fetchRemoteHistory).mockResolvedValue({
      items: [remoteEntry({ event_id: null })],
      total: 1,
    })

    await pullRemoteHistory()
    await pullRemoteHistory()
    expect(readListeningEvents(SERVER_ID)).toHaveLength(1)
  })

  it('丢弃 songData 缺失的脏数据而不是写入坏记录', async () => {
    enableSync()
    vi.mocked(fetchRemoteHistory).mockResolvedValueOnce({
      items: [remoteEntry({ songData: null }), remoteEntry({ event_id: 'remote-2' })],
      total: 2,
    })

    expect(await pullRemoteHistory()).toBe(1)
    expect(readListeningEvents(SERVER_ID).map(e => e.eventId)).toEqual(['remote-2'])
  })

  it('令牌失效时标记需要重新登录', async () => {
    enableSync()
    vi.mocked(fetchRemoteHistory).mockRejectedValueOnce(unauthorized())

    expect(await pullRemoteHistory()).toBe(0)
    expect(useSyncStore.getState().token).toBeNull()
  })

  it('本地已有更完整的同一条记录时不被远端较短的时长覆盖', async () => {
    enableSync()
    upsertListeningEvent({ ...listeningEvent('remote-1', 195), song: song('song-remote') })
    vi.mocked(fetchRemoteHistory).mockResolvedValueOnce({
      items: [remoteEntry({ duration: 30 })],
      total: 1,
    })

    await pullRemoteHistory()
    const local = readListeningEvents(SERVER_ID)
    expect(local).toHaveLength(1)
    expect(local[0].listenedSeconds).toBe(195)
  })

  it('结束时刻相同但远端听得更久时,以远端为准', async () => {
    enableSync()
    // 同一条记录：本地只记到 30 秒，另一台设备听完了整首
    upsertListeningEvent({
      ...listeningEvent('remote-1', 30, 1_700_000_000_000),
      song: song('song-remote'),
    })
    vi.mocked(fetchRemoteHistory).mockResolvedValueOnce({
      items: [remoteEntry({ duration: 190 })],
      total: 1,
    })

    await pullRemoteHistory()
    const local = readListeningEvents(SERVER_ID)
    expect(local).toHaveLength(1)
    expect(local[0].listenedSeconds).toBe(190)
  })

  it('总数超过单页时会继续翻页,不会只拿第一页', async () => {
    enableSync()
    const page = (offset: number) =>
      Array.from({ length: 500 }, (_, i) => remoteEntry({
        event_id: `remote-${offset + i}`,
        song_id: `song-${offset + i}`,
        songData: {
          id: `song-${offset + i}`, title: 'T', artist: 'A', album: 'B', duration: 200,
        },
      }))
    vi.mocked(fetchRemoteHistory)
      .mockResolvedValueOnce({ items: page(0), total: 700 })
      .mockResolvedValueOnce({ items: page(500).slice(0, 200), total: 700 })

    expect(await pullRemoteHistory()).toBe(700)
    expect(fetchRemoteHistory).toHaveBeenCalledTimes(2)
  })
})
