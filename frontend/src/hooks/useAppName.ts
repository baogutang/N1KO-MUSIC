import { useSettingsStore } from '@/store/settingsStore'
import { resolveAppName } from '@/lib/appName'

/** 侧栏、登录页、窗口标题用的那个名字。 */
export function useAppName(): string {
  return useSettingsStore(s => resolveAppName(s.appName))
}
