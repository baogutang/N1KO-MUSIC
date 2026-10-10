/**
 * 单个音源在某个区块里的「加载中 / 失败 / 需要重新登录」状态行。
 *
 * 为什么要有它——多音源下最伤的一种失败是**静默消失**：
 * 各个区块都写着 `filter(g => g.status === 'success')`，于是一个音源
 * 挂掉之后不是「显示一条错误」，而是整行、整节从页面上不见了。
 * 用户看到的不是「网易云出错了」，是「网易云好像没连过」——
 * 他不会去重试，因为他不知道有什么东西失败了。
 *
 * 三态必须长得不一样：加载中是骨架、失败是带重试的说明、真的没内容才是空态。
 * 这个组件负责前两个，空态留给各区块自己（文案各不相同）。
 *
 * 阶段 2.3 加了第四种：登录过期的 auth 态。它与普通失败的区别是
 * **重试救不回来**——正确的出口是「去登录」，而不是让用户对着一个
 * 永远失败的重试按钮。数据接口抛出的 unauthorized（PROTOCOL §7）
 * 经 zipQueryResults 的 errorCode 汇到这里，不再被当成普通 load error 吞掉。
 */

import { ArrowsClockwise, Key } from '@phosphor-icons/react'
import { useNavigate } from 'react-router-dom'
import { SourceBadge } from '@/components/sources/SourceBadge'
import { rateBackoffRemaining } from '@/plugins/host/PluginHost'
import { useServerStore } from '@/store/serverStore'
import { useT } from '@/i18n'

export interface SourceGroupStateProps {
  serverId: string
  status: 'loading' | 'success' | 'error' | 'auth'
  /** 失败时的原始信息，仅在开发态展示；正式文案由 i18n 提供 */
  error?: string
  /** 有重试入口时给一个；没有就只显示说明 */
  onRetry?: () => void
}

export function SourceGroupState({ serverId, status, error, onRetry }: SourceGroupStateProps) {
  const { t } = useT()
  const navigate = useNavigate()
  const pluginId = useServerStore(s => s.servers.find(x => x.id === serverId)?.pluginId)
  if (status === 'success') return null

  if (status === 'loading') {
    return (
      <div className="flex items-center gap-3 py-3" aria-live="polite">
        <SourceBadge serverId={serverId} withName />
        <span className="h-3 flex-1 max-w-[220px] animate-pulse rounded-sm bg-skeleton" />
      </div>
    )
  }

  /* 登录过期：去登录，不是重试 */
  if (status === 'auth') {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-3" role="status">
        <SourceBadge serverId={serverId} withName />
        <span className="text-[13px] text-ink-soft">{t('sources.authExpired')}</span>
        <button
          className="more inline-flex items-center gap-1.5"
          onClick={() => navigate(pluginId ? `/login?plugin=${encodeURIComponent(pluginId)}&relogin=1` : '/login')}
        >
          <Key size={12} />
          {t('sources.goRelogin')}
        </button>
        {/* 原始信息只在开发态露出：正式界面上一段英文异常帮不了任何人 */}
        {import.meta.env.DEV && error && (
          <span className="w-full font-mono text-[11px] text-ink-faint">{error.slice(0, 160)}</span>
        )}
      </div>
    )
  }

  /* 频控退避中（6.8）：说明剩余时间，不给重试——重试只会把封禁越打越长 */
  const backoffSec = Math.ceil(rateBackoffRemaining(serverId) / 1000)
  if (backoffSec > 0) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-3" role="status">
        <SourceBadge serverId={serverId} withName />
        <span className="text-[13px] text-ink-soft">{t('sources.rateLimited', { seconds: backoffSec })}</span>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-3" role="status">
      <SourceBadge serverId={serverId} withName />
      <span className="text-[13px] text-destructive">{t('sources.loadError')}</span>
      {onRetry && (
        <button
          className="more inline-flex items-center gap-1.5"
          onClick={onRetry}
        >
          <ArrowsClockwise size={12} />
          {t('action.retry')}
        </button>
      )}
      {/* 原始信息只在开发态露出：正式界面上一段英文异常帮不了任何人 */}
      {import.meta.env.DEV && error && (
        <span className="w-full font-mono text-[11px] text-ink-faint">{error.slice(0, 160)}</span>
      )}
    </div>
  )
}

/** 分组状态 → SourceGroupState 的 status：unauthorized 单独成 auth 态 */
export function groupStateStatus(group: { status: 'loading' | 'success' | 'error'; errorCode?: string })
  : 'loading' | 'success' | 'error' | 'auth' {
  if (group.status === 'error' && group.errorCode === 'unauthorized') return 'auth'
  return group.status
}

/**
 * 频控退避的剩余秒数（阶段 6.8）：PluginHost 撞上 rate-limited 后按源记账
 * 60 秒，期间界面要能说清「这不是坏了，是一分钟后再来」。
 */
export function rateLimitedSeconds(serverId: string): number {
  const remaining = rateBackoffRemaining(serverId)
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0
}
