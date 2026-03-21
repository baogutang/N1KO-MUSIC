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

/** 主题色 CSS 变量映射 */
const accentCssVars: Record<AccentColor, { primary: string; ring: string }> = {
  green: { primary: '141 69% 52%', ring: '141 69% 52%' },
  red: { primary: '354 96% 57%', ring: '354 96% 57%' },
  blue: { primary: '217 91% 60%', ring: '217 91% 60%' },
  purple: { primary: '267 84% 68%', ring: '267 84% 68%' },
  orange: { primary: '25 95% 53%', ring: '25 95% 53%' },
}

function applyAccentColor(color: AccentColor): void {
  const vars = accentCssVars[color]
  if (!vars) return
  const root = document.documentElement
  root.style.setProperty('--primary', vars.primary)
  root.style.setProperty('--ring', vars.ring)
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
        set({ theme, resolvedTheme: resolved })
      },

      setAccentColor: (color) => {
        applyAccentColor(color)
        set({ accentColor: color })
      },

      toggleTheme: () => {
        const { resolvedTheme } = get()
        const newTheme = resolvedTheme === 'dark' ? 'light' : 'dark'
        applyTheme(newTheme)
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
          applyAccentColor(state.accentColor)
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
