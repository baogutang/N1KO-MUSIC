/**
 * @vitest-environment happy-dom
 *
 * 缓存键的音源归属（B7）与查询开关（B8）。
 *
 * B7 钉的是那个「收藏成功了列表却不动」的 bug：同一个源在缓存里有两种键头，
 * 单源页面走 `serverKey()`（设了库范围时是 `id@scope`），按源分节的聚合查询
 * 走裸 `serverId`。前缀匹配只能命中其中一种。
 */

import { describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import {
  queryEnabled,
  queryKeyBelongsToServer,
  sourceFamilyFilter,
  sourceScopeFilter,
} from './useServerQueries'

const NAS = 'nas'

describe('queryKeyBelongsToServer', () => {
  it('裸 serverId 认', () => {
    expect(queryKeyBelongsToServer(NAS, NAS)).toBe(true)
  })

  it('带库范围的 `serverId@scope` 也认——这一半此前从没被失效过', () => {
    expect(queryKeyBelongsToServer(`${NAS}@folder-3`, NAS)).toBe(true)
  })

  it('别的源不认，前缀相同的源名也不认', () => {
    expect(queryKeyBelongsToServer('wy', NAS)).toBe(false)
    // `nas2` 不是 `nas` 的库范围，只是名字碰巧以它开头
    expect(queryKeyBelongsToServer('nas2', NAS)).toBe(false)
    expect(queryKeyBelongsToServer('nas2@f1', NAS)).toBe(false)
  })

  it('非字符串键头与空 serverId 一律不认', () => {
    expect(queryKeyBelongsToServer(undefined, NAS)).toBe(false)
    expect(queryKeyBelongsToServer(123, NAS)).toBe(false)
    expect(queryKeyBelongsToServer(NAS, '')).toBe(false)
  })
})

describe('sourceFamilyFilter（收藏失效用的谓词）', () => {
  /** 三份收藏缓存：分节视图（裸键）、设了库范围的单源视图、另一个源 */
  function seed() {
    const qc = new QueryClient()
    qc.setQueryData([NAS, 'starred'], { songs: [] })
    qc.setQueryData([`${NAS}@folder-3`, 'starred'], { songs: [] })
    qc.setQueryData([NAS, 'songs', 'all', {}], { items: [] })
    qc.setQueryData(['wy', 'starred'], { songs: [] })
    return qc
  }

  it('同一次失效同时命中裸键与带库范围的键', () => {
    const qc = seed()

    qc.invalidateQueries({ predicate: sourceFamilyFilter(NAS, 'starred') })

    const stale = qc.getQueryCache().getAll().filter(q => q.state.isInvalidated)
    expect(stale.map(q => q.queryKey)).toEqual(
      expect.arrayContaining([[NAS, 'starred'], [`${NAS}@folder-3`, 'starred']])
    )
    expect(stale).toHaveLength(2)
  })

  it('不误伤别的源，也不误伤同源的其它家族', () => {
    const qc = seed()

    qc.invalidateQueries({ predicate: sourceFamilyFilter(NAS, 'starred') })

    expect(qc.getQueryCache().find({ queryKey: ['wy', 'starred'] })?.state.isInvalidated).toBe(false)
    expect(
      qc.getQueryCache().find({ queryKey: [NAS, 'songs', 'all', {}] })?.state.isInvalidated
    ).toBe(false)
  })

  it('sourceScopeFilter 覆盖该源的所有家族（乐观更新就地改写用它）', () => {
    const qc = seed()

    qc.setQueriesData({ predicate: sourceScopeFilter(NAS) }, () => ({ patched: true }))

    expect(qc.getQueryData([NAS, 'starred'])).toEqual({ patched: true })
    expect(qc.getQueryData([`${NAS}@folder-3`, 'starred'])).toEqual({ patched: true })
    expect(qc.getQueryData([NAS, 'songs', 'all', {}])).toEqual({ patched: true })
    expect(qc.getQueryData(['wy', 'starred'])).toEqual({ songs: [] })
  })
})

describe('queryEnabled（B8：不可浏览的主库不该白跑查询）', () => {
  it('缺省 true：旧调用方行为不变', () => {
    expect(queryEnabled(undefined, true)).toBe(true)
  })

  it('页面显式传 false 时不发，哪怕适配器在册', () => {
    expect(queryEnabled(false, true)).toBe(false)
  })

  it('适配器不在册时同样不发', () => {
    expect(queryEnabled(true, false)).toBe(false)
    expect(queryEnabled(undefined, false)).toBe(false)
  })
})
