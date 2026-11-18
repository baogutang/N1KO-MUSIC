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
 * - 逐字标签 <mm:ss.xx>（A2 增强）从文本里剥离；只有一个行首 [..] 标签的行
 *   再把逐字标签解析成 words（见 parseWordTags）；
 * - 翻译行（同一时间戳的另一种语言）作为普通行保留，顺序交给调用方；
 * - 元数据标签（[ar:] [ti:] 等）过滤；
 * - 输出按时间排序，时间戳不早于 0。
 */

import type { LyricLine, LyricWord } from '@/api/types'

/** 时间标签：[mm:ss] / [mm:ss.x] / [mm:ss.xx] / [mm:ss.xxx]（x 逐字也用一个尺度） */
const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:\.(\d{1,3}))?\]/g
/** 行首的连续时间标签（重复副歌简写）：「[t1][t2]歌词」 */
const LEADING_TAGS = /^(?:\[\d{1,3}:\d{1,2}(?:\.\d{1,3})?\]\s*)+/
/** 逐字时间标签（A2 增强）：<mm:ss.xx>，标的是它后面那段文字的开始时间 */
const WORD_TAG = /<(\d{1,3}):(\d{1,2})(?:\.(\d{1,3}))?>/g
/** 剥掉合法逐字标签后还残留的「像逐字标签」的片段：畸形标签，整行退回不出 words */
const BROKEN_WORD_TAG = /<\d{1,3}:\d/
/** 没有结束标记的最后一个词：时长取到下一行开始，但封顶 / 保底 */
const OPEN_END_MAX_MS = 2000
const OPEN_END_MIN_MS = 200
/** 没有下一行可参照时的最后一个词时长 */
const OPEN_END_FALLBACK_MS = 1000
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

/** 行文本的规整：收掉首尾空白、连续空白压成一个（words 拼接后按同一规则应等于它） */
function normalizeText(value: string): string {
  return value.replace(/\s{2,}/g, ' ').trim()
}

interface WordScan {
  text: string
  words?: LyricWord[]
  /** 最后一个词没有结束标记：时长要等知道下一行开始时间再补 */
  openEnd: boolean
}

/**
 * 逐字标签扫描（不处理 offset、不补开放结尾的时长）。
 * 任何畸形（残留半截标签、时间倒退）都只返回干净文本、不出 words。
 */
function scanWordTags(value: string, lineTimeMs: number): WordScan {
  const stripped = value.replace(WORD_TAG, '')
  const text = normalizeText(stripped)
  const tags = [...value.matchAll(WORD_TAG)].map(m => ({
    start: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length,
    time: tagToMs(m[1], m[2], m[3]),
  }))
  if (tags.length === 0 || !text || BROKEN_WORD_TAG.test(stripped)) return { text, openEnd: false }

  // 切段：首个标签之前的文字按行开始时间算，之后每段文字的开始时间是它前面那个标签
  const segments: Array<{ time: number; text: string }> = []
  const head = value.slice(0, tags[0].start)
  if (head.trim()) segments.push({ time: lineTimeMs, text: head })
  tags.forEach((tag, i) => {
    segments.push({ time: tag.time, text: value.slice(tag.end, i + 1 < tags.length ? tags[i + 1].start : value.length) })
  })

  // 行尾后面没有文字的标签是结束标记
  let endTime: number | undefined
  if (!segments[segments.length - 1].text.trim()) endTime = segments.pop()!.time

  const kept: Array<{ time: number; text: string }> = []
  for (const seg of segments) {
    if (kept.length && seg.time < kept[kept.length - 1].time) return { text, openEnd: false }
    if (seg.text.trim()) {
      kept.push({ ...seg })
    } else if (seg.text && kept.length) {
      // 两个标签之间只有空白：并进前一个词的词尾，保住词间空格
      kept[kept.length - 1].text += seg.text
    }
  }
  if (kept.length === 0) return { text, openEnd: false }
  const last = kept[kept.length - 1]
  if (endTime !== undefined && endTime < last.time) return { text, openEnd: false }

  const words: LyricWord[] = kept.map((seg, i) => ({
    time: seg.time,
    duration: i + 1 < kept.length
      ? Math.max(1, kept[i + 1].time - seg.time)
      : endTime !== undefined ? Math.max(1, endTime - seg.time) : 0,
    text: seg.text,
  }))
  return { text, words, openEnd: endTime === undefined }
}

/** 没有结束标记的最后一个词的时长：min(下一行开始 − 词开始, 2000)，下限 200；没有下一行用 1000 */
function openEndDuration(wordTime: number, nextLineTimeMs: number | undefined): number {
  if (nextLineTimeMs === undefined) return OPEN_END_FALLBACK_MS
  return Math.max(OPEN_END_MIN_MS, Math.min(nextLineTimeMs - wordTime, OPEN_END_MAX_MS))
}

/**
 * 解析一段可能带 <mm:ss.xx> 逐字标签的歌词文字（给适配器用，例如 OpenSubsonic
 * 结构化歌词的 value 里残留的增强 LRC 标签）。
 *
 * - lineTimeMs：行开始时间，首个标签之前若有文字，按它计时；
 * - nextLineTimeMs：下一行开始时间，用来补没有结束标记的最后一个词的时长；
 * - 返回的 time 与标签同一时间基准，offset 由调用方自己减。
 * 没有逐字标签或标签畸形时只返回干净文本，不带 words。
 */
export function parseWordTags(
  value: string,
  lineTimeMs: number,
  nextLineTimeMs?: number,
): { text: string; words?: LyricWord[] } {
  const scan = scanWordTags(value, lineTimeMs)
  if (!scan.words) return { text: scan.text }
  if (scan.openEnd) {
    const last = scan.words[scan.words.length - 1]
    last.duration = openEndDuration(last.time, nextLineTimeMs)
  }
  return { text: scan.text, words: scan.words }
}

export function parseLrc(text: string): LyricLine[] {
  if (!text?.trim()) return []

  const lines: LyricLine[] = []
  /** 最后一个词没有结束标记的行：排好序后按下一行开始时间补时长 */
  const openEndLines = new Set<LyricLine>()
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

    // 只有一个行首标签 → 普通行（可能带逐字标签）；
    // 行首标签数与总数一致 → 重复副歌简写，各生成一行（不出 words）；
    // 否则是卡拉OK内联标签 → 一行，时间取最早（不出 words）。
    const leading = LEADING_TAGS.exec(trimmed)?.[0] ?? ''
    const leadingCount = leading.match(/\[/g)?.length ?? 0
    if (leadingCount === 1 && times.length === 1) {
      // 单个行首标签：增强 LRC（A2）的逐字标签在这里解析成 words
      const line: LyricLine = { time: Math.max(0, times[0] - lrcOffset), text: lyricText }
      const scan = scanWordTags(trimmed.slice(leading.length), times[0])
      if (scan.words) {
        line.words = scan.words.map(w => ({ ...w, time: Math.max(0, w.time - lrcOffset) }))
        if (scan.openEnd) openEndLines.add(line)
      }
      lines.push(line)
    } else if (leadingCount === times.length) {
      for (const time of times) {
        lines.push({ time: Math.max(0, time - lrcOffset), text: lyricText })
      }
    } else {
      lines.push({ time: Math.max(0, Math.min(...times) - lrcOffset), text: lyricText })
    }
  }

  lines.sort((a, b) => a.time - b.time)
  if (openEndLines.size) {
    lines.forEach((line, i) => {
      if (!openEndLines.has(line) || !line.words) return
      // 「下一行」取开始时间晚于本行的第一行：同一时间戳的翻译行不算
      let j = i + 1
      while (j < lines.length && lines[j].time <= line.time) j++
      const last = line.words[line.words.length - 1]
      last.duration = openEndDuration(last.time, lines[j]?.time)
    })
  }
  return lines
}
