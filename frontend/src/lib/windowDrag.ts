/**
 * 桌面版窗口拖拽（Tauri 壳内）。
 *
 * 为什么不直接依赖 Tauri 自带的 `data-tauri-drag-region`：
 * 它的处理器在 mousedown 时异步 invoke `start_dragging`，Rust 那边拿
 * `NSApp.currentEvent` 喂给 `performWindowDragWithEvent:`——而这个 AppKit 方法
 * 只认鼠标**按下**事件。用户按下之后手一动，命令到达时当前事件已经是
 * 「拖动中」，AppKit 静默不动。macOS 上的表现就是「能改大小、不能拖位置」。
 * 诊断记录见 2026-09-05：元素、属性、权限、命令全部正常，卡在这一步。
 *
 * 这里改调 lib.rs 里的 `start_drag_reliable`：不看当前事件是什么，
 * 一律按此刻鼠标位置合成一个按下事件再交给 AppKit。
 *
 * 只挂在 Tauri 壳里；浏览器与移动端没有 __TAURI_INTERNALS__，本模块是空操作。
 * 依旧只认 `e.target` 自身的 `data-tauri-drag-region`，语义与 Tauri 完全一致，
 * 按钮、链接这些子元素不受影响。
 */

interface TauriInternals {
  invoke?: (cmd: string, args?: unknown) => Promise<unknown>
}

const ATTR = 'data-tauri-drag-region'

export function installWindowDrag(): void {
  if (typeof window === 'undefined') return
  const internals = (window as unknown as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__
  if (!internals?.invoke) return

  document.addEventListener('mousedown', event => {
    const target = event.target as Element | null
    const attr = target?.getAttribute?.(ATTR)
    if (attr === null || attr === undefined || attr === 'false') return
    if (event.button !== 0 || event.detail !== 1) return
    // Tauri 自己的处理器也会响应同一次事件并调用内置命令；两者都调无害，
    // 内置那次要么生效要么静默，我们这次保证生效。
    void internals.invoke!('start_drag_reliable').catch(() => { /* 非 macOS 或失败时由内置处理器兜底 */ })
  })
}
