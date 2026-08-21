/**
 * N1KO 同步服务客户端。
 *
 * 这是**可选**的自建后端（backend/），与音乐服务器（Navidrome/Jellyfin…）完全无关：
 * 音乐数据始终直连音乐服务器，这里只负责把收听历史与收藏镜像到自己的 SQLite，
 * 以便跨设备复原推荐画像。未配置同步服务时，全部功能照常工作。
 */

import axios, { type AxiosInstance } from 'axios'
import type { Song } from '@/api/types'
import { t } from '@/i18n'

export interface SyncAuthResult {
  token: string
  username: string
}

/** 服务端返回的收听记录（song_data 已解析）*/
export interface RemoteHistoryEntry {
  event_id: string | null
  song_id: string
  server_id: string
  played_at: number
  duration: number | null
  songData: Record<string, unknown> | null
}

export interface RemoteHistoryPage {
  items: RemoteHistoryEntry[]
  total: number
}

export interface ScrobblePayload {
  eventId: string
  songId: string
  serverId: string
  songData: Song
  /** 已收听秒数 */
  duration?: number
  /** 收听结束时刻（秒级 Unix 时间戳）*/
  playedAt?: number
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

function createClient(baseUrl: string, token?: string): AxiosInstance {
  return axios.create({
    baseURL: normalizeBaseUrl(baseUrl),
    timeout: 15_000,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
}

/** 把后端返回的错误整理成可直接展示的中文提示 */
export function describeSyncError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status
    const detail = (error.response?.data as { error?: string } | undefined)?.error
    if (status === 401) return t('sync.error.credentials')
    if (status === 409) return t('sync.error.taken')
    if (status === 429) return t('sync.error.rateLimited')
    if (detail) return detail
    if (!error.response) return t('sync.error.unreachable')
  }
  return error instanceof Error ? error.message : t('error.unknown')
}

/** 探测服务是否可用；顺带确认这确实是一个 N1KO 同步服务而不是随便一个地址 */
export async function checkSyncService(baseUrl: string): Promise<{ ok: boolean; version?: string }> {
  try {
    const response = await createClient(baseUrl).get<{ status?: string; version?: string }>('/health')
    return { ok: response.data?.status === 'ok', version: response.data?.version }
  } catch {
    return { ok: false }
  }
}

interface AuthResponse {
  token: string
  username?: string
}

export async function registerSyncAccount(
  baseUrl: string,
  username: string,
  password: string
): Promise<SyncAuthResult> {
  const response = await createClient(baseUrl).post<AuthResponse>('/api/auth/register', {
    username,
    password,
  })
  return { token: response.data.token, username: response.data.username ?? username.trim() }
}

export async function loginSyncAccount(
  baseUrl: string,
  username: string,
  password: string
): Promise<SyncAuthResult> {
  const response = await createClient(baseUrl).post<AuthResponse>('/api/auth/login', {
    username,
    password,
  })
  return { token: response.data.token, username: response.data.username ?? username.trim() }
}

export async function pushScrobble(
  baseUrl: string,
  token: string,
  payload: ScrobblePayload
): Promise<void> {
  await createClient(baseUrl, token).post('/api/stats/scrobble', {
    eventId: payload.eventId,
    songId: payload.songId,
    serverId: payload.serverId,
    songData: payload.songData,
    ...(payload.duration !== undefined ? { duration: Math.round(payload.duration) } : {}),
    ...(payload.playedAt !== undefined ? { playedAt: payload.playedAt } : {}),
  })
}

export async function fetchRemoteHistory(
  baseUrl: string,
  token: string,
  options: { serverId?: string; limit?: number; offset?: number } = {}
): Promise<RemoteHistoryPage> {
  const response = await createClient(baseUrl, token).get<RemoteHistoryPage>('/api/stats/history', {
    params: {
      limit: options.limit ?? 500,
      offset: options.offset ?? 0,
      ...(options.serverId ? { serverId: options.serverId } : {}),
    },
  })
  return {
    items: Array.isArray(response.data?.items) ? response.data.items : [],
    total: Number(response.data?.total ?? 0),
  }
}

export async function pushFavorite(
  baseUrl: string,
  token: string,
  song: Song,
  serverId: string
): Promise<void> {
  await createClient(baseUrl, token).put('/api/favorites', {
    songId: song.id,
    serverId,
    songData: song,
  })
}

export async function removeFavorite(
  baseUrl: string,
  token: string,
  songId: string,
  serverId: string
): Promise<void> {
  await createClient(baseUrl, token).delete('/api/favorites', {
    params: { songId, serverId },
  })
}

/**
 * 边注同步。
 *
 * 形状与收藏一致（PUT 覆盖 / DELETE 立墓碑 / GET 拉全量），
 * 客户端因此可以共用同一套「后写的赢」的对账逻辑。
 */
export interface RemoteNote {
  targetType: 'song' | 'album' | 'artist'
  targetId: string
  serverId: string
  body: string
  createdAt: number
  updatedAt: number
  deleted?: boolean
}

export async function pushNote(
  baseUrl: string,
  token: string,
  note: { targetType: RemoteNote['targetType']; targetId: string; serverId: string; body: string }
): Promise<void> {
  await createClient(baseUrl, token).put('/api/notes', {
    targetType: note.targetType,
    targetId: note.targetId,
    serverId: note.serverId,
    body: note.body,
  })
}

export async function removeRemoteNote(
  baseUrl: string,
  token: string,
  targetType: RemoteNote['targetType'],
  targetId: string,
  serverId: string
): Promise<void> {
  await createClient(baseUrl, token).delete('/api/notes', {
    params: { targetType, targetId, serverId },
  })
}

/** 拉全量（含墓碑）。边注体量很小，不做分页游标也不会出问题。 */
export async function fetchRemoteNotes(
  baseUrl: string,
  token: string
): Promise<RemoteNote[]> {
  const response = await createClient(baseUrl, token).get<{ items?: unknown[] }>('/api/notes', {
    params: { limit: 500, since: 0 },
  })
  const items = Array.isArray(response.data?.items) ? response.data.items : []
  return items.flatMap(raw => {
    const item = raw as Partial<RemoteNote>
    if (!item.targetType || !item.targetId || !item.serverId) return []
    return [{
      targetType: item.targetType,
      targetId: item.targetId,
      serverId: item.serverId,
      body: item.body ?? '',
      createdAt: Number(item.createdAt ?? item.updatedAt ?? 0) * 1000,
      // 服务端用秒，本地用毫秒——在边界上换算一次，别让两种单位在内部混着走
      updatedAt: Number(item.updatedAt ?? 0) * 1000,
      ...(item.deleted ? { deleted: true } : {}),
    }]
  })
}
