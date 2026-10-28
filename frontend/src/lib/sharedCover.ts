/**
 * 封面共享元素：从卡片点进详情页时，详情页的大封面从卡片原来的位置飞过去（物体恒常）。
 *
 * 卡片在 onClick 里记下封面砖的位置与已经加载好的图；详情页头部挂载时取走它，
 * 先把大封面摆在原位，再用弹簧放回自己的位置。记录 1.2 秒内有效：
 * 点了卡片但路由迟迟没到（懒加载慢、网络慢）就不飞了，免得封面从奇怪的地方冒出来。
 */
interface Origin {
  rect: DOMRect
  src?: string
  at: number
}

let pending: Origin | null = null

export function rememberCoverOrigin(el: Element | null | undefined) {
  if (!el) return
  const rect = el.getBoundingClientRect()
  if (rect.width < 8) return
  const img = el.querySelector('img')
  pending = { rect, src: img?.currentSrc || img?.src || undefined, at: performance.now() }
}

export function takeCoverOrigin(): Origin | null {
  const o = pending
  pending = null
  if (!o || performance.now() - o.at > 1200) return null
  return o
}
