/**
 * 接住系统投过来的 `n1ko://` 链接。
 *
 * 三个来源各有各的通道：
 *   - Capacitor（Android / iOS）：App 的 appUrlOpen 事件
 *   - Tauri（桌面）：deep-link 插件的事件，没装插件时静默跳过
 *   - 浏览器：没有自定义协议，改用 `/open?url=…` 这条应用内路径，
 *     让 PWA 的 protocol_handlers 和外部脚本都有地方落
 *
 * 解析在 services/deepLink.ts 里，是纯函数；这里只负责把三个通道接上。
 */

import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { App } from '@capacitor/app'
import { isNativePlatform } from '@/lib/platform'
import { parseDeepLink, runDeepLinkCommand } from '@/services/deepLink'

/** Tauri 注入的全局对象，没有它就说明不在 Tauri 里 */
interface TauriGlobals {
  __TAURI__?: {
    event?: {
      listen: (event: string, handler: (payload: { payload: unknown }) => void)
        => Promise<() => void>
    }
  }
}

export function useDeepLinks(): void {
  const navigate = useNavigate()

  useEffect(() => {
    const handle = (raw: string) => {
      const action = parseDeepLink(raw)
      if (!action) {
        console.warn('[deeplink] 无法识别，已忽略：', raw)
        return
      }
      if (action.route) navigate(action.route)
      if (action.command) void runDeepLinkCommand(action.command)
    }

    const disposers: Array<() => void> = []

    // ── Capacitor ────────────────────────────────────────
    if (isNativePlatform) {
      const pending = App.addListener('appUrlOpen', event => handle(event.url))
      disposers.push(() => { void pending.then(h => h.remove()).catch(() => {}) })
      // 冷启动是被链接拉起来的：事件在监听注册前就发过了，这里补一次
      void App.getLaunchUrl().then(result => {
        if (result?.url) handle(result.url)
      }).catch(() => {})
    }

    // ── Tauri ────────────────────────────────────────────
    const tauri = (window as unknown as TauriGlobals).__TAURI__
    if (tauri?.event?.listen) {
      void tauri.event.listen('deep-link://new-url', event => {
        const payload = event.payload
        // 插件可能给一条字符串，也可能给一个数组
        const urls = Array.isArray(payload) ? payload : [payload]
        for (const url of urls) if (typeof url === 'string') handle(url)
      }).then(unlisten => disposers.push(unlisten)).catch(() => {
        // 没装 deep-link 插件：桌面端就只走应用内路径，不是错误
      })
    }

    return () => { for (const dispose of disposers) dispose() }
  }, [navigate])
}
