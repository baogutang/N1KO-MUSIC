/** 复审 B4：心形入口按 favorites 能力出现 */
import { describe, expect, it } from 'vitest'
import { sourceSupportsFavorites } from '@/services/heartCapability'
import type { SourceCapabilities } from '@/api/types'

const capsOf = (favorites: boolean): Record<string, SourceCapabilities> => ({
  nas: { search: true, album: true, artist: true, lyrics: true, userPlaylists: true, favorites, playlistWrite: false, topLists: false, recommendSheets: false, recommendSongs: false, importSheet: false, libraryBrowse: true, radio: false },
  wy: { search: true, album: true, artist: true, lyrics: true, userPlaylists: true, favorites: false, playlistWrite: true, topLists: true, recommendSheets: true, recommendSongs: true, importSheet: true, libraryBrowse: false, radio: false },
})

describe('sourceSupportsFavorites（B4）', () => {
  it('声明 favorites 的源（NAS）给入口；没声明的插件源（QQ 音乐 manifest 无此能力）不给', () => {
    const caps = capsOf(true)
    expect(sourceSupportsFavorites(caps, 'nas')).toBe(true)
    expect(sourceSupportsFavorites(caps, 'wy')).toBe(false)
  })

  it('caps 缺失 / serverId 缺失一律不给（宁可少给不误给）', () => {
    expect(sourceSupportsFavorites(undefined, 'nas')).toBe(false)
    expect(sourceSupportsFavorites({}, 'nas')).toBe(false)
    expect(sourceSupportsFavorites(capsOf(true), undefined)).toBe(false)
    expect(sourceSupportsFavorites(capsOf(true), null)).toBe(false)
  })
})
