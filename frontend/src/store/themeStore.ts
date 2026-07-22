/**
 * 主题状态管理
 * 杂志编辑风（DESIGN v2）：浅色纸面为默认主题（<html> 无 class），
 * 深色为变体（<html> 加 'dark' class）。system 模式跟随系统。
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Theme = 'dark' | 'light' | 'system'

/**
 * @deprecated 编辑风只保留单一朱红 accent（DESIGN v2 §1.3），多色 accent 预设已移除。
 * 该类型与 accentColor 字段仅为兼容 Settings 页旧 UI 与旧持久化数据而暂时保留，
 * store 不再向 DOM 注入任何 --primary/--ring 覆盖；设置页 accent UI 随后续 Phase 删除。
 */
export type AccentColor = 'green' | 'red' | 'blue' | 'purple' | 'orange'

interface ThemeState {
  theme: Theme
  /** 当前实际应用的主题（解析 system 后）*/
  resolvedTheme: 'dark' | 'light'
  /** @deprecated 见 AccentColor 注释，仅作持久化兼容保留，不产生任何视觉效果 */
  accentColor: AccentColor
  /** 是否显示侧边栏（移动端收起）*/
  sidebarCollapsed: boolean
  /** 播放器可视化效果 */
  visualizerEnabled: boolean

  setTheme: (theme: Theme) => void
  /** @deprecated 不再注入 accent 覆盖，仅更新字段（后续 Phase 随设置页一并移除）*/
  setAccentColor: (color: AccentColor) => void
  toggleTheme: () => void
  setSidebarCollapsed: (collapsed: boolean) => void
  toggleSidebar: () => void
  setVisualizerEnabled: (enabled: boolean) => void
}

/** 检测系统主题偏好 */
function getSystemTheme(): 'dark' | 'light' {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** 将主题应用到 DOM：浅色 = 默认（无 class），深色 = 'dark' class */
function applyTheme(resolved: 'dark' | 'light'): void {
  document.documentElement.classList.toggle('dark', resolved === 'dark')
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'light',
      resolvedTheme: 'light',
      accentColor: 'green',
      sidebarCollapsed: false,
      visualizerEnabled: true,

      setTheme: (theme) => {
        const resolved = theme === 'system' ? getSystemTheme() : theme
        applyTheme(resolved)
        set({ theme, resolvedTheme: resolved })
      },

      setAccentColor: (color) => set({ accentColor: color }),

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
