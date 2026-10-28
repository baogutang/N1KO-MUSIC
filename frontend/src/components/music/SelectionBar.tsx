/**
 * 批量操作条。
 *
 * 选中任意一首歌后从列表底部升起，粘在滚动容器下沿——
 * 停在底部播放区的上方（--dock-h 是外壳量出来的播放区高度），不被它盖住。
 * 一枚浮起的玻璃胶囊：图标 + 文字的动作键，主动作（播放）是青柠，其余靠 hover 底区分，不画线。
 * 入场走弹簧（减弱动态时直接出现）。
 */

import { Play, ListPlus, Plus, Heart, X, CheckSquare } from '@phosphor-icons/react'
import { motion, useReducedMotion } from 'motion/react'
import { cn } from '@/lib/utils'
import { SPRING_SNAPPY } from '@/lib/motion'
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

/** 胶囊里的键：44px 高；圆角 = 胶囊圆角 22 − 内边距 8，贴着外壳的弧度 */
const BAR_BUTTON =
  'press-pop flex h-11 items-center gap-1.5 rounded-[14px] px-3.5 text-[14px] font-semibold'

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
  const reduceMotion = useReducedMotion()
  if (count === 0) return null
  return (
    <motion.div
      role="toolbar"
      aria-label={t('selection.count', { count, total })}
      initial={reduceMotion ? false : { opacity: 0, y: 14, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={SPRING_SNAPPY}
      className={cn(
        'glass sticky bottom-[calc(var(--dock-h,96px)+12px)] z-sticky mx-auto mt-3 flex w-fit max-w-full flex-wrap items-center gap-1',
        'rounded-[22px] p-2',
        className
      )}
    >
      <span className="num whitespace-nowrap px-3 text-[14px] font-semibold text-ink">
        {t('selection.count', { count, total })}
      </span>

      {actions.filter(a => !a.hidden).map(action => {
        const Icon = ICONS[action.icon]
        const primary = action.icon === 'play'
        return (
          <button
            key={action.key}
            onClick={action.onClick}
            className={cn(
              BAR_BUTTON,
              primary
                ? 'bg-lime text-lime-ink hover:bg-lime-deep'
                : 'text-ink-2 hover:bg-ink/[0.06] hover:text-ink'
            )}
          >
            <Icon size={18} weight={primary ? 'fill' : 'regular'} />
            {action.label}
          </button>
        )
      })}

      <button
        onClick={onClear}
        aria-label={t('selection.cancel')}
        className={cn(BAR_BUTTON, 'ml-auto text-ink-3 hover:bg-ink/[0.06] hover:text-ink')}
      >
        <X size={18} />
        {t('action.cancel')}
      </button>
    </motion.div>
  )
}
