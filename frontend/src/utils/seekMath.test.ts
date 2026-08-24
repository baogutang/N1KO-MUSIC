import { describe, expect, it } from 'vitest'
import { computeSeekTarget, SEEK_STEP_SEC } from './seekMath'

/**
 * 裸 ←/→ 的曲内定位。此前只有 ⌘←/⌘→（上/下一首），
 * 想跳过一段前奏或回听一句只能用鼠标拖进度条。
 */
describe('曲内快进快退的边界', () => {
  it('正常前进后退各 10 秒', () => {
    expect(computeSeekTarget(60, SEEK_STEP_SEC, 300)).toBe(70)
    expect(computeSeekTarget(60, -SEEK_STEP_SEC, 300)).toBe(50)
  })

  it('开头附近后退不会退成负数', () => {
    // Howler 收到负值会算出 NaN，进度条直接坏掉
    expect(computeSeekTarget(3, -SEEK_STEP_SEC, 300)).toBe(0)
  })

  it('结尾附近快进留 1 秒余量，不会顶成「已播完」', () => {
    // 顶到 duration 本身等于触发切歌，而用户按的是快进不是下一首
    expect(computeSeekTarget(295, SEEK_STEP_SEC, 300)).toBe(299)
    expect(computeSeekTarget(299, SEEK_STEP_SEC, 300)).toBe(299)
  })

  it('时长未知时不设上限，交给播放器自己夹', () => {
    // 流媒体元数据还没到的那几秒，duration 是 0
    expect(computeSeekTarget(60, SEEK_STEP_SEC, 0)).toBe(70)
    expect(computeSeekTarget(3, -SEEK_STEP_SEC, 0)).toBe(0)
  })

  it('极短音轨也不会算出负数上限', () => {
    expect(computeSeekTarget(0, SEEK_STEP_SEC, 0.5)).toBe(0)
  })
})
