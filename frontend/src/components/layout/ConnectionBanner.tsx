/**
 * 离线 / 服务器不可达提示条。
 *
 * 此前拔掉服务器只有一个会自动消失的 toast，之后每个页面要么渲染陈旧缓存
 * 要么空白，用户没有任何持续可见的线索，也没有重试入口。
 * 这里做成一条常驻的发丝线横幅——不遮挡内容，但不会自己消失。
 */

import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowsClockwise, WifiSlash, Key } from '@phosphor-icons/react'
import { useQueryClient } from '@tanstack/react-query'
import { getAdapter, hasAdapter } from '@/api'
import { useServerStore } from '@/store/serverStore'
import { useT } from '@/i18n'

/** 浏览器报离线后多久探一次服务器 */
const PROBE_INTERVAL_MS = 20_000

export function ConnectionBanner() {
  const { t } = useT()
  const activeServerId = useServerStore(s => s.activeServerId)
  const [browserOffline, setBrowserOffline] = useState(() => !navigator.onLine)
  const [serverUnreachable, setServerUnreachable] = useState(false)
  /**
   * 凭据失效要和网络不通分开。
   *
   * 在别的设备上改了密码之后，这里原本会说「检查网络连接」，而重试按钮
   * 永远救不回来——用户被指向一个不存在的问题。这一态的正确出口是
   * 重新登录，不是重试。
   */
  const [unauthorized, setUnauthorized] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const queryClient = useQueryClient()
  const navigate = useNavigate()

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
        const adapter = getAdapter()
        // diagnose 是可选方法；没有它的适配器退回 ping 的二值语义
        const verdict = adapter.diagnose
          ? await adapter.diagnose()
          : (await adapter.ping()) ? 'ok' as const : 'unreachable' as const
        if (cancelled) return
        setUnauthorized(verdict === 'unauthorized')
        setServerUnreachable(verdict === 'unreachable')
      } catch {
        if (!cancelled) { setUnauthorized(false); setServerUnreachable(true) }
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
        const adapter = getAdapter()
        const verdict = adapter.diagnose
          ? await adapter.diagnose()
          : (await adapter.ping()) ? 'ok' as const : 'unreachable' as const
        setUnauthorized(verdict === 'unauthorized')
        setServerUnreachable(verdict === 'unreachable')
        if (verdict === 'ok') await queryClient.refetchQueries({ type: 'active' })
      }
      setBrowserOffline(!navigator.onLine)
    } finally {
      setRetrying(false)
    }
  }, [queryClient])

  const offline = browserOffline || serverUnreachable || unauthorized
  if (!offline) return null

  // 凭据失效：重试没有意义，给一个真正能解决问题的出口
  /**
   * 设备本身离线时，任何「服务器怎么说」的判定都不可信——那一刻我们
   * 根本没问到服务器。所以 browserOffline 的优先级高于 unauthorized，
   * 否则会出现「拔掉 Wi-Fi 之后被告知登录失效」这种把人引向错误方向的提示。
   */
  const showAuth = unauthorized && !browserOffline
  const message = showAuth ? t('empty.offline.auth')
    : browserOffline ? t('empty.offline.device') : t('empty.offline.server')
  const hint = showAuth ? t('empty.offline.authHint')
    : browserOffline ? t('empty.offline.deviceHint') : t('empty.offline.serverHint')

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-center gap-3 border-b border-hair bg-paper-deep px-4 py-1.5 text-[12px] text-ink-soft"
    >
      {showAuth
        ? <Key size={13} aria-hidden="true" className="text-primary flex-shrink-0" />
        : <WifiSlash size={13} aria-hidden="true" className="text-primary flex-shrink-0" />}
      <span>
        {message}
        <span className="text-ink-faint">{hint}</span>
      </span>
      {showAuth ? (
        <button
          onClick={() => navigate('/login')}
          className="inline-flex items-center gap-1 border-b border-ink-soft pb-px text-ink transition-colors duration-200 hover:border-primary hover:text-primary"
        >
          <Key size={11} aria-hidden="true" />
          {t('empty.offline.reauth')}
        </button>
      ) : (
        <button
          onClick={retry}
          disabled={retrying}
          className="inline-flex items-center gap-1 border-b border-ink-soft pb-px text-ink transition-colors duration-200 hover:border-primary hover:text-primary disabled:opacity-50"
        >
          <ArrowsClockwise size={11} className={retrying ? 'animate-spin' : undefined} aria-hidden="true" />
          {t('action.retry')}
        </button>
      )}
    </div>
  )
}
