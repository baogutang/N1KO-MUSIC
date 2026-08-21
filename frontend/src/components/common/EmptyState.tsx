/**
 * 立牌：空态、错误态、加载态共用的一块牌子。
 *
 * 之前每一页各写各的：有的 py-24 有的 py-20，有的带上缘发丝线有的不带，
 * 标题有的 text-xl font-semibold 有的 text-lg text-ink-soft，
 * 说明句有的有有的没有。单看每一处都没问题，连起来翻就像几本不同的刊物。
 *
 * 三条规矩，全站一致：
 *   1. 标题是一句**完整的话**，带句号——它是编辑在跟你说话，不是一个状态标签；
 *   2. 说明句负责告诉你下一步能做什么，没有下一步就不写，不说废话；
 *   3. 行动是文字级下划线按钮，不是实心大按钮——那是这套设计里唯一的按钮语汇。
 */

import { cn } from '@/lib/utils'
import { spaceCJK } from '@/utils/cjkTypography'

export function EmptyState({
  title,
  description,
  action,
  /** 上缘加一条发丝线：用于「列表本该在这里」的位置，让空白仍然在版心里 */
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
        'py-20 text-center',
        ruled && 'border-t border-hair',
        className
      )}
    >
      <p className="font-serif text-xl font-semibold text-ink">{spaceCJK(title)}</p>
      {description && (
        <p className="mx-auto mt-2 max-w-[34em] text-sm text-ink-faint">
          {spaceCJK(description)}
        </p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-6 inline-flex items-center gap-2 text-sm font-semibold underline decoration-hair decoration-1 underline-offset-[6px] transition-colors duration-200 hover:text-primary hover:decoration-primary active:scale-[0.97]"
        >
          {action.label}
        </button>
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
export function LoadingState({ label = '正在加载…', ruled = false }: {
  label?: string
  ruled?: boolean
}) {
  return (
    <div className={cn('py-20 text-center', ruled && 'border-t border-hair')}>
      <p className="font-serif text-[15px] text-ink-faint">{spaceCJK(label)}</p>
    </div>
  )
}
