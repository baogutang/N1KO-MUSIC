/**
 * Esc 的先后：卡片浏览开着时，先关它，再按一次才收起整个全屏播放器。
 *
 * 外层的 Radix Dialog（FullscreenPlayerOverlay，在主包里）在 onEscapeKeyDown 里先问这里；
 * 全屏播放器（懒加载的那一块）打开卡片浏览时登记，关掉时清空。
 * 单独一个小文件：外层要是直接 import CoverBrowser，整块浏览代码就被拖进主包了。
 */
export const browserEscape: { current: null | (() => boolean) } = { current: null }
