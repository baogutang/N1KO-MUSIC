/**
 * @vitest-environment happy-dom
 *
 * 歌单详情的编辑权限（B5）。
 *
 * 「移除」原来是无条件挂上去的：外源歌单、Navidrome 的智能歌单上点它，
 * 请求要么打错服务器要么静默无效，界面却装作删掉了。
 */

import { describe, expect, it } from 'vitest'
import type { SourceCapabilities } from '@/api/types'
import { canEditPlaylist } from './PlaylistDetail'

const NAS = 'nas'
const WY = 'wy'

function caps(write: Partial<Record<string, boolean>>): Record<string, SourceCapabilities> {
  const map: Record<string, SourceCapabilities> = {}
  for (const [serverId, playlistWrite] of Object.entries(write)) {
    map[serverId] = {
      search: true, album: true, artist: true, lyrics: true,
      userPlaylists: true, favorites: true, playlistWrite: !!playlistWrite,
      topLists: false, recommendSheets: false, recommendSongs: false,
      importSheet: false, libraryBrowse: true, radio: false,
    }
  }
  return map
}

describe('canEditPlaylist', () => {
  it('源能写且歌单不是只读 → 可以改', () => {
    expect(canEditPlaylist({ serverId: NAS }, caps({ [NAS]: true }))).toBe(true)
  })

  it('源不声明 playlistWrite → 不可改，哪怕主库能写', () => {
    expect(canEditPlaylist({ serverId: WY }, caps({ [NAS]: true, [WY]: false }))).toBe(false)
  })

  it('智能歌单（readonly）不可改——删掉一行下次刷新它又回来了', () => {
    expect(canEditPlaylist({ serverId: NAS, readonly: true }, caps({ [NAS]: true }))).toBe(false)
  })

  it('能力快照里没有这个源（未连接）→ 不可改', () => {
    expect(canEditPlaylist({ serverId: 'gone' }, caps({ [NAS]: true }))).toBe(false)
  })

  it('歌单还没加载出来 → 不可改', () => {
    expect(canEditPlaylist(undefined, caps({ [NAS]: true }))).toBe(false)
  })
})
