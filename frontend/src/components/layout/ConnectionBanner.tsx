/**
 * 离线 / 服务器不可达提示条。
 *
 * 此前拔掉服务器只有一个会自动消失的 toast，之后每个页面要么渲染陈旧缓存
 * 要么空白，用户没有任何持续可见的线索，也没有重试入口。
 * 这里做成一条常驻的发丝线横幅——不遮挡内容，但不会自己消失。
 */

import { useCallback, useEffect, useState } from 'react'
import { ArrowsClockwise, WifiSlash } from '@phosphor-icons/react'
import { useQueryClient } from '@tanstack/react-query'
import { getAdapter, hasAdapter } from '@/api'
import { useServerStore } from '@/store/serverStore'

/** 浏览器报离线后多久探一次服务器 */
const PROBE_INTERVAL_MS = 20_000

export function ConnectionBanner() {
  const activeServerId = useServerStore(s => s.activeServerId)
  const [browserOffline, setBrowserOffline] = useState(() => !navigator.onLine)
  const [serverUnreachable, setServerUnreachable] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const queryClient = useQueryClient()

  useEffect(() => {
    const online = () => setBrowserOffline(false)
    const offline = () => setBrowserOffline(true)
    window.addEventListener('online', online)
    window.addEventListener('offline', offline)
    return () => {
      window.removeEventListener('online', online)
      window.removeEventListener('offline', offline)
    }
  }, [])

  // 浏览器在线不代表家里的 NAS 可达：断网的常见形态是离开了家里的网络
  useEffect(() => {
    if (!activeServerId || !hasAdapter()) return
    let cancelled = false
    const probe = async () => {
      try {
        const ok = await getAdapter().ping()
        if (!cancelled) setServerUnreachable(!ok)
      } catch {
        if (!cancelled) setServerUnreachable(true)
      }
    }
    // 挂载时先探一次：否则断网后最长要等 20 秒才有任何提示
    void probe()
    const timer = setInterval(() => {
      // 标签页在后台时不必轮询，回到前台会立刻补一次
      if (document.visibilityState === 'hidden') return
      void probe()
    }, PROBE_INTERVAL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') void probe() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [activeServerId])

  const retry = useCallback(async () => {
    setRetrying(true)
    try {
      if (hasAdapter()) {
        const ok = await getAdapter().ping()
        setServerUnreachable(!ok)
        if (ok) await queryClient.refetchQueries({ type: 'active' })
      }
      setBrowserOffline(!navigator.onLine)
    } finally {
      setRetrying(false)
    }
  }, [queryClient])

  const offline = browserOffline || serverUnreachable
  if (!offline) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-center gap-3 border-b border-hair bg-paper-deep px-4 py-1.5 text-[12px] text-ink-soft"
    >
      <WifiSlash size={13} aria-hidden="true" className="text-primary flex-shrink-0" />
      <span>
        {browserOffline ? '设备已离线' : '连不上音乐服务器'}
        <span className="text-ink-faint">
          {browserOffline ? '，显示的是本地缓存内容' : '，可能是离开了服务器所在的网络'}
        </span>
      </span>
      <button
        onClick={retry}
        disabled={retrying}
        className="inline-flex items-center gap-1 border-b border-ink-soft pb-px text-ink transition-colors duration-200 hover:border-primary hover:text-primary disabled:opacity-50"
      >
        <ArrowsClockwise size={11} className={retrying ? 'animate-spin' : undefined} aria-hidden="true" />
        重试
      </button>
    </div>
  )
}
