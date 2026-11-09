/**
 * 底部弹层「往下拖收起」的判定（纯函数，方便单测；手势本身在 QueueDrawer 里）。
 * 阈值与全屏播放器的下拉收起一致：过 120px，或者甩得够快（>900px/s 且至少拖了 30px）。
 */

/** 拖过这个距离松手就收起 */
export const SHEET_DISMISS_DISTANCE = 120
/** 甩的速度够快（px/s）时，哪怕没拖到那么远也收起 */
export const SHEET_DISMISS_VELOCITY = 900
/** 甩收起至少要拖出的距离，免得手一抖就收 */
export const SHEET_FLICK_MIN_DISTANCE = 30

/**
 * 手指位移 → 弹层位移。底部弹层贴着屏幕下沿：往下 1:1 跟手，
 * 往上拖不动（上提会在弹层底下露出一条缝）。
 */
export function sheetDragOffset(dy: number): number {
  return dy > 0 ? dy : 0
}

/** 松手时该收起还是弹回。dy 是手指总位移（px），elapsedMs 是按下到松手的时间 */
export function shouldDismissSheet(dy: number, elapsedMs: number): boolean {
  const velocity = (dy / Math.max(1, elapsedMs)) * 1000
  return dy > SHEET_DISMISS_DISTANCE || (dy > SHEET_FLICK_MIN_DISTANCE && velocity > SHEET_DISMISS_VELOCITY)
}
