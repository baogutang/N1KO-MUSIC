/**
 * 重听：从你自己的历史里找出该被再听一次的曲子。
 *
 * 推荐引擎解决的是「你可能会喜欢什么」，这里解决的是另一个问题——
 * 你**已经**喜欢过的东西正在从你手边消失。一个私人曲库的价值不在于源源不断
 * 地推新，而在于那些被自己听过、然后忘掉的东西还找得回来。
 *
 * 三条线索，各自对应一种「丢失」的方式：
 *   去年今日：时间坐标上的重合，是最容易触发回忆的一种
 *   久违：曾经反复听、如今很久没碰的
 *   只听过一次：进过库、听了一遍就再没打开的
 *
 * 全部只用本地收听历史算，不发任何请求。
 */

import type { Song } from '@/api/types'
import { isQualifiedListeningEvent, type ListeningEvent } from '@/services/listeningHistory'

const DAY_MS = 86_400_000

/** 「去年今日」允许的前后偏移：正负三天，否则大多数日子会空着 */
const ANNIVERSARY_WINDOW_DAYS = 3
/** 「久违」的门槛：至少听过这么多次才算「曾经喜欢」 */
const LOVED_MIN_PLAYS = 4
/** 「久违」的冷却期：多久没听才值得被提起 */
const DORMANT_MIN_DAYS = 120
/** 「只听过一次」的观察期：太新的不算被冷落，只是还没轮到 */
const ONE_SHOT_MIN_AGE_DAYS = 45

export interface RediscoveryEntry {
  song: Song
  /** 上次收听的时间戳 */
  lastHeardAt: number
  /** 有效播放次数 */
  plays: number
  /** 展示用的一句说明，由真实数据拼成 */
  note: string
}

export interface Rediscovery {
  /** 往年的今天前后听过的 */
  anniversary: RediscoveryEntry[]
  /** 曾经反复听、很久没碰的 */
  dormant: RediscoveryEntry[]
  /** 只听过一次就再没打开的 */
  onceOnly: RediscoveryEntry[]
}

interface Aggregate {
  song: Song
  plays: number
  firstHeardAt: number
  lastHeardAt: number
  /** 每次收听的时间戳，用于「去年今日」比对 */
  timestamps: number[]
}

function songKey(song: Song): string {
  return `${song.serverId ?? ''}:${song.id}`
}

/** 本地日历下这一天是一年中的第几天，用于跨年比对 */
function dayOfYear(timestamp: number): number {
  const date = new Date(timestamp)
  const start = new Date(date.getFullYear(), 0, 0)
  return Math.floor((date.getTime() - start.getTime()) / DAY_MS)
}

/** 两个「年中第几天」的环形距离，跨年（12/31 与 1/2）也要算作相邻 */
function circularDayDistance(a: number, b: number): number {
  const raw = Math.abs(a - b)
  return Math.min(raw, 365 - raw)
}

function formatYearsAgo(years: number): string {
  return years === 1 ? '去年今天' : `${years} 年前的今天`
}

function formatGap(days: number): string {
  if (days >= 365) {
    const years = Math.floor(days / 365)
    return `${years} 年没听了`
  }
  if (days >= 60) return `${Math.floor(days / 30)} 个月没听了`
  return `${days} 天没听了`
}

/**
 * 聚合历史。
 *
 * 只统计达到 scrobble 阈值的收听：划过去的两秒不该让一首歌进「久违」名单，
 * 那会让整个板块变成「你不小心点开过的东西」。
 */
function aggregate(events: ListeningEvent[]): Map<string, Aggregate> {
  const map = new Map<string, Aggregate>()
  for (const event of events) {
    if (!isQualifiedListeningEvent(event)) continue
    const key = songKey(event.song)
    const existing = map.get(key)
    if (existing) {
      existing.plays += 1
      existing.firstHeardAt = Math.min(existing.firstHeardAt, event.endedAt)
      existing.lastHeardAt = Math.max(existing.lastHeardAt, event.endedAt)
      existing.timestamps.push(event.endedAt)
      // 最近一条的元数据更可能是新的（改过标签、换过封面）
      if (event.endedAt >= existing.lastHeardAt) existing.song = event.song
    } else {
      map.set(key, {
        song: event.song,
        plays: 1,
        firstHeardAt: event.endedAt,
        lastHeardAt: event.endedAt,
        timestamps: [event.endedAt],
      })
    }
  }
  return map
}

export function buildRediscovery(
  events: ListeningEvent[],
  now = Date.now(),
  limit = 8
): Rediscovery {
  const aggregates = Array.from(aggregate(events).values())
  const today = dayOfYear(now)
  const currentYear = new Date(now).getFullYear()

  // ── 去年今日 ────────────────────────────────────────
  const anniversary: RediscoveryEntry[] = []
  for (const item of aggregates) {
    let bestYears = 0
    for (const timestamp of item.timestamps) {
      const years = currentYear - new Date(timestamp).getFullYear()
      if (years < 1) continue
      if (circularDayDistance(dayOfYear(timestamp), today) > ANNIVERSARY_WINDOW_DAYS) continue
      // 同一首在多年前的今天都听过时，取最久远的那一年——越远越值得说
      bestYears = Math.max(bestYears, years)
    }
    if (bestYears > 0) {
      anniversary.push({
        song: item.song,
        lastHeardAt: item.lastHeardAt,
        plays: item.plays,
        note: formatYearsAgo(bestYears),
      })
    }
  }
  anniversary.sort((a, b) => b.plays - a.plays)

  // ── 久违 ────────────────────────────────────────────
  const dormant: RediscoveryEntry[] = aggregates
    .filter(item => {
      const gapDays = Math.floor((now - item.lastHeardAt) / DAY_MS)
      return item.plays >= LOVED_MIN_PLAYS && gapDays >= DORMANT_MIN_DAYS
    })
    .map(item => ({
      song: item.song,
      lastHeardAt: item.lastHeardAt,
      plays: item.plays,
      note: formatGap(Math.floor((now - item.lastHeardAt) / DAY_MS)),
    }))
    // 听得越多、停得越久，越该被提起：两者相乘做排序权重
    .sort((a, b) =>
      (b.plays * (now - b.lastHeardAt)) - (a.plays * (now - a.lastHeardAt)))

  // ── 只听过一次 ──────────────────────────────────────
  const onceOnly: RediscoveryEntry[] = aggregates
    .filter(item => {
      const ageDays = Math.floor((now - item.lastHeardAt) / DAY_MS)
      return item.plays === 1 && ageDays >= ONE_SHOT_MIN_AGE_DAYS
    })
    .map(item => ({
      song: item.song,
      lastHeardAt: item.lastHeardAt,
      plays: 1,
      note: formatGap(Math.floor((now - item.lastHeardAt) / DAY_MS)),
    }))
    // 越久远的越可能已经完全忘了
    .sort((a, b) => a.lastHeardAt - b.lastHeardAt)

  /**
   * 跨栏去重。
   *
   * 一首只听过一次、又恰好是去年今天听的歌，三个条件可以同时成立；
   * 同一首出现在同一屏的两栏里，读起来像是数据出了错。
   * 按「去年今日 → 久违 → 只听过一次」的顺序占位：越靠前的线索越具体。
   */
  const claimed = new Set<string>()
  const take = (entries: RediscoveryEntry[]): RediscoveryEntry[] => {
    const out: RediscoveryEntry[] = []
    for (const entry of entries) {
      if (out.length >= limit) break
      const key = songKey(entry.song)
      if (claimed.has(key)) continue
      claimed.add(key)
      out.push(entry)
    }
    return out
  }

  return {
    anniversary: take(anniversary),
    dormant: take(dormant),
    onceOnly: take(onceOnly),
  }
}
