/**
 * adapter 面对的是不受信任的服务器 JSON：任何一处字段形态不合预期
 * 都不该让整个 mapSong 抛错——那会连带把整页曲目的渲染打断。
 */
import { describe, expect, it } from 'vitest'
import { mapSongExtras } from '@/api/adapters/subsonic'

describe('mapSongExtras 的健壮性', () => {
  it('contributors 里混入 null / 标量时不抛错，只跳过坏元素', () => {
    expect(() => mapSongExtras({ contributors: [null] })).not.toThrow()
    expect(() => mapSongExtras({ contributors: ['nope', 42, undefined] })).not.toThrow()

    const ext = mapSongExtras({
      contributors: [
        null,
        { role: 'composer', artist: { id: 'a1', name: '坂本龍一' } },
        'garbage',
        { role: 'producer', name: 'Someone' },
      ],
    })
    expect(ext?.contributors).toHaveLength(2)
    expect(ext?.contributors?.[0]).toEqual({
      role: 'composer', subRole: undefined, name: '坂本龍一', artistId: 'a1',
    })
  })

  it('contributors 的 artist 不是对象时退回顶层 name', () => {
    const ext = mapSongExtras({ contributors: [{ role: 'engineer', artist: 'x', name: 'Bob' }] })
    expect(ext?.contributors?.[0].name).toBe('Bob')
    expect(ext?.contributors?.[0].artistId).toBeUndefined()
  })

  it('replayGain 是字符串或缺字段时不产生 NaN', () => {
    expect(mapSongExtras({ replayGain: 'loud' })?.replayGain).toBeUndefined()
    const ext = mapSongExtras({ replayGain: { trackGain: -7.5, albumPeak: 0.98 } })
    expect(ext?.replayGain).toEqual({
      trackGain: -7.5, albumGain: undefined, trackPeak: undefined,
      albumPeak: 0.98, fallbackGain: undefined,
    })
  })

  it('没有任何扩展字段时返回 undefined，而不是空对象', () => {
    expect(mapSongExtras({ id: '1', title: 'x' })).toBeUndefined()
    expect(mapSongExtras({ contributors: [], moods: [], isrc: [] })).toBeUndefined()
  })

  it('数值字段为 0 或非数字时不写入', () => {
    // Navidrome 对有损文件返回 bitDepth: 0，不该显示成 "0bit"
    const ext = mapSongExtras({ bitDepth: 0, samplingRate: 44100, channelCount: 'two' })
    expect(ext?.bitDepth).toBeUndefined()
    expect(ext?.samplingRate).toBe(44100)
    expect(ext?.channelCount).toBeUndefined()
  })
})
