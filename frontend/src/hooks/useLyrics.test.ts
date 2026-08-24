import { describe, expect, it } from 'vitest'
import { parseLrc } from './useLyrics'

/**
 * 时间标签的小数部分此前是必需的，于是整秒精度的 LRC（手写歌词和一些下载源
 * 就是这种）一行都匹配不上，整首静默退化成「无同步文本」——看得见字，
 * 但不会跟着歌走，而且没有任何报错提示哪里出了问题。
 */
describe('LRC 时间标签', () => {
  it('整秒时间戳 [mm:ss] 能解析', () => {
    const lines = parseLrc('[00:12]第一句\n[01:23]第二句')
    expect(lines).toHaveLength(2)
    expect(lines[0].time).toBe(12_000)
    expect(lines[1].time).toBe(83_000)
  })

  it('两位小数按厘秒算', () => {
    expect(parseLrc('[00:12.50]半秒后')[0].time).toBe(12_500)
  })

  it('三位小数按毫秒算', () => {
    expect(parseLrc('[00:12.501]毫秒')[0].time).toBe(12_501)
  })

  it('同一份歌词里混用两种精度也不出错', () => {
    const lines = parseLrc('[00:05]整秒\n[00:07.25]带小数\n[00:09]又整秒')
    expect(lines.map(l => l.time)).toEqual([5_000, 7_250, 9_000])
  })

  it('一行多个时间标签各自成行', () => {
    const lines = parseLrc('[00:10][00:20]副歌')
    expect(lines).toHaveLength(2)
    expect(lines.map(l => l.time)).toEqual([10_000, 20_000])
  })

  it('offset 标签对整秒时间戳同样生效', () => {
    // 正值表示歌词提前显示，即时间戳减去偏移
    expect(parseLrc('[offset:500]\n[00:10]提前半秒')[0].time).toBe(9_500)
  })
})
