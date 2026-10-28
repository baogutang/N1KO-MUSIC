/**
 * 空态、错误态、加载态共用的一块牌子（v6）。
 *
 * 三条规矩，全站一致：
 *   1. 标题是一句完整的话——它在跟你说话，不是一个状态标签；
 *   2. 说明句负责告诉你下一步能做什么，没有下一步就不写，不说废话；
 *   3. 行动是一枚中性胶囊，不是实心大按钮——页头已经有这一屏唯一的强调色主操作。
 *
 * 吉祥物：一种状态一个姿势——空收藏是眨眼的糯米（默认），「听了才会有」是戴耳机的毛豆，
 * 安静、没东西是睡着的糯米，「去搜一搜」是招手的毛豆，出错和找不到是吃惊的毛豆。
 * 它只是陪着，话都在文字里；不想要时传 mascot={false}。
 * ruled 表示「列表本该在这里」：铺一块下沉一档的面，让空白仍有落点；
 * 不带 ruled 时只是居中的内容，用在整页兜底。
 */

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Mascot, type MascotName } from '@/components/common/Mascot'
import { spaceCJK } from '@/utils/cjkTypography'
import { useT } from '@/i18n'

/** 「列表本该在这里」的落点：下沉一档的面，不画边、不画格 */
const WELL = 'rounded-lg bg-ink/[0.035]'

export function EmptyState({
  title,
  description,
  action,
  /** 铺一块下沉的面：用于「列表本该在这里」的位置，让空白仍然有落点 */
  ruled = false,
  mascot = 'nuomi-wink',
  className,
}: {
  title: string
  description?: string
  action?: { label: string; onClick: () => void }
  ruled?: boolean
  /** 陪在标题上面的吉祥物；false 不显示 */
  mascot?: MascotName | false
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center px-6 text-center',
        ruled ? `${WELL} py-12` : 'py-16',
        className
      )}
    >
      {mascot && <Mascot name={mascot} size={128} className="mb-4" />}
      <p className="font-display text-[20px] font-semibold tracking-[-0.015em] text-ink">{spaceCJK(title)}</p>
      {description && (
        <p className="mx-auto mt-2 max-w-[34em] text-[14px] leading-relaxed text-ink-3">
          {spaceCJK(description)}
        </p>
      )}
      {action && (
        <Button variant="secondary" onClick={action.onClick} className="mt-6">
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
 * 版面不会跳。加载很快就过去，不放吉祥物。
 */
export function LoadingState({ label, ruled = false }: {
  label?: string
  ruled?: boolean
}) {
  const { t } = useT()
  return (
    <div className={cn('px-6 text-center', ruled ? `${WELL} py-12` : 'py-16')}>
      <p className="font-display text-[15px] text-ink-3 animate-pulse motion-reduce:animate-none">
        {spaceCJK(label ?? t('empty.loading'))}
      </p>
    </div>
  )
}
