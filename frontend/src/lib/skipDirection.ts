/**
 * 切歌的方向：界面上一切「翻页」动效（迷你条的曲名、全屏的封面）都按它决定从哪边进来。
 * 按「上一首」或向右甩记 -1，其余（下一首、自动播完、点了别的歌）都是 +1。
 * 记号只在 2 秒内有效：同一次切歌会被好几个组件读到，过了这一下就回到默认的 +1。
 */
let mark: { direction: 1 | -1; at: number } | null = null

export function markSkip(direction: 1 | -1) {
  mark = { direction, at: performance.now() }
}

export function skipDirection(): 1 | -1 {
  if (!mark || performance.now() - mark.at > 2000) return 1
  return mark.direction
}
