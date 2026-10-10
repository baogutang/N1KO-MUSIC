/**
 * LRC 歌词解析的唯一实现（阶段 4.2，F11 到此关闭）。
 *
 * 此前有两套解析器各自漂移：适配器那套不认整秒时间戳 [mm:ss]、useLyrics 那套
 * 把卡拉OK逐字标签展开成重复行；两套对 [offset:] 的处理也各写各的。
 * 这里合并两套的长处：
 * - 时间戳支持 [mm:ss] / [mm:ss.x] / [mm:ss.xx] / [mm:ss.xxx]；
 * - 多时间标签一行：行首连续标签（重复副歌简写）按标签各生成一行；
 *   内联在文字间的标签（卡拉OK逐字）只生成一行、时间取最早；
 * - [offset:±毫秒] 应用而不是丢弃：LRC 约定正值表示提前显示（时间戳减去偏移）；
 * - 逐字标签 <mm:ss.xx>（A2 增强）从文本里剥离；
 * - 翻译行（同一时间戳的另一种语言）作为普通行保留，顺序交给调用方；
 * - 元数据标签（[ar:] [ti:] 等）过滤；
 * - 输出按时间排序，时间戳不早于 0。
 */

import type { LyricLine } from '@/api/types'

/** 时间标签：[mm:ss] / [mm:ss.x] / [mm:ss.xx] / [mm:ss.xxx]（x 逐字也用一个尺度） */
const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:\.(\d{1,3}))?\]/g
/** 行首的连续时间标签（重复副歌简写）：「[t1][t2]歌词」 */
const LEADING_TAGS = /^(?:\[\d{1,3}:\d{1,2}(?:\.\d{1,3})?\]\s*)+/
/** 逐字时间标签（A2 增强）：<mm:ss.xx>，只剥不计时 */
const WORD_TAG = /<\d{1,3}:\d{1,2}(?:\.\d{1,3})?>/g
/** [offset:±毫秒] */
const OFFSET_TAG = /^\[offset:\s*([+-]?\d+)\s*]$/i
/**
 * LRC 元数据标签：[tag] 或 [tag:value]。
 * 注意 [^\]] 的反斜杠不可省：JS 里 [^]] 会被解析成别的，多字符值会漏过滤。
 */
const META_TAG =
  /^\[(?:id|ar|ti|al|by|hash|sign|qq|total|offset|lang|length|desc|album|artist|title|author|maker|version|re|ve|encoding|file|rcv|usr|uid|msid|msas|mscv|msp|msu|cap|cta|cla|cla2|com|tag|instrument|role|track|lrcx)\s*(?::[^\]]*)?]$/i

function tagToMs(min: string, sec: string, frac: string | undefined): number {
  const ms = frac === undefined
    ? 0
    : frac.length === 1 ? parseInt(frac, 10) * 100
    : frac.length === 2 ? parseInt(frac, 10) * 10
    : parseInt(frac, 10)
  return parseInt(min, 10) * 60_000 + parseInt(sec, 10) * 1000 + ms
}

export function parseLrc(text: string): LyricLine[] {
  if (!text?.trim()) return []

  const lines: LyricLine[] = []
  /*
   * [offset:] 全局生效（复审 B7）：旧两套解析器都是先扫全取 offset 再解析；
   * 逐行版只在标签**之后**的行上应用——标签写在文件尾时整首都不生效。
   * 先扫全文取第一个 offset，解析时统一应用。
   */
  let lrcOffset = 0
  for (const row of text.split('\n')) {
    const m = OFFSET_TAG.exec(row.trim())
    if (m) {
      lrcOffset = parseInt(m[1], 10)
      break
    }
  }

  for (const row of text.split('\n')) {
    const trimmed = row.trim()
    if (!trimmed) continue

    if (OFFSET_TAG.test(trimmed)) continue
    if (META_TAG.test(trimmed)) continue

    const times: number[] = []
    TIME_TAG.lastIndex = 0
    for (let m: RegExpExecArray | null; (m = TIME_TAG.exec(trimmed)) !== null; ) {
      times.push(tagToMs(m[1], m[2], m[3]))
    }

    // 文本 = 去掉全部时间标签与逐字标签后的剩余
    const lyricText = trimmed.replace(TIME_TAG, '').replace(WORD_TAG, '').replace(/\s{2,}/g, ' ').trim()
    if (!lyricText) continue

    if (times.length === 0) {
      // 无时间戳的纯文本行（翻译行同样落在这里之后按时间排序）
      lines.push({ time: 0, text: lyricText })
      continue
    }

    // 行首标签数与总数一致 → 重复副歌简写，各生成一行；
    // 否则是卡拉OK内联标签 → 一行，时间取最早。
    const leadingCount = LEADING_TAGS.exec(trimmed)?.[0].match(/\[/g)?.length ?? 0
    if (leadingCount === times.length) {
      for (const time of times) {
        lines.push({ time: Math.max(0, time - lrcOffset), text: lyricText })
      }
    } else {
      lines.push({ time: Math.max(0, Math.min(...times) - lrcOffset), text: lyricText })
    }
  }

  return lines.sort((a, b) => a.time - b.time)
}
