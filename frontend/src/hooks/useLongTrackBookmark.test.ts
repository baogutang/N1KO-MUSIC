import { describe, expect, it } from 'vitest'
import { isLongTrack, LONG_TRACK_SECONDS } from '@/hooks/useLongTrackBookmark'

describe('长音轨判定', () => {
  it('只有 20 分钟以上才算长音轨', () => {
    // 给三分钟的歌存断点只会把书签列表塞满噪音
    expect(isLongTrack(180)).toBe(false)
    expect(isLongTrack(LONG_TRACK_SECONDS - 1)).toBe(false)
    expect(isLongTrack(LONG_TRACK_SECONDS)).toBe(true)
    expect(isLongTrack(70 * 60)).toBe(true)
  })

  it('时长缺失时不算长音轨', () => {
    expect(isLongTrack(undefined)).toBe(false)
    expect(isLongTrack(0)).toBe(false)
  })
})
