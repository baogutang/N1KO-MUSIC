/**
 * 字母 / 拼音索引轨。
 *
 * 一千位歌手靠滚轮找人是不可行的，而索引字母本身不该由前端猜：Navidrome
 * 已经算好了 sortName、忽略冠词表，中文库还按拼音归位——照搬服务端给的桶名，
 * 顺序才和列表本身一致。服务端没给的（Jellyfin/Emby）才退回首字母粗分。
 *
 * 轨在右侧贴边，触摸时可以直接顺着滑（iOS 通讯录的手势），
 * 桌面点一下即跳。外观很克制：一列小字母，没有底，当前字母是叶绿色并略放大。
 */

import { useCallback, useRef } from 'react'
import { cn } from '@/lib/utils'
import { useT } from '@/i18n'

/** 无法归入 A–Z 的一律进这一桶 */
export const OTHER_BUCKET = '#'

export interface IndexBucket<T> {
  letter: string
  items: T[]
}

/** 服务端没给索引字母时的兜底：拉丁首字母，其余全进 # */
function fallbackLetter(name: string): string {
  const first = name.trim().charAt(0).toUpperCase()
  return first >= 'A' && first <= 'Z' ? first : OTHER_BUCKET
}

/**
 * 按索引字母分桶，**保持传入顺序**——列表顺序是服务端的排序结果，
 * 这里重排只会让轨和列表对不上。
 */
export function buildIndexBuckets<T>(
  items: T[],
  getLetter: (item: T) => string | undefined,
  getName: (item: T) => string
): IndexBucket<T>[] {
  const buckets: IndexBucket<T>[] = []
  let current: IndexBucket<T> | null = null
  for (const item of items) {
    const raw = getLetter(item)?.trim()
    const letter = raw && raw.length <= 2 ? raw.toUpperCase() : fallbackLetter(getName(item))
    if (!current || current.letter !== letter) {
      current = { letter, items: [] }
      buckets.push(current)
    }
    current.items.push(item)
  }
  return buckets
}

export function IndexRail({
  letters,
  activeLetter,
  onJump,
  className,
}: {
  letters: string[]
  activeLetter?: string
  onJump: (letter: string) => void
  className?: string
}) {
  const { t } = useT()
  const railRef = useRef<HTMLDivElement>(null)
  const lastRef = useRef<string | null>(null)

  /** 触摸滑动：按触点落在哪个字母上连续跳转 */
  const jumpFromPoint = useCallback((clientY: number) => {
    const rail = railRef.current
    if (!rail) return
    const target = document.elementFromPoint(
      rail.getBoundingClientRect().left + rail.clientWidth / 2,
      clientY
    )
    const letter = target?.closest<HTMLElement>('[data-letter]')?.dataset.letter
    if (letter && letter !== lastRef.current) {
      lastRef.current = letter
      onJump(letter)
    }
  }, [onJump])

  if (letters.length < 3) return null

  return (
    <div
      ref={railRef}
      role="navigation"
      aria-label={t('index.jump')}
      onTouchStart={e => { lastRef.current = null; jumpFromPoint(e.touches[0].clientY) }}
      onTouchMove={e => { e.preventDefault(); jumpFromPoint(e.touches[0].clientY) }}
      className={cn(
        // 两侧留的内边距是给手指的：触点落在轨内任意位置，都按纵向位置换算成字母
        'sticky top-[calc(env(safe-area-inset-top)+68px)] flex max-h-[70vh] select-none flex-col items-center overflow-hidden px-1.5 py-1',
        'touch-none',
        className
      )}
    >
      {letters.map(letter => (
        <button
          key={letter}
          data-letter={letter}
          onClick={() => onJump(letter)}
          aria-label={t('index.jumpTo', { letter })}
          aria-current={activeLetter === letter ? 'true' : undefined}
          className={cn(
            'num grid h-[18px] w-6 place-items-center text-[11px] font-semibold leading-none',
            'transition-[transform,color] duration-2 ease-out',
            activeLetter === letter
              ? 'scale-125 text-leaf'
              : 'text-ink-3 [@media(hover:hover)]:hover:text-ink'
          )}
        >
          {letter}
        </button>
      ))}
    </div>
  )
}
