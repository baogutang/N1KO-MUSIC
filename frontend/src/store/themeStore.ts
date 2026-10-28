/**
 * 主题状态管理
 *
 * v5 起只有一套设计（暖纸），三张皮的 skin 维度已移除。
 * 剩下明暗一个维度：浅色为默认，深色落到 <html> 上的 'dark' class（供 Tailwind 的 dark: 变体）
 * 与 data-theme="dark"（供 index.css 的 token 块）；system 跟随系统。
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createPersistStorage } from '@/store/persistStorage'
import { STORAGE_KEYS } from '@/services/storageKeys'

export type Theme = 'dark' | 'light' | 'system'

/**
 * 首屏底色，供防白闪脚本与主题色 meta 使用。
 * 值必须和 index.css 的 --paper（亮 / 暗）一致；public/theme-preflash.js 里有同一份副本。
 */
export const THEME_BACKGROUNDS: Record<'light' | 'dark', string> = {
  light: '#f8fafc',
  dark: '#101317',
}

/**
 * @deprecated 单一强调色，多色 accent 预设早已移除；仅作类型兼容保留。
 */
export type AccentColor = 'green' | 'red' | 'blue' | 'purple' | 'orange'

interface ThemeState {
  theme: Theme
  /** 当前实际应用的主题（解析 system 后）*/
  resolvedTheme: 'dark' | 'light'
  /** 宽窗口（≥1024）下侧栏是否收起；跨会话保留 */
  sidebarCollapsed: boolean
  /** 宽窗口下右侧「正在播放」面板：null = 自动（窗口 ≥1180 时展开），否则听用户的 */
  nowPlayingPanel: boolean | null
  /** 播放器可视化效果 */
  visualizerEnabled: boolean

  setTheme: (theme: Theme) => void
  toggleTheme: () => void
  setSidebarCollapsed: (collapsed: boolean) => void
  toggleSidebar: () => void
  setNowPlayingPanel: (open: boolean | null) => void
  setVisualizerEnabled: (enabled: boolean) => void
}

/** 检测系统主题偏好 */
function getSystemTheme(): 'dark' | 'light' {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** 将明暗应用到 DOM：class 给 Tailwind，data-theme 给 index.css 的 token 块 */
function applyTheme(resolved: 'dark' | 'light'): void {
  const root = document.documentElement
  root.classList.toggle('dark', resolved === 'dark')
  root.dataset.theme = resolved
}

/**
 * 同步浏览器 UI 色（地址栏 / 安卓状态栏 / iOS 安全区）。
 * index.html 里按 prefers-color-scheme 分流的两条只管首屏；手动切明暗后由这一条覆盖。
 */
function applyThemeColor(resolved: 'dark' | 'light'): void {
  document.querySelectorAll('meta[name="theme-color"]').forEach(el => el.remove())
  const meta = document.createElement('meta')
  meta.name = 'theme-color'
  meta.content = THEME_BACKGROUNDS[resolved]
  document.head.appendChild(meta)
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'light',
      resolvedTheme: 'light',
      sidebarCollapsed: false,
      nowPlayingPanel: null,
      visualizerEnabled: true,

      setTheme: (theme) => {
        const resolved = theme === 'system' ? getSystemTheme() : theme
        applyTheme(resolved)
        applyThemeColor(resolved)
        set({ theme, resolvedTheme: resolved })
      },

      toggleTheme: () => {
        const newTheme = get().resolvedTheme === 'dark' ? 'light' : 'dark'
        applyTheme(newTheme)
        applyThemeColor(newTheme)
        set({ theme: newTheme, resolvedTheme: newTheme })
      },

      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      toggleSidebar: () => set(state => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setNowPlayingPanel: (open) => set({ nowPlayingPanel: open }),
      setVisualizerEnabled: (enabled) => set({ visualizerEnabled: enabled }),
    }),
    {
      name: STORAGE_KEYS.themeStore,
      version: 3,
      migrate: (persisted, version) => {
        const state = (persisted as { state?: Record<string, unknown> })?.state
          ?? (persisted as Record<string, unknown> | undefined)
          ?? {}
        // v2：accentColor 已废弃（阶段 4.7）
        if (version < 2) delete state.accentColor
        // v3：三张皮收敛成一套，skin 字段不再有意义
        if (version < 3) delete state.skin
        return persisted as ThemeState
      },
      // index.html 启动脚本会同步读取此键以避免闪白，不能延迟写入
      storage: createPersistStorage({ debounceMs: 0 }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          const resolved = state.theme === 'system' ? getSystemTheme() : state.theme
          applyTheme(resolved)
          applyThemeColor(resolved)
          state.resolvedTheme = resolved
        }
      },
    }
  )
)

/** 监听系统主题变化 */
if (typeof window !== 'undefined') {
  window
    .matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', () => {
      const { theme, setTheme } = useThemeStore.getState()
      if (theme === 'system') {
        setTheme('system')
      }
    })
}
