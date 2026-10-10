/**
 * 阶段 1.4 回归：首页音源失败不再整块静默消失。
 *
 * 用户真实路径：一个音源挂了（榜单 / 每日推荐 / 推荐歌单任一区块），
 * 首页该区块仍应渲染，失败的源给一行带重试的说明，而不是 filter 掉
 * 之后整节消失（用户看到的是「这个源好像没连过」）。
 */
import { describe, expect, it } from 'vitest'
import { splitGroups } from '@/components/sources/SourceShelves'
import type { SourceQueryGroup } from '@/hooks/useSourceQueries'

function group(serverId: string, patch: Partial<SourceQueryGroup<string[]>>): SourceQueryGroup<string[]> {
  return { serverId, status: 'success', ...patch } as SourceQueryGroup<string[]>
}

describe('splitGroups（阶段 1.4：失败可见）', () => {
  it('失败的源进 failed：不会被静默 filter 掉', () => {
    const { good, failed, loading } = splitGroups([
      group('srv-a', { status: 'error', error: 'boom' }),
      group('srv-b', { status: 'success', data: ['x'] }),
    ])

    expect(failed.map(g => g.serverId)).toEqual(['srv-a'])
    expect(failed[0].error).toBe('boom')
    expect(good.map(g => g.serverId)).toEqual(['srv-b'])
    expect(loading).toEqual([])
  })

  it('加载中的源进 loading：整节无内容时可以占骨架行', () => {
    const { loading } = splitGroups([group('srv-a', { status: 'loading' })])
    expect(loading.map(g => g.serverId)).toEqual(['srv-a'])
  })

  it('成功但数据为空不算失败（未登录的插件音源就是这么表现的）', () => {
    const { good, failed, loading } = splitGroups([
      group('srv-a', { status: 'success', data: [] }),
    ])
    expect(failed).toEqual([])
    expect(loading).toEqual([])
    // 有 data（空数组）仍算 good，由调用方决定要不要展示
    expect(good.map(g => g.serverId)).toEqual(['srv-a'])
  })

  it('全部失败时三态仍可分辨：good 空、failed 有货', () => {
    const { good, failed } = splitGroups([
      group('srv-a', { status: 'error', error: 'x' }),
      group('srv-b', { status: 'error', error: 'y' }),
    ])
    expect(good).toEqual([])
    expect(failed).toHaveLength(2)
  })
})

describe('splitGroups 的 auth 态（阶段 2.3：登录过期 ≠ 加载失败）', () => {
  it('unauthorized 的失败进 auth 桶：出口是去登录，不是重试', () => {
    const { good, failed, auth } = splitGroups([
      group('srv-a', { status: 'error', errorCode: 'unauthorized', error: '过期' }),
      group('srv-b', { status: 'error', errorCode: 'network', error: '断网' }),
      group('srv-c', { status: 'success', data: ['x'] }),
    ])
    expect(auth.map(g => g.serverId)).toEqual(['srv-a'])
    expect(failed.map(g => g.serverId)).toEqual(['srv-b'])
    expect(good.map(g => g.serverId)).toEqual(['srv-c'])
  })
})

describe('插件源每日推荐的屏蔽过滤（复审 B1）', () => {
  it('合并前过 filterRecommendable：插件源缓存里屏蔽歌手的歌被滤掉', async () => {
    const { recommendationGroupsForMerge } = await import('@/components/sources/SourceShelves')
    const { useTasteStore } = await import('@/store/tasteStore')
    useTasteStore.setState({ mutedArtists: ['artista'] })

    const pluginGroup = {
      data: [
        { id: 'w1', title: '好歌', artist: '别的歌手', serverId: 'wy' },
        { id: 'w2', title: '屏蔽的歌', artist: 'Artist A', serverId: 'wy' },
      ],
    } as never
    // 主库为空：只验证插件源那一份
    const groups = recommendationGroupsForMerge([pluginGroup], [])
    expect(groups).toHaveLength(1)
    expect(groups[0].songs.map(s => (s as { id: string }).id)).toEqual(['w1'])

    useTasteStore.setState({ mutedArtists: [] })
  })
})

