/** 阶段 1.3：详情页地址必须带 ?src=，否则插件源 id 被拿去问主库 */
import { describe, expect, it } from 'vitest'
import { detailPath } from '@/utils/detailPath'

describe('detailPath（1.3：跳详情带源）', () => {
  it('有 serverId 时带 ?src=（含编码）', () => {
    expect(detailPath('artists', 'a1', 'wy')).toBe('/artists/a1?src=wy')
    expect(detailPath('songs', 's/1', 'nas')).toBe('/songs/s%2F1?src=nas')
  })
  it('无 serverId 时是纯路径（NAS 主库等本源数据）', () => {
    expect(detailPath('albums', 'al1')).toBe('/albums/al1')
    expect(detailPath('albums', 'al1', null)).toBe('/albums/al1')
  })
  it('缺 id 返回空串（调用处以此 no-op）', () => {
    expect(detailPath('songs', undefined, 'wy')).toBe('')
  })
})
