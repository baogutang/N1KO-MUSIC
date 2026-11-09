/**
 * WebDAV 换地址之后，曲目 id 就是文件地址，散落在队列、列表缓存、
 * 推荐、历史、本地歌单和歌词/封面键里。只改服务器配置的话，点开旧列表
 * 仍会去请求旧 IP。这里按 serverId 把这些地址对齐到当前基址。
 */

import { alignWebDavSong } from '@/api/adapters/webdavLibrary'
import { alignCacheForServer } from '@/services/libraryCacheDb'
import { retargetListeningSongs } from '@/services/listeningHistory'
import { RECOMMENDATION_CACHE_PREFIX } from '@/services/storageKeys'
import { useCoverCacheStore } from '@/store/coverCacheStore'
import { useLocalPlaylistStore } from '@/store/localPlaylistStore'
import { useLyricCacheStore } from '@/store/lyricCacheStore'
import { usePlayerStore } from '@/store/playerStore'
import type { Song } from '@/api/types'

function alignValue(value: unknown, serverId: string, base: string): { value: unknown; changed: boolean } {
  if (Array.isArray(value)) {
    let changed = false
    const next = value.map(item => {
      const aligned = alignValue(item, serverId, base)
      if (aligned.changed) changed = true
      return aligned.value
    })
    return changed ? { value: next, changed: true } : { value, changed: false }
  }
  if (!value || typeof value !== 'object') return { value, changed: false }
  const record = value as Record<string, unknown>
  let changed = false
  const next: Record<string, unknown> = { ...record }
  if (record.serverId === serverId && typeof record.id === 'string') {
    const current = record as unknown as Song
    const song = alignWebDavSong(current, base)
    if (song !== current) {
      Object.assign(next, song)
      changed = true
    }
  }
  for (const [key, child] of Object.entries(next)) {
    if (!child || typeof child !== 'object') continue
    const aligned = alignValue(child, serverId, base)
    if (aligned.changed) {
      next[key] = aligned.value
      changed = true
    }
  }
  return changed ? { value: next, changed: true } : { value, changed: false }
}

function alignRecommendations(serverId: string, base: string): void {
  if (typeof localStorage === 'undefined') return
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith(RECOMMENDATION_CACHE_PREFIX)) keys.push(key)
  }
  for (const key of keys) {
    const raw = localStorage.getItem(key)
    if (!raw) continue
    try {
      const parsed = JSON.parse(raw) as unknown
      const aligned = alignValue(parsed, serverId, base)
      if (aligned.changed) localStorage.setItem(key, JSON.stringify(aligned.value))
    } catch {
      // 坏掉的推荐缓存下次会自己重算
    }
  }
}

function alignPlayer(serverId: string, base: string): void {
  usePlayerStore.setState(player => {
    const mapSong = (song: Song | null): Song | null => {
      if (!song || song.serverId !== serverId) return song
      return alignWebDavSong(song, base)
    }
    const queue = player.queue.map(song => mapSong(song) as Song)
    const currentSong = mapSong(player.currentSong)
    const history = player.history.map(song => mapSong(song) as Song)
    const unchanged = queue.every((song, index) => song === player.queue[index])
      && currentSong === player.currentSong
      && history.every((song, index) => song === player.history[index])
    if (unchanged) return {}
    return { queue, currentSong, history }
  })
}

/** 把这个 WebDAV 源散落各处的文件地址改成当前服务器。 */
export async function alignWebDavServerData(serverId: string, base: string): Promise<void> {
  alignPlayer(serverId, base)
  useLyricCacheStore.getState().retargetFileUrls(serverId, base)
  useCoverCacheStore.getState().retargetFileUrls(serverId, base)
  alignRecommendations(serverId, base)
  await Promise.all([
    alignCacheForServer(serverId, value => alignValue(value, serverId, base)),
    retargetListeningSongs(serverId, base),
    useLocalPlaylistStore.getState().retargetServer(serverId, base),
  ])
}
