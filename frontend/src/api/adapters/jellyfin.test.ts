import { describe, expect, it } from 'vitest'
import { JellyfinAdapter } from '@/api/adapters/jellyfin'

/**
 * 从歌单移除：调用方传的是下标（沿用 Subsonic 的语义），
 * 而 Jellyfin 的 EntryIds 要的是 PlaylistItemId——条目自己的 GUID。
 *
 * 此前把下标当 GUID 发过去：匹配不到任何条目，服务端原样保存并返回 204，
 * 界面提示「已移除」而歌一直都在。这是最坏的一种失败——它撒谎。
 */
describe('Jellyfin 从歌单移除', () => {
  function makeAdapter(items: Array<{ PlaylistItemId: string }>) {
    const calls: Array<{ url: string; params: Record<string, unknown> }> = []
    const adapter = new JellyfinAdapter({
      url: 'https://jf.test', token: 't', userId: 'user1',
    })
    ;(adapter as unknown as { client: unknown }).client = {
      get: async () => ({ data: { Items: items } }),
      delete: async (url: string, config: { params: Record<string, unknown> }) => {
        calls.push({ url, params: config.params })
        return { data: null }
      },
    }
    return { adapter, calls }
  }

  const items = [
    { PlaylistItemId: 'guid-a' },
    { PlaylistItemId: 'guid-b' },
    { PlaylistItemId: 'guid-c' },
  ]

  it('把下标翻译成 PlaylistItemId，而不是原样发下标', async () => {
    const { adapter, calls } = makeAdapter(items)
    await adapter.removeSongsFromPlaylist('pl1', [1])
    expect(calls).toHaveLength(1)
    expect(calls[0].params.EntryIds).toBe('guid-b')
    // 关键：不能是 "1"
    expect(calls[0].params.EntryIds).not.toBe('1')
  })

  it('一次删多首时按下标从大到小，避免删完前面的让后面全部前移', async () => {
    const { adapter, calls } = makeAdapter(items)
    await adapter.removeSongsFromPlaylist('pl1', [0, 2])
    expect(calls[0].params.EntryIds).toBe('guid-c,guid-a')
  })

  it('下标越界时抛错，而不是静默返回让界面谎称已删除', async () => {
    const { adapter, calls } = makeAdapter(items)
    await expect(adapter.removeSongsFromPlaylist('pl1', [99])).rejects.toThrow()
    expect(calls).toHaveLength(0)
  })

  it('空下标列表不发请求', async () => {
    const { adapter, calls } = makeAdapter(items)
    await adapter.removeSongsFromPlaylist('pl1', [])
    expect(calls).toHaveLength(0)
  })
})
