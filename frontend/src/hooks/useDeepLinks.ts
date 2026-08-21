/**
 * 接住系统投过来的 `n1ko://` 链接。
 *
 * 三个来源各有各的通道：
 *   - Capacitor（Android / iOS）：App 的 appUrlOpen 事件
 *   - Tauri（桌面）：deep-link 插件的事件
 *   - 浏览器：没有自定义协议，改用 `/open?url=…` 这条应用内路径，
 *     让 PWA 的 protocol_handlers 和外部脚本都有地方落
 *
 * 解析在 services/deepLink.ts 里，是纯函数；这里只负责把三个通道接上。
 */

import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { App } from '@capacitor/app'
import { isNativePlatform } from '@/lib/platform'
import { parseDeepLink, runDeepLinkCommand } from '@/services/deepLink'

/**
 * 冷启动链接只处理一次，一个进程内有且仅有一次。
 *
 * 这个标记必须在模块级而不是组件级：Capacitor 的 `getLaunchUrl()` 在**整个进程
 * 生命周期内**都返回那条启动链接（Android 是 `Bridge.intentUri`，iOS 是
 * `ApplicationDelegateProxy.lastURL`，两者都只赋值一次、从不清空）。
 * 只要重新读一次，用户就会被拽回启动时那一页、队列被单曲替换、进度回到 0:00。
 */
let launchUrlHandled = false

/** Tauri 会在任何配置下注入这个内部对象；`window.__TAURI__` 则要 withGlobalTauri 才有 */
function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export function useDeepLinks(): void {
  const navigate = useNavigate()

  /**
   * 处理函数放进 ref，effect 的依赖数组因此可以是空的。
   *
   * 直接依赖 navigate 是错的：BrowserRouter 下 `useNavigate()` 的返回值
   * 每次路由变化都会换新引用（它的 useCallback 依赖里有 locationPathname），
   * effect 于是每导航一次就重挂一次，冷启动链接也跟着被重放一次。
   */
  const handleRef = useRef<(raw: string) => void>(() => {})
  handleRef.current = (raw: string) => {
    const action = parseDeepLink(raw)
    if (!action) {
      console.warn('[deeplink] 无法识别，已忽略：', raw)
      return
    }
    if (action.route) navigate(action.route)
    if (action.command) void runDeepLinkCommand(action.command)
  }

  useEffect(() => {
    const handle = (raw: string) => handleRef.current(raw)
    /** 卸载后到达的异步结果一律丢弃 */
    let disposed = false
    const disposers: Array<() => void> = []

    // ── Capacitor ────────────────────────────────────────
    if (isNativePlatform) {
      const pending = App.addListener('appUrlOpen', event => handle(event.url))
      disposers.push(() => { void pending.then(h => h.remove()).catch(() => {}) })

      // 冷启动是被链接拉起来的：事件在监听注册前就发过了，这里补一次——只补一次
      if (!launchUrlHandled) {
        launchUrlHandled = true
        void App.getLaunchUrl().then(result => {
          if (!disposed && result?.url) handle(result.url)
        }).catch(() => {})
      }
    }

    // ── Tauri ────────────────────────────────────────────
    /**
     * 走 `@tauri-apps/api` 而不是 `window.__TAURI__`：后者只有在
     * tauri.conf.json 里显式打开 withGlobalTauri 才存在（v2 默认关闭），
     * 于是打包出来的桌面版里那个分支永远进不去，桌面深链接从来没生效过。
     *
     * 动态 import 是必需的：这个模块在浏览器构建里也会被加载，
     * 顶层静态引入会把 Tauri 的 IPC 代码带进 Web 包。
     */
    if (isTauri()) {
      void (async () => {
        try {
          const [{ listen }, { invoke }] = await Promise.all([
            import('@tauri-apps/api/event'),
            import('@tauri-apps/api/core'),
          ])
          if (disposed) return

          const unlisten = await listen<unknown>('deep-link://new-url', event => {
            const payload = event.payload
            // 插件可能给一条字符串，也可能给一个数组
            const urls = Array.isArray(payload) ? payload : [payload]
            for (const url of urls) if (typeof url === 'string') handle(url)
          })
          // 注册期间组件已经卸载：立刻退订，别把监听器漏在那儿
          if (disposed) { unlisten(); return }
          disposers.push(unlisten)

          // 桌面端同样要补冷启动那一发：App 未运行时点链接，
          // 插件的事件在 React 挂上监听之前就发完了
          if (!launchUrlHandled) {
            launchUrlHandled = true
            const current = await invoke<string[] | null>('plugin:deep-link|get_current')
            if (!disposed && Array.isArray(current)) {
              for (const url of current) if (typeof url === 'string') handle(url)
            }
          }
        } catch {
          // 没装 deep-link 插件、或者权限没开：桌面端就只走应用内路径，不是错误
        }
      })()
    }

    return () => {
      disposed = true
      for (const dispose of disposers) dispose()
    }
  }, [])
}

/** 仅供测试：重置「冷启动链接已处理」标记 */
export function resetLaunchUrlHandledForTests(): void {
  launchUrlHandled = false
}
