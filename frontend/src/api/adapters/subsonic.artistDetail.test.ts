/**
 * 歌手详情的「全部歌曲」是逐张专辑 /getAlbum 聚合出来的。此前只取前 40 张专辑的曲目，
 * 专辑一多，页头的曲目数和「播放全部」都是残的；现在取到更高的上限，
 * 封顶只为防止「Various Artists」这类几千张专辑的条目一打开页面就打出几千个请求。
 */
import { describe, expect, it } from 'vitest'
import { MAX_ARTIST_ALBUM_FETCH, SubsonicAdapter } from '@/api/adapters/subsonic'

function makeAdapter(albumCount: number) {
  const albumCalls: string[] = []
  const adapter = new SubsonicAdapter({
    url: 'https://example.test', username: 'u', token: 't', salt: 's', serverId: 'srv-a',
  })
  ;(adapter as unknown as { client: unknown }).client = {
    get: async (endpoint: string, config: { params: Record<string, unknown> }) => {
      const body = (extra: Record<string, unknown>) => ({
        data: { 'subsonic-response': { status: 'ok', ...extra } },
      })
      if (endpoint === '/getArtist') {
        return body({
          artist: {
            id: 'ar1', name: '歌手甲',
            album: Array.from({ length: albumCount }, (_, i) => ({ id: `al${i}`, name: `专辑${i}` })),
          },
        })
      }
      if (endpoint === '/getArtistInfo2') return body({ artistInfo2: {} })
      if (endpoint === '/getTopSongs') return body({ topSongs: {} })
      if (endpoint === '/getAlbum') {
        const id = String(config.params.id)
        albumCalls.push(id)
        return body({ album: { id, name: id, song: [{ id: `${id}-s1`, title: 't' }, { id: `${id}-s2`, title: 't' }] } })
      }
      throw new Error(`unexpected ${endpoint}`)
    },
  }
  return { adapter, albumCalls }
}

describe('Subsonic getArtistDetail：全部歌曲取全', () => {
  it('120 张专辑（超过旧上限 40）：每张专辑的曲目都在，按专辑顺序', async () => {
    const { adapter, albumCalls } = makeAdapter(120)
    const detail = await adapter.getArtistDetail('ar1')
    expect(detail.albums).toHaveLength(120)
    expect(albumCalls).toHaveLength(120)
    expect(detail.songs).toHaveLength(240)
    expect(detail.songs![0].id).toBe('al0-s1')
    expect(detail.songs!.at(-1)!.id).toBe('al119-s2')
  })

  it('专辑多到离谱：只预取到上限，专辑列表本身仍是全的', async () => {
    const { adapter, albumCalls } = makeAdapter(MAX_ARTIST_ALBUM_FETCH + 50)
    const detail = await adapter.getArtistDetail('ar1')
    expect(detail.albums).toHaveLength(MAX_ARTIST_ALBUM_FETCH + 50)
    expect(albumCalls).toHaveLength(MAX_ARTIST_ALBUM_FETCH)
  })
})
