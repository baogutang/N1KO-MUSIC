/**
 * 原生 App 集成（仅 Capacitor 原生壳生效）
 * - Android 物理/手势返回：先关浮层（全屏播放器 / 队列），再路由后退，根路由退到桌面
 * - 状态栏样式随主题（深/浅）
 * - 首帧渲染后隐藏 SplashScreen
 */

import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { App } from '@capacitor/app'
import { StatusBar, Style } from '@capacitor/status-bar'
import { SplashScreen } from '@capacitor/splash-screen'
import { usePlayerStore } from '@/store/playerStore'
import { useThemeStore } from '@/store/themeStore'
import { isNativePlatform } from '@/lib/platform'
import { initNativeNetwork } from '@/lib/network'

export function useNativeAppIntegration() {
  const navigate = useNavigate()

  /**
   * 原生壳里读一次系统网络状态并持续监听。
   * 浏览器里的 navigator.connection 在 iOS WKWebView 上不存在，
   * 不接这个插件的话，蜂窝降级在 iPhone 上永远不会触发。
   */
  useEffect(() => {
    void initNativeNetwork()
  }, [])

  // 首帧后隐藏启动屏
  useEffect(() => {
    if (!isNativePlatform) return
    const timer = globalThis.setTimeout(() => {
      SplashScreen.hide().catch(() => {})
    }, 300)
    return () => globalThis.clearTimeout(timer)
  }, [])

  // Android 返回键
  useEffect(() => {
    if (!isNativePlatform) return
    const handle = App.addListener('backButton', () => {
      /**
       * 车载模式盖在所有东西最上层（z-[100]，见 FullscreenPlayerOverlay），
       * 所以它必须**最先**接住返回键。此前没管它：开车时按返回，
       * 界面纹丝不动，或者更糟——退到上一页却仍被车载界面盖着。
       */
      const player0 = usePlayerStore.getState()
      if (player0.isCarMode) {
        player0.setCarMode(false)
        return
      }
      // 有对话框打开时返回键应当先关对话框，而不是直接退到上一页
      const dialog = document.querySelector('[role="dialog"], [role="alertdialog"]')
      if (dialog) {
        const closeBtn = dialog.querySelector<HTMLElement>('[data-radix-dialog-close], [aria-label="Close"], [aria-label="关闭"]')
        if (closeBtn) closeBtn.click()
        else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        return
      }
      const player = usePlayerStore.getState()
      if (player.isFullscreen) {
        player.toggleFullscreen()
        return
      }
      if (player.isQueueOpen) {
        player.setQueueOpen(false)
        return
      }
      if (window.location.pathname !== '/') {
        navigate(-1)
        return
      }
      App.minimizeApp()
    })
    return () => {
      handle.then(h => h.remove()).catch(() => {})
    }
  }, [navigate])

  // 状态栏随主题
  useEffect(() => {
    if (!isNativePlatform) return
    const apply = (theme: 'light' | 'dark') => {
      StatusBar.setStyle({ style: theme === 'dark' ? Style.Dark : Style.Light }).catch(() => {})
    }
    apply(useThemeStore.getState().resolvedTheme)
    const unsubscribe = useThemeStore.subscribe((state, prev) => {
      if (state.resolvedTheme !== prev.resolvedTheme) apply(state.resolvedTheme)
    })
    return unsubscribe
  }, [])
}
