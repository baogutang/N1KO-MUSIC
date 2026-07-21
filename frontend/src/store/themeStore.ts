/**
 * 主题状态管理
 * 管理深色/浅色模式、主题色、布局偏好
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Theme = 'dark' | 'light' | 'system'
export type AccentColor = 'green' | 'red' | 'blue' | 'purple' | 'orange'

interface ThemeState {
  theme: Theme
  /** 当前实际应用的主题（解析 system 后）*/
  resolvedTheme: 'dark' | 'light'
  accentColor: AccentColor
  /** 是否显示侧边栏（移动端收起）*/
  sidebarCollapsed: boolean
  /** 播放器可视化效果 */
  visualizerEnabled: boolean

  setTheme: (theme: Theme) => void
  setAccentColor: (color: AccentColor) => void
  toggleTheme: () => void
  setSidebarCollapsed: (collapsed: boolean) => void
  toggleSidebar: () => void
  setVisualizerEnabled: (enabled: boolean) => void
}

/** 检测系统主题偏好 */
function getSystemTheme(): 'dark' | 'light' {
  if (typeof window === 'undefined') return 'dark'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/**
 * 主题色 CSS 变量映射
 * 深浅主题各配一组，保证对比度达标（深色底用中亮度色，浅色底用深色）
 */
interface AccentVars {
  primary: string
  primaryForeground: string
}

const accentCssVars: Record<AccentColor, { dark: AccentVars; light: AccentVars }> = {
  green: {
    dark: { primary: '152 62% 47%', primaryForeground: '155 52% 5%' },
    light: { primary: '152 71% 28%', primaryForeground: '40 30% 98%' },
  },
  red: {
    dark: { primary: '356 70% 60%', primaryForeground: '0 35% 6%' },
    light: { primary: '356 68% 44%', primaryForeground: '0 0% 100%' },
  },
  blue: {
    dark: { primary: '214 82% 62%', primaryForeground: '220 45% 7%' },
    light: { primary: '214 78% 42%', primaryForeground: '0 0% 100%' },
  },
  purple: {
    dark: { primary: '262 66% 68%', primaryForeground: '262 40% 8%' },
    light: { primary: '262 48% 46%', primaryForeground: '0 0% 100%' },
  },
  orange: {
    dark: { primary: '28 84% 58%', primaryForeground: '25 50% 7%' },
    light: { primary: '27 85% 40%', primaryForeground: '0 0% 100%' },
  },
}

/** 将主题色应用到 DOM（跟随当前深浅主题取值）*/
function applyAccentColor(color: AccentColor, resolved: 'dark' | 'light'): void {
  const vars = accentCssVars[color]?.[resolved]
  if (!vars) return
  const root = document.documentElement
  root.style.setProperty('--primary', vars.primary)
  root.style.setProperty('--primary-foreground', vars.primaryForeground)
  root.style.setProperty('--ring', vars.primary)
}

/** 将主题应用到 DOM */
function applyTheme(resolved: 'dark' | 'light'): void {
  const root = document.documentElement
  if (resolved === 'light') {
    root.classList.add('light')
    root.classList.remove('dark')
  } else {
    root.classList.remove('light')
    root.classList.add('dark')
  }
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      resolvedTheme: 'dark',
      accentColor: 'green',
      sidebarCollapsed: false,
      visualizerEnabled: true,

      setTheme: (theme) => {
        const resolved = theme === 'system' ? getSystemTheme() : theme
        applyTheme(resolved)
        // 深浅主题的强调色取值不同，切主题时需要重新应用
        applyAccentColor(get().accentColor, resolved)
        set({ theme, resolvedTheme: resolved })
      },

      setAccentColor: (color) => {
        applyAccentColor(color, get().resolvedTheme)
        set({ accentColor: color })
      },

      toggleTheme: () => {
        const { resolvedTheme, accentColor } = get()
        const newTheme = resolvedTheme === 'dark' ? 'light' : 'dark'
        applyTheme(newTheme)
        applyAccentColor(accentColor, newTheme)
        set({ theme: newTheme, resolvedTheme: newTheme })
      },

      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      toggleSidebar: () => set(state => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setVisualizerEnabled: (enabled) => set({ visualizerEnabled: enabled }),
    }),
    {
      name: 'msp-theme-store',
      onRehydrateStorage: () => (state) => {
        if (state) {
          const resolved =
            state.theme === 'system' ? getSystemTheme() : state.theme
          applyTheme(resolved)
          applyAccentColor(state.accentColor, resolved)
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
