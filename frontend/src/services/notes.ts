/**
 * 边注：写在页边的东西。
 *
 * 曲库里的元数据是别人写的。这里存的是你自己写的——为什么留着这张专辑、
 * 这首歌是哪年夏天听的、这段间奏为什么好。它是整个软件里唯一不能从曲库
 * 或行为重新算出来的数据，丢了就是真的丢了。
 *
 * 因此它是**本地优先**的：写下就落盘，不依赖任何服务端；配了同步后端才顺手
 * 推上去，跨设备跟着走。这一点和收听历史同构，冲突解决也一样简单——
 * updated_at 更新的那份赢。边注是一个人写给自己的，不存在多人并发编辑。
 */

import { STORAGE_KEYS } from '@/services/storageKeys'
import { useSyncStore } from '@/store/syncStore'
import { fetchRemoteNotes, pushNote, removeRemoteNote } from '@/api/syncClient'

export type NoteTarget = 'song' | 'album' | 'artist'

/** 与后端 CHECK 保持一致：够写一段话，又不至于把整篇乐评塞进同步载荷 */
export const MAX_NOTE_LENGTH = 2_000

export interface Note {
  targetType: NoteTarget
  targetId: string
  serverId: string
  body: string
  createdAt: number
  updatedAt: number
  /** 墓碑：删除本身也要能同步出去 */
  deleted?: boolean
}

function noteKey(target: NoteTarget, targetId: string, serverId: string): string {
  return `${serverId}:${target}:${targetId}`
}

type NoteMap = Record<string, Note>

function readAll(): NoteMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.notes)
    return raw ? (JSON.parse(raw) as NoteMap) : {}
  } catch {
    return {}
  }
}

function writeAll(map: NoteMap): void {
  try {
    localStorage.setItem(STORAGE_KEYS.notes, JSON.stringify(map))
  } catch (error) {
    console.warn('[notes] 写入失败，本次改动只存在于内存：', error)
  }
}

/** 读一条。墓碑当作不存在。 */
export function readNote(target: NoteTarget, targetId: string, serverId: string): Note | null {
  const note = readAll()[noteKey(target, targetId, serverId)]
  return note && !note.deleted ? note : null
}

/** 全部还活着的边注，最近写的在前 */
export function readNotes(serverId?: string): Note[] {
  return Object.values(readAll())
    .filter(note => !note.deleted && (!serverId || note.serverId === serverId))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

function syncTarget(): { baseUrl: string; token: string } | null {
  const state = useSyncStore.getState()
  if (!state.enabled || !state.baseUrl || !state.token) return null
  return { baseUrl: state.baseUrl, token: state.token }
}

/**
 * 写入。
 *
 * 先落本地再推服务端：推送失败不该让用户刚写的一句话消失。
 * 推失败的那一条会在下次 syncNotes 时靠 updated_at 比对补上去。
 */
export function saveNote(
  target: NoteTarget,
  targetId: string,
  serverId: string,
  body: string,
  now = Date.now()
): Note | null {
  const trimmed = body.trim().slice(0, MAX_NOTE_LENGTH)
  if (!trimmed) return null

  const map = readAll()
  const key = noteKey(target, targetId, serverId)
  const existing = map[key]
  const note: Note = {
    targetType: target,
    targetId,
    serverId,
    body: trimmed,
    // 复活一条被删掉的边注时，写作时间是这一次——那是新写的，不是旧的回来了
    createdAt: existing && !existing.deleted ? existing.createdAt : now,
    updatedAt: now,
  }
  map[key] = note
  writeAll(map)

  const remote = syncTarget()
  if (remote) {
    void pushNote(remote.baseUrl, remote.token, note).catch(() => {
      // 静默：本地已经存下了，下次同步会补
    })
  }
  return note
}

/** 删除。本地留墓碑，服务端也留——否则另一台设备会把它推回来。 */
export function deleteNote(
  target: NoteTarget,
  targetId: string,
  serverId: string,
  now = Date.now()
): void {
  const map = readAll()
  const key = noteKey(target, targetId, serverId)
  if (!map[key]) return
  map[key] = { ...map[key], body: '', deleted: true, updatedAt: now }
  writeAll(map)

  const remote = syncTarget()
  if (remote) {
    void removeRemoteNote(remote.baseUrl, remote.token, target, targetId, serverId).catch(() => {})
  }
}

/**
 * 与服务端对账。
 *
 * 逐条比 updated_at，新的赢。边注是一个人写给自己的，没有多人并发编辑，
 * 「后写的赢」就是正确且够用的策略——引入向量时钟只会让代码更难懂而不更对。
 */
export async function syncNotes(): Promise<{ pulled: number; pushed: number } | null> {
  const remote = syncTarget()
  if (!remote) return null

  const local = readAll()
  let pulled = 0
  let pushed = 0

  const page = await fetchRemoteNotes(remote.baseUrl, remote.token)
  for (const incoming of page) {
    const key = noteKey(incoming.targetType, incoming.targetId, incoming.serverId)
    const mine = local[key]
    if (!mine || incoming.updatedAt > mine.updatedAt) {
      local[key] = incoming
      pulled++
    }
  }
  writeAll(local)

  // 本地更新的推上去。墓碑同样要推——删除是一条事实。
  const remoteByKey = new Map(
    page.map(note => [noteKey(note.targetType, note.targetId, note.serverId), note])
  )
  for (const [key, mine] of Object.entries(local)) {
    const theirs = remoteByKey.get(key)
    if (theirs && theirs.updatedAt >= mine.updatedAt) continue
    try {
      if (mine.deleted) {
        await removeRemoteNote(remote.baseUrl, remote.token, mine.targetType, mine.targetId, mine.serverId)
      } else {
        await pushNote(remote.baseUrl, remote.token, mine)
      }
      pushed++
    } catch {
      // 单条失败不该中断整轮对账，下一轮再试
    }
  }

  return { pulled, pushed }
}
