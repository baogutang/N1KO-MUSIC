/**
 * 曲内定位的目标位置。
 *
 * 单独放在这里而不是 useKeyboardShortcuts 里：那个模块一被导入就会
 * 创建模块级的 Audio 实例（经 useAudioEngine），在测试环境里直接抛错。
 * 纯计算本就不该背着这样的副作用。
 */

/** 裸方向键的曲内定位步长。10 秒是播客与长音轨的通用步长，短曲也不至于一按就过头。 */
export const SEEK_STEP_SEC = 10

/**
 * 边界有两处讲究：
 *   - 不能退到负数——Howler 收到负值会算出 NaN，进度条直接坏掉；
 *   - 不能顶到 duration 本身——那一帧等于「已播完」会触发切歌，
 *     而用户按的是快进，不是下一首。留 1 秒余量。
 * duration 未知（流媒体元数据还没到）时不设上限，交给播放器自己夹。
 */
export function computeSeekTarget(current: number, delta: number, duration: number): number {
  const target = current + delta
  if (duration > 0) return Math.max(0, Math.min(duration - 1, target))
  return Math.max(0, target)
}
