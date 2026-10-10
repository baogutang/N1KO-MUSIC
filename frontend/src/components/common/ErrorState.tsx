/**
 * 加载失败的统一立牌（阶段 7.1）。
 *
 * 此前同一件事有三种说法：EmptyState + error.load.*（有的带重试有的不带）、
 * EmptyState + empty.loadFailed.*、一行灰字 sources.loadError。收敛为一个
 * 组件与一组词条（error.load.*）：能重试给重试，不能重试给返回，都没有
 * 就只说明情况。
 */

import { EmptyState } from '@/components/common/EmptyState'
import { useT } from '@/i18n'

export function ErrorState({
  ruled = true,
  /** 有重试就给重试（列表类查询：再问一次多半就好） */
  retry,
  /** 不能重试时给个返回（详情页进错/源断了） */
  onBack,
  className,
}: {
  ruled?: boolean
  retry?: () => void
  onBack?: () => void
  className?: string
}) {
  const { t } = useT()
  return (
    <EmptyState
      ruled={ruled}
      className={className}
      title={t('error.load.title')}
      description={t('error.load.description')}
      action={
        retry
          ? { label: t('action.retry'), onClick: retry }
          : onBack
            ? { label: t('action.back'), onClick: onBack }
            : undefined
      }
    />
  )
}
