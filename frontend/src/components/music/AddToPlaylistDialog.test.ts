/**
 * @vitest-environment happy-dom
 *
 * 「加入歌单」的去处解析（B4）。
 *
 * 钉三条：
 *  - 服务端歌单按**曲目来源**分组，只列声明了 playlistWrite 的源；
 *  - 曲目同源时默认动作是那个源的服务端歌单（回车建的也是它）；
 *  - 曲目跨源时没有任何服务端歌单收得下，默认动作让给本地混合歌单。
 */

import { describe, expect, it } from 'vitest'
import type { Playlist, Song, SourceCapabilities } from '@/api/types'
import type { SourceQueryGroup } from '@/hooks/useSourceQueries'
import { resolvePlaylistTargets } from './AddToPlaylistDialog'

const NAS = 'nas'
const WY = 'wy'

function song(id: string, serverId: string): Song {
  return { id, title: `Song ${id}`, artist: 'Artist', album: 'Album', duration: 200, serverId }
}

function playlist(id: string, serverId: string, extra: Partial<Playlist> = {}): Playlist {
  return { id, name: `PL ${id}`, serverId, ...extra }
}

function caps(partial: Partial<Record<string, boolean>>): Record<string, SourceCapabilities> {
  const map: Record<string, SourceCapabilities> = {}
  for (const [serverId, playlistWrite] of Object.entries(partial)) {
    map[serverId] = {
      search: true, album: true, artist: true, lyrics: true,
      userPlaylists: true, favorites: true, playlistWrite: !!playlistWrite,
      topLists: false, recommendSheets: false, recommendSongs: false,
      importSheet: false, libraryBrowse: true, radio: false,
    }
  }
  return map
}

function group(serverId: string, playlists: Playlist[]): SourceQueryGroup<Playlist[]> {
  return { serverId, name: serverId, type: 'subsonic', status: 'success', data: playlists }
}

const groups = [
  group(NAS, [playlist('n1', NAS), playlist('smart', NAS, { readonly: true })]),
  group(WY, [playlist('w1', WY)]),
]

describe('resolvePlaylistTargets', () => {
  it('曲目全来自一个源：默认落在该源的服务端歌单', () => {
    const plan = resolvePlaylistTargets([song('a', NAS)], NAS, groups, caps({ [NAS]: true, [WY]: true }))

    expect(plan.crossSource).toBe(false)
    expect(plan.singleSourceId).toBe(NAS)
    expect(plan.defaultCreate).toEqual({ kind: 'server', serverId: NAS })
  })

  it('只列曲目实际涉及的源——手上没有它家歌的源不该摆出来', () => {
    const plan = resolvePlaylistTargets([song('w', WY)], NAS, groups, caps({ [NAS]: true, [WY]: true }))

    expect(plan.sections.map(s => s.serverId)).toEqual([WY])
  })

  it('只读的智能歌单不列——它由服务器按规则生成，加不进去', () => {
    const plan = resolvePlaylistTargets([song('a', NAS)], NAS, groups, caps({ [NAS]: true }))

    expect(plan.sections[0].playlists.map(p => p.id)).toEqual(['n1'])
  })

  it('源不声明 playlistWrite 时不列它的歌单，默认动作退回本地', () => {
    const plan = resolvePlaylistTargets([song('w', WY)], NAS, groups, caps({ [NAS]: true, [WY]: false }))

    expect(plan.sections).toEqual([])
    expect(plan.defaultCreate).toEqual({ kind: 'local' })
  })

  it('曲目跨源：默认动作是本地混合歌单，而不是任何一个服务端歌单', () => {
    const plan = resolvePlaylistTargets(
      [song('a', NAS), song('w', WY)], NAS, groups, caps({ [NAS]: true, [WY]: true })
    )

    expect(plan.crossSource).toBe(true)
    expect(plan.singleSourceId).toBeNull()
    expect(plan.defaultCreate).toEqual({ kind: 'local' })
    // 分区仍然列出来（让人看见「本来能进哪些」），但界面上一律不可点
    expect(plan.sections.map(s => s.serverId)).toEqual([NAS, WY])
    expect(plan.sourceIds).toEqual([NAS, WY])
  })

  it('没带来源的旧数据算作主库，不会被当成第二个源', () => {
    const legacy = { ...song('x', NAS), serverId: '' } as Song
    const plan = resolvePlaylistTargets([legacy, song('a', NAS)], NAS, groups, caps({ [NAS]: true }))

    expect(plan.sourceIds).toEqual([NAS])
    expect(plan.crossSource).toBe(false)
  })

  it('分区沿用该源查询自己的加载/失败状态，不等别的源', () => {
    const loading: SourceQueryGroup<Playlist[]> = {
      serverId: WY, name: WY, type: 'plugin', status: 'loading',
    }
    const plan = resolvePlaylistTargets([song('w', WY)], NAS, [loading], caps({ [WY]: true }))

    expect(plan.sections[0].status).toBe('loading')
    expect(plan.sections[0].playlists).toEqual([])
  })

  it('一首歌都没选时什么都不列，默认动作是本地', () => {
    const plan = resolvePlaylistTargets([], NAS, groups, caps({ [NAS]: true }))

    expect(plan.sourceIds).toEqual([])
    expect(plan.sections).toEqual([])
    expect(plan.defaultCreate).toEqual({ kind: 'local' })
  })
})
