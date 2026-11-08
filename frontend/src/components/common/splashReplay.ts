/** 设置页的「预览」要在不开新进程的情况下再播一遍开屏。 */
const listeners = new Set<() => void>()

export function replaySplash(): void {
  for (const listener of listeners) listener()
}

export function subscribeSplashReplay(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
