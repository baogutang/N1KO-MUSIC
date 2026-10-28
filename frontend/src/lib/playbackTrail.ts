/**
 * 播放诊断：每一次「播着播着停了」都记下是谁让它停的。
 *
 * 用户报过「经常自己暂停，进度条上缓冲明明还有余量」。可暂停来自好几条路：
 * 系统把 <audio> 停了（来电、Siri、别的 App 出声、AirPods 摘下或被别的设备抢走、锁屏后被挂起），
 * 锁屏 / 控制中心 / 耳机线控，耳机断开的判断，断网，流出错，睡眠定时，或者就是手点的——
 * 界面上全是同一个结果：播放键变回三角。只看结果分不出是哪条。
 *
 * 做法：会让播放停下的每条路径，动手之前先留一句 notePauseReason；store 里 isPlaying
 * 从 true 变成 false 的那一刻（recordPause），把两秒内留下的那句话连同当时 <audio> 的状态
 * 一起记下来。设置页「播放诊断」里能看、能复制。没留话的那一条记成 unknown——它本身也是线索。
 */
import { log } from '@/lib/log'

export type PauseReason =
  /** 界面上点的（播放键、空格、命令面板） */
  | 'ui'
  /** <audio> 自己停了、不是我们叫停的：系统打断、被挂起、AirPods、路由变化…… */
  | 'element'
  /** 锁屏 / 控制中心 / 耳机线控（原生插件转来的） */
  | 'remote'
  /** 系统媒体面板（Media Session 的 pause / stop） */
  | 'media-session'
  /** 输出设备变少：判断为耳机断开 */
  | 'device'
  /** 断网，等网回来 */
  | 'offline'
  /** 流出错、取流失败、换源都失败 */
  | 'error'
  /** 睡眠定时到点 */
  | 'sleep'
  /** 队列放完了 */
  | 'queue-end'

export interface PauseContext {
  /** <audio> 当时是否已经停着（true 说明是元素先停、store 跟着同步） */
  elementPaused: boolean
  readyState: number
  networkState: number
  /** MediaError.code；没出错是 0 */
  errorCode: number
  currentTime: number
  /** 当前位置往后还缓冲了多少秒 */
  bufferedAhead: number
  duration: number
  visibility: DocumentVisibilityState
  online: boolean
}

export interface PauseRecord {
  at: number
  reason: PauseReason | 'unknown'
  detail?: string
  songTitle?: string
  ctx: PauseContext
}

/** 一句话两秒内有效：比这更早的「原因」和这次暂停没有关系 */
const REASON_TTL_MS = 2000
const MAX_RECORDS = 30

let pending: { reason: PauseReason; detail?: string; at: number } | null = null
const records: PauseRecord[] = []
/** 给 useSyncExternalStore 的快照：只在记了新的一条时换成新数组，否则每次都是同一个引用（不然会无限重渲染） */
let snapshot: PauseRecord[] = []
const listeners = new Set<() => void>()

/** 让播放停下之前调用：说明这一次是谁、为什么 */
export function notePauseReason(reason: PauseReason, detail?: string): void {
  pending = { reason, detail, at: Date.now() }
}

/** 播放开始了：之前留的那句话是给「播放」的，不是给暂停的，作废（免得两秒内别的暂停被记成「你点了暂停」） */
export function clearPauseReason(): void {
  pending = null
}

/** isPlaying 由 true 变 false 时调用（useAudioEngine 里订阅 store） */
export function recordPause(ctx: PauseContext, songTitle?: string): void {
  const now = Date.now()
  const noted = pending && now - pending.at <= REASON_TTL_MS ? pending : null
  pending = null
  const record: PauseRecord = { at: now, reason: noted?.reason ?? 'unknown', detail: noted?.detail, songTitle, ctx }
  records.push(record)
  if (records.length > MAX_RECORDS) records.shift()
  snapshot = [...records]
  // 进日志环：诊断导出时和其它日志按时间排在一起
  log.info('playback', 'paused', record.reason, record.detail ?? '', ctx)
  for (const l of listeners) l()
}

/** 最近的暂停记录（新在后）。返回的是快照，别改它 */
export function getPauseRecords(): PauseRecord[] {
  return snapshot
}

export function subscribePauseRecords(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** 读 <audio> 当时的状态；读不到的字段给 0，诊断不能自己抛错 */
export function readPauseContext(audio: HTMLAudioElement): PauseContext {
  let bufferedAhead = 0
  try {
    const t = audio.currentTime
    for (let i = 0; i < audio.buffered.length; i++) {
      if (audio.buffered.start(i) <= t + 0.25 && audio.buffered.end(i) >= t) {
        bufferedAhead = Math.max(0, audio.buffered.end(i) - t)
        break
      }
    }
  } catch {
    bufferedAhead = 0
  }
  const duration = Number.isFinite(audio.duration) ? audio.duration : 0
  return {
    elementPaused: audio.paused,
    readyState: audio.readyState,
    networkState: audio.networkState,
    errorCode: audio.error?.code ?? 0,
    currentTime: Math.round(audio.currentTime * 10) / 10,
    bufferedAhead: Math.round(bufferedAhead * 10) / 10,
    duration: Math.round(duration),
    visibility: typeof document !== 'undefined' ? document.visibilityState : 'visible',
    online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  }
}

/** 仅供测试 */
export function resetPauseTrailForTests(): void {
  pending = null
  records.length = 0
  snapshot = []
}
