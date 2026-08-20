/**
 * PWA 更新提示。
 *
 * registerType 是 autoUpdate，但新的 Service Worker 要等所有标签页关闭才会接管——
 * 常驻标签页里的用户可能几周都停在旧版本上，而且完全不知情。
 * 这里显式提示并提供「立即更新」，与离线横幅共用同一条发丝线横幅语言。
 */

import { useEffect, useState } from 'react'
import { ArrowsClockwise, X } from '@phosphor-icons/react'

type UpdateFn = (reload?: boolean) => Promise<void>

export function UpdatePrompt() {
  const [needRefresh, setNeedRefresh] = useState(false)
  const [updateFn, setUpdateFn] = useState<UpdateFn | null>(null)
  const [updating, setUpdating] = useState(false)

  useEffect(() => {
    let cancelled = false
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
      className="flex items-center justify-center gap-3 border-b border-hair bg-paper-deep px-4 py-1.5 text-[12px] text-ink-soft"
    >
      <span>
        有新版本可用
        <span className="text-ink-faint">，更新后会重新载入页面</span>
      </span>
      <button
        onClick={() => { setUpdating(true); void updateFn?.(true) }}
        disabled={updating || !updateFn}
        className="inline-flex items-center gap-1 border-b border-ink-soft pb-px text-ink transition-colors duration-200 hover:border-primary hover:text-primary disabled:opacity-50"
      >
        <ArrowsClockwise size={11} className={updating ? 'animate-spin' : undefined} aria-hidden="true" />
        立即更新
      </button>
      <button
        onClick={() => setNeedRefresh(false)}
        className="grid h-6 w-6 place-items-center rounded-full text-ink-faint transition-colors duration-200 hover:text-ink"
        aria-label="稍后再更新"
      >
        <X size={12} />
      </button>
    </div>
  )
}
