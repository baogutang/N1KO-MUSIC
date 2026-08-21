/**
 * 五星评分。
 *
 * Song.userRating 早就映射并只读展示了，此前唯一缺的是写回。
 * 用发丝线小星，点同一星再点一次即清零——这是评分控件的通用预期，
 * 否则用户永远没法取消一个误点。
 */

import { useState } from 'react'
import { Star } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { useSetRating } from '@/hooks/useServerQueries'
import { toast } from '@/components/ui/use-toast'
import { useT } from '@/i18n'

export function StarRating({
  id,
  type = 'song',
  value,
  size = 14,
  className,
}: {
  id: string
  type?: 'song' | 'album'
  value?: number
  size?: number
  className?: string
}) {
  const { t } = useT()
  const setRating = useSetRating()
  const [hover, setHover] = useState(0)
  const current = value ?? 0
  const shown = hover || current

  function apply(next: number) {
    // 点当前分值等于取消
    const rating = next === current ? 0 : next
    setRating.mutate({ id, rating, type }, {
      onError: () => toast({ title: t('rating.saveFailed'), variant: 'destructive' }),
    })
  }

  return (
    <div
      className={cn('inline-flex items-center gap-0.5', className)}
      role="radiogroup"
      aria-label={t('rating.label')}
      onMouseLeave={() => setHover(0)}
    >
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={current === n}
          aria-label={t('rating.stars', { count: n })}
          onMouseEnter={() => setHover(n)}
          onClick={e => { e.stopPropagation(); apply(n) }}
          className={cn(
            'p-0.5 transition-colors duration-150 active:scale-90',
            n <= shown ? 'text-primary' : 'text-ink-faint hover:text-ink-soft'
          )}
        >
          <Star size={size} weight={n <= shown ? 'fill' : 'regular'} />
        </button>
      ))}
      {current > 0 && (
        <span className="font-num ml-1.5 text-[10.5px] text-ink-faint">{current}/5</span>
      )}
    </div>
  )
}
