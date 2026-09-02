/**
 * useSourceQueries 纯函数层单测（PLAN 2.1）：
 * 音源引用顺序、默认播放优先级、分组状态 zip。
 * hooks 本体是薄封装（useQueries 组合），行为由 2.2 的搜索页 E2E 覆盖。
 */

import { describe, expect, it } from 'vitest'
import type { ServerConfig } from '@/api/types'
import {
  collectSourceRefs,
  defaultPriorityOrder,
  zipQueryResults,
  type SourceRef,
} from './useSourceQueries'

function server(partial: Partial<ServerConfig> & { id: string }): ServerConfig {
  return {
    name: partial.id,
    type: 'subsonic',
    url: '',
    username: '',
    token: '',
    isActive: false,
    createdAt: 0,
    ...partial,
  }
}

const nas = server({ id: 'nas', type: 'subsonic' })
const nas2 = server({ id: 'nas2', type: 'jellyfin' })
const wy = server({ id: 'wy', type: 'plugin', pluginId: 'netease' })
const qq = server({ id: 'qq', type: 'plugin', pluginId: 'qqmusic' })

describe('collectSourceRefs', () => {
  it('主库排最前，其余按连接顺序', () => {
    const refs = collectSourceRefs([nas, nas2, wy], ['nas2', 'wy', 'nas'], 'wy')
    expect(refs.map(r => r.serverId)).toEqual(['wy', 'nas2', 'nas'])
  })

  it('未连接的服务器不出现；连接顺序里的未知 id 被忽略', () => {
    const refs = collectSourceRefs([nas, wy], ['ghost', 'nas'], null)
    expect(refs.map(r => r.serverId)).toEqual(['nas'])
  })

  it('插件源带 pluginId，NAS 源不带', () => {
    const refs = collectSourceRefs([nas, wy], ['nas', 'wy'], null)
    expect(refs[1].pluginId).toBe('netease')
    expect(refs[0].pluginId).toBeUndefined()
  })
})

describe('defaultPriorityOrder（播放优先级默认序）', () => {
  it('NAS 在前、插件在后（PLAN §2.10 默认 NAS 优先）', () => {
    const refs = collectSourceRefs([nas, wy, qq, nas2], ['wy', 'nas', 'qq', 'nas2'], 'wy')
    const ordered = defaultPriorityOrder(refs)
    expect(ordered.map(r => r.type)).toEqual(['subsonic', 'jellyfin', 'plugin', 'plugin'])
  })

  it('只有插件源时（无 NAS 用户）保持主库在前的相对顺序', () => {
    const refs: SourceRef[] = [
      { serverId: 'qq', name: 'qq', type: 'plugin', pluginId: 'qqmusic' },
      { serverId: 'wy', name: 'wy', type: 'plugin', pluginId: 'netease' },
    ]
    expect(defaultPriorityOrder(refs).map(r => r.serverId)).toEqual(['qq', 'wy'])
  })
})

describe('zipQueryResults', () => {
  const refs: SourceRef[] = [
    { serverId: 'nas', name: 'nas', type: 'subsonic' },
    { serverId: 'wy', name: 'wy', type: 'plugin', pluginId: 'netease' },
  ]

  it('pending → loading；success 带数据；error 带 message', () => {
    const zipped = zipQueryResults<number>(refs, [
      { isPending: false, isSuccess: true, data: 42 },
      { isPending: false, isSuccess: false, error: new Error('boom') },
    ])
    // 第三条源没有对应 query（未声明能力）时按 loading
    const third = zipQueryResults(refs.slice(0, 1), [])[0]
    expect(zipped[0]).toMatchObject({ serverId: 'nas', status: 'success', data: 42 })
    expect(zipped[1]).toMatchObject({ serverId: 'wy', status: 'error', error: 'boom' })
    expect(third.status).toBe('loading')
  })

  it('非 Error 的失败对象降级成字符串', () => {
    const zipped = zipQueryResults(refs, [
      { isPending: true },
      { isPending: false, isSuccess: false, error: 'raw string' },
    ])
    expect(zipped[1].error).toBe('raw string')
  })
})
