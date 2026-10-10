/**
 * 阶段 4.2 回归：LRC 解析的唯一实现（F11）。
 *
 * 合并前两套解析器的全部已知行为：整秒时间戳、多时间标签两种形态、
 * [offset:] 应用、逐字标签剥离、元数据过滤、按时间排序。
 */
import { describe, expect, it } from 'vitest'
import { parseLrc } from '@/utils/lrc'

describe('parseLrc', () => {
  it('[00:12]第一句：文本里不得残留时间戳（任务书点名用例）', () => {
    const lines = parseLrc('[00:12]第一句\n[01:02.50]第二句')
    expect(lines.map(l => l.text)).toEqual(['第一句', '第二句'])
    expect(lines[0].time).toBe(12_000)
    expect(lines[1].time).toBe(62_500)
    for (const line of lines) {
      expect(line.text).not.toMatch(/\[?\d{1,3}:\d{1,2}/)
    }
  })

  it('四种小数精度都认：[mm:ss] / .x / .xx / .xxx', () => {
    const lines = parseLrc('[00:01]a\n[00:02.5]b\n[00:03.25]c\n[00:04.123]d')
    expect(lines.map(l => l.time)).toEqual([1000, 2500, 3250, 4123])
  })

  it('行首多时间标签（重复副歌简写）：每个标签各生成一行', () => {
    const lines = parseLrc('[00:10.00][01:20.00]副歌')
    expect(lines).toEqual([
      { time: 10_000, text: '副歌' },
      { time: 80_000, text: '副歌' },
    ])
  })

  it('内联逐字标签（卡拉OK）：只生成一行，时间取最早，<mm:ss.xx> 剥离', () => {
    const lines = parseLrc('有[00:12.00]<00:12.00>一<00:12.40>点[00:13.00]')
    expect(lines).toEqual([{ time: 12_000, text: '有一点' }])
  })

  it('[offset:] 被应用而不是丢弃：正值提前（时间戳减去偏移）', () => {
    const lines = parseLrc('[offset:500]\n[00:10.00]词')
    expect(lines).toEqual([{ time: 9_500, text: '词' }])
    // 提前到负数时钳到 0
    expect(parseLrc('[offset:2000]\n[00:01.00]词')[0].time).toBe(0)
  })

  it('元数据标签过滤，不出现在输出里', () => {
    const lines = parseLrc('[ti:标题]\n[ar:歌手]\n[00:01.00]正词')
    expect(lines).toEqual([{ time: 1000, text: '正词' }])
  })

  it('无时间戳的纯文本行保留（time 0），排序稳定', () => {
    const lines = parseLrc('没有时间戳的行\n[00:05.00]带时间的行')
    expect(lines[0]).toEqual({ time: 0, text: '没有时间戳的行' })
    expect(lines[1].time).toBe(5_000)
  })

  it('空文本与纯空白返回空数组', () => {
    expect(parseLrc('')).toEqual([])
    expect(parseLrc('  \n  ')).toEqual([])
  })
})

describe('offset 全局生效（复审 B7）', () => {
  it('offset 标签在文件末尾也作用于全部行（旧实现只影响其后的行）', () => {
    const lines = parseLrc('[00:10.00]第一句\n[00:20.00]第二句\n[offset:500]')
    expect(lines.map(l => l.time)).toEqual([9_500, 19_500])
  })

  it('多个 offset 取第一个（与旧两套实现一致）', () => {
    const lines = parseLrc('[offset:1000]\n[offset:2000]\n[00:10.00]词')
    expect(lines[0].time).toBe(9_000)
  })
})
