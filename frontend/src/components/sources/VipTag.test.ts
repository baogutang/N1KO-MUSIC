/**
 * 阶段 2.3 回归：VIP 标识抽成共用组件后的判定逻辑。
 * SongList / QueueDrawer / PlayerBar 三处出现的是同一枚标记、同一套判定。
 */
import { describe, expect, it } from 'vitest'
import { isVipSong } from '@/components/sources/VipTag'
import { groupStateStatus } from '@/components/sources/SourceGroupState'

describe('isVipSong', () => {
  it('顶层 vip 与 ext.vip 同等对待', () => {
    expect(isVipSong({ vip: true })).toBe(true)
    expect(isVipSong({ ext: { vip: true } })).toBe(true)
    expect(isVipSong({ vip: false, ext: {} })).toBe(false)
  })

  it('缺参/空值不炸（旧数据可能没有 ext）', () => {
    expect(isVipSong(undefined)).toBe(false)
    expect(isVipSong(null)).toBe(false)
  })
})

describe('groupStateStatus（阶段 2.3）', () => {
  it('unauthorized 的 error 映射成 auth 态，其余原样透传', () => {
    expect(groupStateStatus({ status: 'error', errorCode: 'unauthorized' })).toBe('auth')
    expect(groupStateStatus({ status: 'error', errorCode: 'network' })).toBe('error')
    expect(groupStateStatus({ status: 'error' })).toBe('error')
    expect(groupStateStatus({ status: 'loading' })).toBe('loading')
    expect(groupStateStatus({ status: 'success' })).toBe('success')
  })
})
