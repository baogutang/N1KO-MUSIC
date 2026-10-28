/**
 * PWA 更新提示。
 *
 * registerType 是 autoUpdate，但新的 Service Worker 要等所有标签页关闭才会接管——
 * 常驻标签页里的用户可能几周都停在旧版本上，而且完全不知情。
 * 这里显式提示并提供「立即更新」，与离线提示条共用同一副外形（挂在吸顶工具栏下面的玻璃胶囊）。
 */

import { useEffect, useState } from 'react'
import { isTauriShell } from '@/lib/platform'
import { ArrowCircleUp, ArrowsClockwise, X } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'

type UpdateFn = (reload?: boolean) => Promise<void>

export function UpdatePrompt() {
  const { t } = useT()
  const [needRefresh, setNeedRefresh] = useState(false)
  const [updateFn, setUpdateFn] = useState<UpdateFn | null>(null)
  const [updating, setUpdating] = useState(false)

  useEffect(() => {
    let cancelled = false
    /*
     * Tauri 壳内不注册 SW（阶段 6.11）：桌面版的更新由安装包分发，
     * SW 缓存反而会在 App 更新后继续供旧资源（版本错配的模块混跑）。
     * Capacitor 构建里这个虚拟模块本身就不存在。
     */
    if (isTauriShell) return () => { cancelled = true }
    // 动态导入：Capacitor 构建里没有这个虚拟模块
    import('virtual:pwa-register')
      .then(({ registerSW }) => {
        if (cancelled) return
        const update = registerSW({
          immediate: true,
          onNeedRefresh() { setNeedRefresh(true) },
        })
        setUpdateFn(() => update as UpdateFn)
      })
      .catch(() => {
        // 原生壳 / 开发模式下没有 SW，静默跳过
      })
    return () => { cancelled = true }
  }, [])

  if (!needRefresh) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="glass mx-3 regular:mx-5 mt-1 mb-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[26px] py-2 pl-4 pr-2 text-[14px] leading-snug text-ink"
    >
      <ArrowCircleUp size={18} weight="fill" aria-hidden="true" className="flex-none text-leaf" />
      <span className="min-w-[10rem] flex-1">
        <span className="font-medium">{t('update.available')}</span>
        <span className="text-ink-3">{t('update.hint')}</span>
      </span>
      {/* 两个动作成一组：放不下时一起折到下一行靠右。视觉 36px，用伪元素把命中区撑到 44px */}
      <div className="ml-auto flex flex-none items-center gap-1">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => { setUpdating(true); void updateFn?.(true) }}
          disabled={updating || !updateFn}
          className="relative flex-none before:absolute before:-inset-y-1 before:inset-x-0 before:content-['']"
        >
          <ArrowsClockwise size={15} className={updating ? 'animate-spin motion-reduce:animate-none' : undefined} aria-hidden="true" />
          {t('update.now')}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setNeedRefresh(false)}
          aria-label={t('update.later')}
          className="relative flex-none before:absolute before:-inset-1 before:content-['']"
        >
          <X size={15} />
        </Button>
      </div>
    </div>
  )
}
