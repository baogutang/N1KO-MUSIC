/**
 * 批量操作条。
 *
 * 选中任意一首歌后从列表底部升起，粘在滚动容器下沿——
 * 停在底部播放区的上方（--dock-h 是外壳量出来的播放区高度），不被它盖住。
 * 一片浮起的纸片（glass），动作是纸片里的文字胶囊，靠 hover 底区分，不画线。
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
        'glass sticky bottom-[calc(var(--dock-h,96px)+12px)] z-20 mt-3 flex flex-wrap items-center gap-x-1 gap-y-1',
        'rounded-lg px-3 py-1.5',
        'animate-fade-in motion-reduce:animate-none',
        className
      )}
    >
      <span className="num mr-2 whitespace-nowrap pl-1 text-[13.5px] font-medium">
        {t('selection.count', { count, total })}
      </span>

      {actions.filter(a => !a.hidden).map(action => {
        const Icon = ICONS[action.icon]
        return (
          <button
            key={action.key}
            onClick={action.onClick}
            className={cn(
              'flex min-h-11 items-center gap-1.5 rounded-pill px-3.5 text-[13.5px] font-medium',
              'text-ink-soft transition-colors duration-150',
              'hover:bg-paper-deep hover:text-ink active:scale-[0.97]'
            )}
          >
            <Icon size={15} weight={action.icon === 'play' ? 'fill' : 'regular'} />
            {action.label}
          </button>
        )
      })}

      <button
        onClick={onClear}
        aria-label={t('selection.cancel')}
        className="ml-auto flex min-h-11 items-center gap-1.5 rounded-pill px-3.5 text-[13.5px] font-medium text-ink-faint transition-colors duration-150 hover:bg-paper-deep hover:text-ink"
      >
        <X size={15} />
        {t('action.cancel')}
      </button>
    </div>
  )
}
