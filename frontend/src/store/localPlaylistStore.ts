/**
 * 本地混合歌单（PLAN 阶段 5）：IndexedDB `n1ko-music-local-playlists`。
 *
 * 条目是 { serverId, songId } 对（跨源曲目的最小标识），同时带一份曲目
 * 快照——重新解析需要各源支持按 id 取歌，插件音源没有这个能力，快照
 * 让播放 / 展示零额外请求。不同步到 backend（留接口：导出 JSON）。
 * 与服务端歌单在歌单页并列展示，带「本地」标。
 */

import { create } from 'zustand'
import type { Song } from '@/api/types'

const DB_NAME = 'n1ko-music-local-playlists'
const STORE = 'playlists'

export interface LocalPlaylistEntry {
  serverId: string
  songId: string
  /** 条目快照：播放与展示用，避免依赖各源的按 id 取歌能力 */
  song: Song
}

export interface LocalPlaylist {
  id: string
  name: string
  createdAt: number
  items: LocalPlaylistEntry[]
}

interface LocalPlaylistState {
  playlists: LocalPlaylist[]
  loaded: boolean
  load: () => Promise<void>
  create: (name: string, songs?: Song[]) => Promise<LocalPlaylist>
  addSongs: (id: string, songs: Song[]) => Promise<void>
  removeSongs: (id: string, songIds: string[]) => Promise<void>
  rename: (id: string, name: string) => Promise<void>
  remove: (id: string) => Promise<void>
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => {
      dbPromise = null
      reject(req.error ?? new Error('IndexedDB 打开失败'))
    }
  })
  return dbPromise
}

async function readAll(): Promise<LocalPlaylist[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAll()
    req.onsuccess = () => resolve((req.result ?? []) as LocalPlaylist[])
    req.onerror = () => reject(req.error)
  })
}

async function write(playlist: LocalPlaylist): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(playlist)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function removeById(id: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

function newId(): string {
  return 'local-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
}

function toEntries(songs: Song[]): LocalPlaylistEntry[] {
  return songs
    .filter(song => song && song.id && song.serverId)
    .map(song => ({ serverId: song.serverId, songId: song.id, song }))
}

export const useLocalPlaylistStore = create<LocalPlaylistState>()((set, get) => ({
  playlists: [],
  loaded: false,

  load: async () => {
    if (get().loaded) return
    const all = await readAll()
    set({ playlists: all.sort((a, b) => b.createdAt - a.createdAt), loaded: true })
  },

  create: async (name, songs) => {
    const playlist: LocalPlaylist = {
      id: newId(),
      name: name.trim() || '本地混合歌单',
      createdAt: Date.now(),
      items: toEntries(songs ?? []),
    }
    await write(playlist)
    set({ playlists: [playlist, ...get().playlists] })
    return playlist
  },

  addSongs: async (id, songs) => {
    const playlist = get().playlists.find(p => p.id === id)
    if (!playlist) return
    const known = new Set(playlist.items.map(i => `${i.serverId}:${i.songId}`))
    const fresh = toEntries(songs).filter(i => !known.has(`${i.serverId}:${i.songId}`))
    if (!fresh.length) return
    const next = { ...playlist, items: [...playlist.items, ...fresh] }
    await write(next)
    set({ playlists: get().playlists.map(p => (p.id === id ? next : p)) })
  },

  removeSongs: async (id, songIds) => {
    const playlist = get().playlists.find(p => p.id === id)
    if (!playlist) return
    const drop = new Set(songIds)
    const next = { ...playlist, items: playlist.items.filter(i => !drop.has(`${i.serverId}:${i.songId}`)) }
    await write(next)
    set({ playlists: get().playlists.map(p => (p.id === id ? next : p)) })
  },

  rename: async (id, name) => {
    const playlist = get().playlists.find(p => p.id === id)
    if (!playlist || !name.trim()) return
    const next = { ...playlist, name: name.trim() }
    await write(next)
    set({ playlists: get().playlists.map(p => (p.id === id ? next : p)) })
  },

  remove: async id => {
    await removeById(id)
    set({ playlists: get().playlists.filter(p => p.id !== id) })
  },
}))
