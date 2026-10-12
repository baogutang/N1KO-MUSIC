/**
 * 统一日志（阶段 4.10）。
 *
 * 生产代码此前 46 处裸 console.*，无法分级、无法导出。这里给：
 * - 级别：debug/info/warn/error（生产只透传 warn/error 到 console）
 * - 环形缓冲：最近 200 条（含级别、时间、来源前缀），设置页诊断导出用
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogEntry {
  time: number
  level: LogLevel
  tag: string
  args: unknown[]
}

const RING_SIZE = 200
const ring: LogEntry[] = []

const isDev = import.meta.env.DEV

function push(level: LogLevel, tag: string, args: unknown[]): void {
  ring.push({ time: Date.now(), level, tag, args })
  if (ring.length > RING_SIZE) ring.shift()
  if (isDev || level === 'warn' || level === 'error') {
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
    fn(`[${tag}]`, ...args)
  }
}

export const log = {
  debug: (tag: string, ...args: unknown[]) => push('debug', tag, args),
  info: (tag: string, ...args: unknown[]) => push('info', tag, args),
  warn: (tag: string, ...args: unknown[]) => push('warn', tag, args),
  error: (tag: string, ...args: unknown[]) => push('error', tag, args),
}

/** 诊断导出：最近 200 条（新在后） */
export function exportLogRing(): LogEntry[] {
  return [...ring]
}

/** 仅供测试 */
export function resetLogRingForTests(): void {
  ring.length = 0
}
