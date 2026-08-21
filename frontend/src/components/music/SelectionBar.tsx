/**
 * 批量操作条。
 *
 * 选中任意一首歌后从列表底部升起，粘在滚动容器下沿。
 * 不用卡片、不用阴影堆叠——一条 2px 墨线加纸色底，和报头同一套语汇。
 */

import { Play, ListPlus, Plus, Heart, X, CheckSquare } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { useT } from '@/i18n'

export interface SelectionBarAction {
  key: string
  label: string
  icon: 'play' | 'next' | 'playlist' | 'star' | 'all'
  onClick: () => void
  /** 服务端不支持之类的情况下整项不出现 */
  hidden?: boolean
}

const ICONS = {
  play: Play,
  next: ListPlus,
  playlist: Plus,
  star: Heart,
  all: CheckSquare,
} as const

export function SelectionBar({
  count,
  total,
  actions,
  onClear,
  className,
}: {
  count: number
  total: number
  actions: SelectionBarAction[]
  onClear: () => void
  className?: string
}) {
  const { t } = useT()
  if (count === 0) return null
  return (
    <div
      role="toolbar"
      aria-label={t('selection.count', { count, total })}
      className={cn(
        'sticky bottom-0 z-20 -mx-1 mt-px flex flex-wrap items-center gap-x-1 gap-y-1',
        'border-t-2 border-ink bg-paper/95 px-1 py-2 backdrop-blur-sm',
        'animate-fade-in',
        className
      )}
    >
      <span className="font-num mr-2 whitespace-nowrap pl-1 text-[12px] tracking-[0.08em]">
        {t('selection.count', { count, total })}
      </span>

      {actions.filter(a => !a.hidden).map(action => {
        const Icon = ICONS[action.icon]
        return (
          <button
            key={action.key}
            onClick={action.onClick}
            className={cn(
              'flex items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-[12.5px]',
              'text-ink-soft transition-colors duration-200',
              'hover:bg-paper-deep hover:text-primary active:scale-[0.97]'
            )}
          >
            <Icon size={13} weight={action.icon === 'play' ? 'fill' : 'regular'} />
            {action.label}
          </button>
        )
      })}

      <button
        onClick={onClear}
        aria-label={t('selection.cancel')}
        className="ml-auto flex items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-[12.5px] text-ink-faint transition-colors duration-200 hover:text-ink"
      >
        <X size={13} />
        {t('action.cancel')}
      </button>
    </div>
  )
}
