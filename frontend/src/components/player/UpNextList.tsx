/**
 * 「接下来」：按实际播放顺序列出后面几首（开着随机就按随机序，与队列抽屉同一套判定）。
 * 宽窗口的正在播放面板与全屏播放器共用。
 *
 * 也是一个落点：把任何列表里的歌拖到这里，它会接在队列最后
 * （iPadOS 接妙控板拖、桌面直接拖；见 lib/songDrag）。
 */

import { useMemo, useState } from 'react'
import type { DragEvent } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { cn } from '@/lib/utils'
import { SPRING_SMOOTH } from '@/lib/motion'
import { usePlayerStore } from '@/store/playerStore'
import { findAdapterFor } from '@/api'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'
import { spaceCJK } from '@/utils/cjkTypography'
import { isSongDrag, readSongDrag, endSongDrag } from '@/lib/songDrag'
import { toast } from '@/components/ui/use-toast'
import { useT } from '@/i18n'

export function UpNextList({ count, className, onOpenQueue }: { count: number; className?: string; onOpenQueue?: () => void }) {
  const { t } = useT()
  const queue = usePlayerStore(s => s.queue)
  const queueIndex = usePlayerStore(s => s.queueIndex)
  const shuffle = usePlayerStore(s => s.shuffle)
  const shuffledIndexes = usePlayerStore(s => s.shuffledIndexes)
  const jumpToIndex = usePlayerStore(s => s.jumpToIndex)
  const addToQueue = usePlayerStore(s => s.addToQueue)
  const [dropActive, setDropActive] = useState(false)
  const reduce = useReducedMotion()

  const upNext = useMemo(() => {
    const identity = queue.map((_, i) => i)
    const order = shuffle && shuffledIndexes.length === queue.length && new Set(shuffledIndexes).size === queue.length
      ? shuffledIndexes
      : identity
    const pos = order.indexOf(queueIndex)
    return order.slice(pos + 1, pos + 1 + count).map(i => ({ index: i, song: queue[i] }))
  }, [queue, queueIndex, shuffle, shuffledIndexes, count])

  const onDragOver = (e: DragEvent) => {
    if (!isSongDrag(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDropActive(true)
  }
  const onDrop = (e: DragEvent) => {
    const songs = readSongDrag(e)
    setDropActive(false)
    if (!songs) return
    e.preventDefault()
    addToQueue(songs, 'last')
    endSongDrag()
    toast({ title: t('shell.addedToQueue', { count: songs.length }) })
  }

  return (
    <section
      onDragOver={onDragOver}
      onDragLeave={() => setDropActive(false)}
      onDrop={onDrop}
      className={cn(
        'flex flex-col rounded-md transition-colors duration-2',
        dropActive && 'bg-lime/20 outline outline-2 outline-offset-2 outline-leaf/60',
        className
      )}
      aria-label={t('shell.upNext')}
    >
      <div className="flex items-baseline justify-between pb-1.5">
        <h3 className="font-display text-[15px] font-semibold text-ink">{t('shell.upNext')}</h3>
        {onOpenQueue && (
          <button onClick={onOpenQueue} className="rounded-xs text-[13px] font-semibold text-leaf hover:underline">
            {t('player.queue')}
          </button>
        )}
      </div>
      {upNext.length === 0 ? (
        <p className="rounded-md bg-ink/[0.05] px-3 py-3 text-[13px] text-ink-3">{t('shell.upNextEmpty')}</p>
      ) : (
        <ol className="flex flex-col">
          <AnimatePresence initial={!reduce}>
          {upNext.map(({ index, song }, position) => {
            const cover = song.coverArt ? findAdapterFor(song.serverId)?.getCoverUrl(song.coverArt, 80) ?? undefined : undefined
            // 列表一出现就像从牌堆里一张张发出来；切歌时其余行原地往上挪（layout），不会消失再出现
            return (
              <motion.li
                key={`${song.id}-${index}`}
                // 只有看得见的前 8 行做位置动画：舞台里一次 40 行，每次切歌全量 FLIP 测量太重
                layout={reduce || position >= 8 ? false : 'position'}
                initial={reduce ? false : { opacity: 0, x: -14 }}
                animate={{ opacity: 1, x: 0 }}
                exit={reduce ? undefined : { opacity: 0, scale: 0.96 }}
                transition={{ ...SPRING_SMOOTH, delay: reduce ? 0 : Math.min(position, 10) * 0.025 }}
              >
                <button
                  onClick={() => jumpToIndex(index)}
                  className="press-pop flex w-full items-center gap-3 rounded-[12px] px-2 py-2 text-left hover:bg-ink/[0.06]"
                >
                  <span className="cover-frame h-11 w-11 flex-none rounded-[9px] shadow-sm">
                    <ImageWithFallback src={cover} alt="" fallbackType="album" className="h-full w-full" />
                  </span>
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className="truncate text-[14.5px] font-semibold text-ink">{spaceCJK(song.title)}</span>
                    <span className="mt-0.5 truncate text-[13px] text-ink-3">{spaceCJK(song.artist)}</span>
                  </span>
                </button>
              </motion.li>
            )
          })}
          </AnimatePresence>
        </ol>
      )}
    </section>
  )
}
