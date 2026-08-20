/**
 * `virtual:pwa-register` 的空实现。
 *
 * Capacitor 原生壳里刻意不启用 VitePWA（WebView 内的 SW 缓存会导致资源陈旧），
 * 于是那个虚拟模块根本不存在，Rollup 在构建期就会因为解析不到而失败——
 * 动态 import 的 catch 只能兜住运行时错误，兜不住构建。
 * 这里用别名把它指到这个空实现，原生壳里 UpdatePrompt 自然什么都不做。
 */

export function registerSW(_options?: {
  immediate?: boolean
  onNeedRefresh?: () => void
  onOfflineReady?: () => void
}): (reload?: boolean) => Promise<void> {
  return async () => {}
}
