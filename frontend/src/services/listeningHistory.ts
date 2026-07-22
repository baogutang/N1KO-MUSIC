import type { Song } from '@/api/types'

const HISTORY_KEY = 'msp-play-history'
const MAX_EVENTS = 5000

export type ListeningOutcome = 'completed' | 'qualified' | 'abandoned' | 'skipped'

export interface ListeningEvent {
  version: 2
  eventId: string
  serverId: string
  song: Song
  startedAt: number
  endedAt: number
  listenedSeconds: number
  completionRate: number
  outcome: ListeningOutcome
}

interface LegacyHistoryEntry {
  song?: Song
  playedAt?: number
}

function createId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `play_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

export function createListeningEventId(): string {
  return createId()
}

function isListeningEvent(value: unknown): value is ListeningEvent {
  if (!value || typeof value !== 'object') return false
  const event = value as Partial<ListeningEvent>
  return event.version === 2 && typeof event.eventId === 'string' && !!event.song
}

function normalizeEvent(value: unknown, fallbackServerId: string): ListeningEvent | null {
  if (isListeningEvent(value)) {
    const duration = Math.max(0, Number(value.song.duration) || 0)
    const listenedSeconds = Math.max(0, Number(value.listenedSeconds) || 0)
    return {
      ...value,
      serverId: value.serverId || fallbackServerId,
      song: { ...value.song, serverId: value.serverId || fallbackServerId },
      listenedSeconds,
      completionRate: duration > 0
        ? Math.max(0, Math.min(1, listenedSeconds / duration))
        : Math.max(0, Math.min(1, Number(value.completionRate) || 0)),
    }
  }

  const legacy = value as LegacyHistoryEntry
  if (!legacy?.song?.id || !legacy.playedAt) return null
  const duration = Math.max(0, Number(legacy.song.duration) || 0)
  const serverId = legacy.song.serverId || fallbackServerId
  return {
    version: 2,
    eventId: `legacy_${serverId}_${legacy.playedAt}_${legacy.song.id}`,
    serverId,
    song: { ...legacy.song, serverId },
    startedAt: legacy.playedAt - duration * 1000,
    endedAt: legacy.playedAt,
    listenedSeconds: duration,
    completionRate: duration > 0 ? 1 : 0,
    outcome: 'completed',
  }
}

function readAll(fallbackServerId = 'legacy'): ListeningEvent[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(item => normalizeEvent(item, fallbackServerId))
      .filter((item): item is ListeningEvent => item !== null)
      .sort((a, b) => b.endedAt - a.endedAt)
  } catch {
    return []
  }
}

function clearLegacyCoverCache() {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith('msp-cover:')) keys.push(key)
  }
  keys.forEach(key => localStorage.removeItem(key))
}

function writeAll(events: ListeningEvent[]) {
  const bounded = events
    .sort((a, b) => b.endedAt - a.endedAt)
    .slice(0, MAX_EVENTS)
  const payload = JSON.stringify(bounded)
  try {
    localStorage.setItem(HISTORY_KEY, payload)
  } catch {
    clearLegacyCoverCache()
    // Quota 仍不足时保留最近一半记录，避免一次写入让全部历史丢失。
    localStorage.setItem(HISTORY_KEY, JSON.stringify(bounded.slice(0, Math.floor(MAX_EVENTS / 2))))
  }
}

function notifyHistoryUpdated(serverId: string) {
  window.dispatchEvent(new CustomEvent('msp-history-updated', { detail: { serverId } }))
}

export function readListeningEvents(serverId?: string): ListeningEvent[] {
  const events = readAll(serverId || 'legacy')
  if (!serverId) return events
  return events.filter(event => event.serverId === serverId)
}

export function upsertListeningEvent(event: ListeningEvent): void {
  try {
    const events = readAll(event.serverId)
    const index = events.findIndex(item => item.eventId === event.eventId)
    if (index >= 0) events[index] = event
    else events.unshift(event)
    writeAll(events)
    notifyHistoryUpdated(event.serverId)
  } catch (error) {
    console.error('[History] failed to persist listening event:', error)
  }
}

export function clearListeningEvents(serverId: string): void {
  const remaining = readAll(serverId).filter(event => event.serverId !== serverId)
  writeAll(remaining)
  notifyHistoryUpdated(serverId)
}

export function getScrobbleThreshold(durationSeconds: number): number {
  return durationSeconds > 0 ? Math.min(durationSeconds / 2, 240) : 240
}

export function isQualifiedListeningEvent(event: ListeningEvent): boolean {
  return event.listenedSeconds >= getScrobbleThreshold(event.song.duration || 0)
}

export function deriveListeningOutcome(
  listenedSeconds: number,
  durationSeconds: number,
  completed = false
): ListeningOutcome {
  const completionRate = durationSeconds > 0 ? listenedSeconds / durationSeconds : 0
  if (completed || completionRate >= 0.9) return 'completed'
  if (listenedSeconds >= getScrobbleThreshold(durationSeconds)) return 'qualified'
  if (listenedSeconds < Math.min(30, Math.max(5, durationSeconds * 0.1))) return 'skipped'
  return 'abandoned'
}
