/**
 * 歌曲拖放（iPadOS / 桌面）：把歌拖到「接下来」或侧栏里的歌单上。
 *
 * dataTransfer 只能放字符串，而落点要的是完整的 Song（带 serverId、封面等）。
 * 拖动开始时把歌曲对象记在模块里，dataTransfer 只放一个自定义类型做标记——
 * 落点据此判断「这是不是一次歌曲拖动」，再从这里取对象。
 * text/plain 一并放上曲名，拖到别的应用（备忘录、聊天）时得到的是可读文字。
 */

import type { DragEvent } from 'react'
import type { Song } from '@/api/types'

export const SONG_DRAG_TYPE = 'application/x-n1ko-songs'

let payload: Song[] | null = null

export function startSongDrag(e: DragEvent, songs: Song[]): void {
  if (!songs.length) return
  payload = songs
  e.dataTransfer.effectAllowed = 'copy'
  e.dataTransfer.setData(SONG_DRAG_TYPE, String(songs.length))
  e.dataTransfer.setData('text/plain', songs.map(s => `${s.title} — ${s.artist}`).join('\n'))
}

export function isSongDrag(e: DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes(SONG_DRAG_TYPE)
}

export function readSongDrag(e: DragEvent): Song[] | null {
  return isSongDrag(e) ? payload : null
}

export function endSongDrag(): void {
  payload = null
}
