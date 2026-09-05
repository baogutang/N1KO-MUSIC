/**
 * 单个音源在某个区块里的「加载中 / 失败」状态行。
 *
 * 为什么要有它——多音源下最伤的一种失败是**静默消失**：
 * 各个区块都写着 `filter(g => g.status === 'success')`，于是一个音源
 * 挂掉之后不是「显示一条错误」，而是整行、整节从页面上不见了。
 * 用户看到的不是「网易云出错了」，是「网易云好像没连过」——
 * 他不会去重试，因为他不知道有什么东西失败了。
 *
 * 三态必须长得不一样：加载中是骨架、失败是带重试的说明、真的没内容才是空态。
 * 这个组件负责前两个，空态留给各区块自己（文案各不相同）。
 */

import { ArrowsClockwise } from '@phosphor-icons/react'
import { SourceBadge } from '@/components/sources/SourceBadge'
import { useT } from '@/i18n'

export interface SourceGroupStateProps {
  serverId: string
  status: 'loading' | 'success' | 'error'
  /** 失败时的原始信息，仅在开发态展示；正式文案由 i18n 提供 */
  error?: string
  /** 有重试入口时给一个；没有就只显示说明 */
  onRetry?: () => void
}

export function SourceGroupState({ serverId, status, error, onRetry }: SourceGroupStateProps) {
  const { t } = useT()
  if (status === 'success') return null

  if (status === 'loading') {
    return (
      <div className="flex items-center gap-3 py-3" aria-live="polite">
        <SourceBadge serverId={serverId} withName />
        <span className="h-3 flex-1 max-w-[220px] animate-pulse rounded-sm bg-skeleton" />
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
