/**
 * 空态、错误态、加载态共用的一块牌子。
 *
 * 三条规矩，全站一致：
 *   1. 标题是一句完整的话，带句号——它在跟你说话，不是一个状态标签；
 *   2. 说明句负责告诉你下一步能做什么，没有下一步就不写，不说废话；
 *   3. 行动是一枚纸片胶囊，不是实心大按钮——页头已经有这一屏唯一的强调色主操作。
 *
 * ruled 表示「列表本该在这里」：铺一张淡淡的格纸（工作纸），让空白仍有落点；
 * 不带 ruled 时只是居中的文字，用在整页兜底。
 */

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { spaceCJK } from '@/utils/cjkTypography'
import { useT } from '@/i18n'

/** 格纸面板：纸片底 + 格线，不画边 */
const WORK_PAPER = 'paper-grid rounded-lg bg-sheet shadow-card'

export function EmptyState({
  title,
  description,
  action,
  /** 铺一张格纸：用于「列表本该在这里」的位置，让空白仍然有落点 */
  ruled = false,
  className,
}: {
  title: string
  description?: string
  action?: { label: string; onClick: () => void }
  ruled?: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        'px-6 text-center',
        ruled ? `${WORK_PAPER} py-16` : 'py-20',
        className
      )}
    >
      <p className="font-display text-xl font-semibold text-ink">{spaceCJK(title)}</p>
      {description && (
        <p className="mx-auto mt-2 max-w-[34em] text-sm leading-relaxed text-ink-faint">
          {spaceCJK(description)}
        </p>
      )}
      {action && (
        <Button variant="outline" onClick={action.onClick} className="mt-6">
          {action.label}
        </Button>
      )}
    </div>
  )
}

/**
 * 加载中的立牌。
 *
 * 和空态同一个位置、同一套字号，只是话不同——这样从「加载中」变成「空」时
 * 版面不会跳。
 */
export function LoadingState({ label, ruled = false }: {
  label?: string
  ruled?: boolean
}) {
  const { t } = useT()
  return (
    <div className={cn('px-6 text-center', ruled ? `${WORK_PAPER} py-16` : 'py-20')}>
      <p className="font-display text-[15px] text-ink-faint">
        {spaceCJK(label ?? t('empty.loading'))}
      </p>
    </div>
  )
}
