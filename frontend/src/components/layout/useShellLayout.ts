/**
 * 外壳布局的单一真源：当前档位、侧栏与「正在播放」面板是否显示。
 * 侧栏、工具栏、播放条、主布局都从这里读，避免各自判断出不一致的结果。
 */

import { useSyncExternalStore } from 'react'
import { useWindowClass, type WindowClass } from '@/lib/platform'
import { useThemeStore } from '@/store/themeStore'

/** 面板「自动」时的展开阈值：1180 以上，侧栏 + 内容 + 面板三栏都放得下 */
const PANEL_AUTO_QUERY = '(min-width: 1180px)'

function subscribePanelAuto(callback: () => void) {
  const mql = window.matchMedia(PANEL_AUTO_QUERY)
  mql.addEventListener('change', callback)
  return () => mql.removeEventListener('change', callback)
}

export interface ShellLayout {
  wc: WindowClass
  /** 宽窗口且侧栏没收起 */
  sidebarVisible: boolean
  /** 宽窗口且面板开着 */
  panelVisible: boolean
}

export function useShellLayout(): ShellLayout {
  const wc = useWindowClass()
  const sidebarCollapsed = useThemeStore(s => s.sidebarCollapsed)
  const panelPref = useThemeStore(s => s.nowPlayingPanel)
  const panelAuto = useSyncExternalStore(subscribePanelAuto, () => window.matchMedia(PANEL_AUTO_QUERY).matches)
  const wide = wc === 'wide'
  return {
    wc,
    sidebarVisible: wide && !sidebarCollapsed,
    panelVisible: wide && (panelPref ?? panelAuto),
  }
}
