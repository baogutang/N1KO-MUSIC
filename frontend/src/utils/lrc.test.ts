/**
 * 阶段 4.2 回归：LRC 解析的唯一实现（F11）。
 *
 * 合并前两套解析器的全部已知行为：整秒时间戳、多时间标签两种形态、
 * [offset:] 应用、逐字标签剥离、元数据过滤、按时间排序。
 */
import { describe, expect, it } from 'vitest'
import { parseLrc, parseWordTags } from '@/utils/lrc'
import type { LyricLine } from '@/api/types'

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

/** 约定：words 的 text 直接拼接、收首尾空白、连续空白压成一个，等于行的 text */
function joinWords(line: LyricLine): string {
  return (line.words ?? []).map(w => w.text).join('').replace(/\s{2,}/g, ' ').trim()
}

describe('逐字标签 <mm:ss.xxx>（增强 LRC / A2）解析成 words', () => {
  it('正常逐字行：time、duration、词尾空格、text 拼接约定', () => {
    const [line] = parseLrc('[00:12.340]<00:12.340>He <00:12.640>made <00:12.900>my <00:13.100>heart<00:13.600>')
    expect(line.time).toBe(12_340)
    expect(line.text).toBe('He made my heart')
    expect(line.words).toEqual([
      { time: 12_340, duration: 300, text: 'He ' },
      { time: 12_640, duration: 260, text: 'made ' },
      { time: 12_900, duration: 200, text: 'my ' },
      { time: 13_100, duration: 500, text: 'heart' },
    ])
    expect(joinWords(line)).toBe(line.text)
  })

  it('中文逐字（无空格），两位小数精度', () => {
    const [line] = parseLrc('[01:02.50]<01:02.50>你<01:02.80>好<01:03.10>呀<01:03.50>')
    expect(line.text).toBe('你好呀')
    expect(line.words).toEqual([
      { time: 62_500, duration: 300, text: '你' },
      { time: 62_800, duration: 300, text: '好' },
      { time: 63_100, duration: 400, text: '呀' },
    ])
    expect(joinWords(line)).toBe(line.text)
  })

  it('结束标记：行尾后面没有文字的标签是最后一个词的结束时间，不生成空词', () => {
    const [line] = parseLrc('[00:01.000]<00:01.000>a <00:01.500>b<00:04.000>  ')
    expect(line.words).toHaveLength(2)
    expect(line.words?.[1]).toEqual({ time: 1_500, duration: 2_500, text: 'b' })
  })

  it('没有结束标记：按下一行补时长，封顶 2000、下限 200；没有下一行用 1000', () => {
    const lines = parseLrc([
      '[00:10.000]<00:10.000>a <00:10.500>b', // 下一行 20s → 封顶 2000
      '[00:20.000]<00:20.000>c <00:20.900>d', // 下一行 21s → 100 → 下限 200
      '[00:21.000]<00:21.000>e <00:21.200>f', // 下一行 22s → 800
      '[00:22.000]<00:22.000>g', //              没有下一行 → 1000
    ].join('\n'))
    const lastDurations = lines.map(l => l.words?.[l.words.length - 1].duration)
    expect(lastDurations).toEqual([2000, 200, 800, 1000])
  })

  it('没有结束标记时「下一行」跳过同一时间戳的翻译行', () => {
    const lines = parseLrc('[00:10.000]<00:10.000>hi\n[00:10.000]你好\n[00:11.000]next')
    const word = lines.find(l => l.words)?.words?.[0]
    expect(word?.duration).toBe(1000)
  })

  it('[offset:] 对 words 的 time 与行的 time 一样生效，时长不变', () => {
    const [line] = parseLrc('[offset:500]\n[00:10.000]<00:10.000>a <00:10.400>b<00:11.000>')
    expect(line.time).toBe(9_500)
    expect(line.words).toEqual([
      { time: 9_500, duration: 400, text: 'a ' },
      { time: 9_900, duration: 600, text: 'b' },
    ])
  })

  it('首个标签前的文字按行开始时间计时；标签之间只有空白时并进前一个词', () => {
    const [line] = parseLrc('[00:05.000]Oh <00:05.400>yeah <00:05.800> <00:06.000>go<00:06.500>')
    expect(line.text).toBe('Oh yeah go')
    expect(line.words?.map(w => [w.time, w.text])).toEqual([
      [5_000, 'Oh '],
      [5_400, 'yeah  '],
      [6_000, 'go'],
    ])
    expect(joinWords(line)).toBe(line.text)
  })

  it('没有 <> 的普通行不带 words 字段', () => {
    const [line] = parseLrc('[00:01.00]普通行')
    expect('words' in line).toBe(false)
  })

  it('畸形标签不崩，退回整行（有文字、无 words）', () => {
    // 时间倒退
    const [back] = parseLrc('[00:01.000]<00:01.000>a<00:00.500>b')
    expect(back).toEqual({ time: 1_000, text: 'ab' })
    expect('words' in back).toBe(false)
    // 半截标签
    const [broken] = parseLrc('[00:01.000]<00:01.000>a <00:01.5 b')
    expect('words' in broken).toBe(false)
    expect(broken.time).toBe(1_000)
    // 结束标记早于最后一个词
    const [badEnd] = parseLrc('[00:01.000]<00:01.000>a <00:02.000>b<00:01.500>')
    expect(badEnd).toEqual({ time: 1_000, text: 'a b' })
    // 只有标签没有文字：照旧整行丢弃
    expect(parseLrc('[00:01.000]<00:01.000><00:02.000>')).toEqual([])
  })

  it('重复副歌简写 + 逐字标签：照旧各生成一行，不出 words，不崩', () => {
    const lines = parseLrc('[00:10.00][01:20.00]<00:10.00>副<00:10.50>歌')
    expect(lines).toEqual([
      { time: 10_000, text: '副歌' },
      { time: 80_000, text: '副歌' },
    ])
    expect(lines.every(l => !('words' in l))).toBe(true)
  })
})

describe('parseWordTags（给适配器用）', () => {
  it('解析出干净文本与 words，最后一个词按 nextLineTimeMs 补时长', () => {
    expect(parseWordTags('<00:01.000>a <00:01.300>b', 1_000, 2_000)).toEqual({
      text: 'a b',
      words: [
        { time: 1_000, duration: 300, text: 'a ' },
        { time: 1_300, duration: 700, text: 'b' },
      ],
    })
  })

  it('没有逐字标签：只给文本，不带 words', () => {
    const result = parseWordTags('  plain   text ', 0)
    expect(result).toEqual({ text: 'plain text' })
    expect('words' in result).toBe(false)
  })

  it('畸形标签：只给干净文本', () => {
    expect(parseWordTags('<00:02.000>a<00:01.000>b', 2_000)).toEqual({ text: 'ab' })
  })
})
