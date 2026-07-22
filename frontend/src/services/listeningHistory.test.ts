import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Song } from '@/api/types'
import {
  clearListeningEvents,
  readListeningEvents,
  upsertListeningEvent,
  type ListeningEvent,
} from '@/services/listeningHistory'

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
}

function listeningEvent(serverId: string, eventId = 'event-1'): ListeningEvent {
  return {
    version: 2,
    eventId,
    serverId,
    song: { ...testSong, serverId },
    startedAt: 1000,
    endedAt: 101000,
    listenedSeconds: 100,
    completionRate: 0.5,
    outcome: 'qualified',
  }
}

beforeEach(() => {
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

describe('listening history persistence', () => {
  it('keeps repeated plays as separate events but upserts the same session', () => {
    upsertListeningEvent(listeningEvent('server-a', 'play-1'))
    upsertListeningEvent(listeningEvent('server-a', 'play-2'))
    upsertListeningEvent({ ...listeningEvent('server-a', 'play-2'), listenedSeconds: 180 })

    const events = readListeningEvents('server-a')
    expect(events).toHaveLength(2)
    expect(events.find(event => event.eventId === 'play-2')?.listenedSeconds).toBe(180)
  })

  it('isolates history by server and clears only the active server', () => {
    upsertListeningEvent(listeningEvent('server-a', 'play-a'))
    upsertListeningEvent(listeningEvent('server-b', 'play-b'))

    expect(readListeningEvents('server-a').map(event => event.eventId)).toEqual(['play-a'])
    expect(readListeningEvents('server-b').map(event => event.eventId)).toEqual(['play-b'])

    clearListeningEvents('server-a')
    expect(readListeningEvents('server-a')).toEqual([])
    expect(readListeningEvents('server-b')).toHaveLength(1)
  })

  it('migrates legacy deduplicated entries into the active server scope', () => {
    localStorage.setItem('msp-play-history', JSON.stringify([
      { song: testSong, playedAt: 200000 },
    ]))

    const [migrated] = readListeningEvents('server-a')
    expect(migrated.serverId).toBe('server-a')
    expect(migrated.outcome).toBe('completed')
    expect(migrated.listenedSeconds).toBe(200)
  })
})
