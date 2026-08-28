/**
 * 主题状态管理
 *
 * 两个正交的维度：
 *   skin  皮肤：'pop'（糖果·波普工坊，默认，DESIGN v3）/ 'editorial'（纸·墨·朱，DESIGN v2）
 *         落到 <html data-skin>，index.css 里两套 token 各自认领。
 *   theme 明暗：浅色为默认（<html> 无 class），深色为 'dark' class；system 跟随系统。
 *
 * 两者互不干涉——四种组合都成立。切换只改 DOM 属性，不重挂组件树。
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createPersistStorage } from '@/store/persistStorage'
import { STORAGE_KEYS } from '@/services/storageKeys'

export type Theme = 'dark' | 'light' | 'system'

/** 皮肤。新增皮肤时同步更新 index.css 的 token 块与 theme-preflash.js。 */
export type Skin = 'pop' | 'editorial'

/** 默认皮肤：糖果·波普工坊 */
export const DEFAULT_SKIN: Skin = 'pop'

/**
 * 首屏底色，供防白闪脚本与主题色 meta 使用。
 * 值必须和 index.css 里对应 token 的 --background 一致，改一处要改两处。
 */
export const SKIN_BACKGROUNDS: Record<Skin, { light: string; dark: string }> = {
  pop: { light: '#fbf1e3', dark: '#101016' },
  editorial: { light: '#f4efe3', dark: '#1a1712' },
}

/**
 * @deprecated 编辑风只保留单一朱红 accent（DESIGN v2 §1.3），多色 accent 预设已移除。
 * 该类型与 accentColor 字段仅为兼容 Settings 页旧 UI 与旧持久化数据而暂时保留，
 * store 不再向 DOM 注入任何 --primary/--ring 覆盖；设置页 accent UI 随后续 Phase 删除。
 */
export type AccentColor = 'green' | 'red' | 'blue' | 'purple' | 'orange'

interface ThemeState {
  theme: Theme
  /** 当前皮肤 */
  skin: Skin
  /** 当前实际应用的主题（解析 system 后）*/
  resolvedTheme: 'dark' | 'light'
  /** @deprecated 见 AccentColor 注释，仅作持久化兼容保留，不产生任何视觉效果 */
  accentColor: AccentColor
  /** 是否显示侧边栏（移动端收起）*/
  sidebarCollapsed: boolean
  /** 播放器可视化效果 */
  visualizerEnabled: boolean

  setTheme: (theme: Theme) => void
  setSkin: (skin: Skin) => void
  toggleSkin: () => void
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

/** 将皮肤应用到 DOM */
function applySkin(skin: Skin): void {
  document.documentElement.dataset.skin = skin
}

/**
 * 同步浏览器 UI 色（地址栏 / 安卓状态栏 / iOS 安全区）。
 *
 * index.html 里那两条按 prefers-color-scheme 分流的 theme-color 只知道
 * 编辑风的底色；皮肤一换就会在版面顶上留一条对不上的亮边。
 * 这里按「当前皮肤 × 当前明暗」写死一条，覆盖掉静态的两条。
 */
function applyThemeColor(skin: Skin, resolved: 'dark' | 'light'): void {
  const color = SKIN_BACKGROUNDS[skin][resolved]
  document.querySelectorAll('meta[name="theme-color"]').forEach(el => el.remove())
  const meta = document.createElement('meta')
  meta.name = 'theme-color'
  meta.content = color
  document.head.appendChild(meta)
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'light',
      skin: DEFAULT_SKIN,
      resolvedTheme: 'light',
      accentColor: 'green',
      sidebarCollapsed: false,
      visualizerEnabled: true,

      setTheme: (theme) => {
        const resolved = theme === 'system' ? getSystemTheme() : theme
        applyTheme(resolved)
        applyThemeColor(get().skin, resolved)
        set({ theme, resolvedTheme: resolved })
      },

      setSkin: (skin) => {
        applySkin(skin)
        applyThemeColor(skin, get().resolvedTheme)
        set({ skin })
      },

      toggleSkin: () => {
        const next: Skin = get().skin === 'pop' ? 'editorial' : 'pop'
        applySkin(next)
        applyThemeColor(next, get().resolvedTheme)
        set({ skin: next })
      },

      setAccentColor: (color) => set({ accentColor: color }),

      toggleTheme: () => {
        const { resolvedTheme, skin } = get()
        const newTheme = resolvedTheme === 'dark' ? 'light' : 'dark'
        applyTheme(newTheme)
        applyThemeColor(skin, newTheme)
        set({ theme: newTheme, resolvedTheme: newTheme })
      },

      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      toggleSidebar: () => set(state => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setVisualizerEnabled: (enabled) => set({ visualizerEnabled: enabled }),
    }),
    {
      name: STORAGE_KEYS.themeStore,
      // index.html 启动脚本会同步读取此键以避免闪白，不能延迟写入
      storage: createPersistStorage({ debounceMs: 0 }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          const resolved =
            state.theme === 'system' ? getSystemTheme() : state.theme
          // 1.9.2 之前的持久化数据里没有 skin 字段，读回来是 undefined。
          // 不兜底的话 <html data-skin> 会被写成字符串 "undefined"，
          // 两个皮肤块都不命中，页面落回 :root 的编辑风。
          const skin: Skin = state.skin === 'editorial' ? 'editorial' : DEFAULT_SKIN
          applyTheme(resolved)
          applySkin(skin)
          applyThemeColor(skin, resolved)
          state.resolvedTheme = resolved
          state.skin = skin
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
