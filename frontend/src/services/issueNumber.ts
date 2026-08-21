/**
 * 刊号。
 *
 * 一本刊物要有刊号——这是它区别于「一个网页」的地方之一。刊号必须是可推算的：
 * 同一天在任何一台设备上打开，看到的必须是同一期，否则它就只是个装饰。
 *
 * 卷按年，期按 ISO 周。选 ISO 周而不是自然周，是因为它对「一年有几周」这件事
 * 有明确定义（52 或 53），不会出现某年冒出个第 0 期。
 */

/** 创刊年。卷号从这一年起算，第一卷是它本身。 */
export const FOUNDING_YEAR = 2024

export interface IssueNumber {
  /** 卷：第几年 */
  volume: number
  /** 期：ISO 周序号，1–53 */
  number: number
  /** ISO 周所属的年份，跨年那几天与自然年份并不相同 */
  year: number
  /** 展示用，如 VOL.3 NO.34 */
  label: string
}

/**
 * ISO 8601 周序号。
 *
 * 规则是「包含这一年第一个星期四的那一周算第 1 周」。
 * 直接按 (dayOfYear / 7) 取整会在跨年那几天算错——12 月 31 日经常属于下一年的第 1 周。
 */
export function isoWeek(date: Date): { year: number; week: number } {
  // 用 UTC 中午构造，避开夏令时切换那天 ±1 小时导致的日期漂移
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12))
  // 把日期挪到本周的星期四：ISO 周的归属由星期四决定
  const dayNumber = (target.getUTCDay() + 6) % 7 // 周一 = 0
  target.setUTCDate(target.getUTCDate() - dayNumber + 3)
  const isoYear = target.getUTCFullYear()
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4, 12))
  const firstDayNumber = (firstThursday.getUTCDay() + 6) % 7
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNumber + 3)
  const week = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 86_400_000))
  return { year: isoYear, week }
}

export function issueNumber(now = Date.now()): IssueNumber {
  const { year, week } = isoWeek(new Date(now))
  // 创刊当年是第 1 卷，不是第 0 卷
  const volume = Math.max(1, year - FOUNDING_YEAR + 1)
  return {
    volume,
    number: week,
    year,
    label: `VOL.${volume} NO.${String(week).padStart(2, '0')}`,
  }
}
