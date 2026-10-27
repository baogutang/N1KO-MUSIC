/**
 * 「接下来」：按实际播放顺序列出后面几首（开着随机就按随机序，与队列抽屉同一套判定）。
 * 宽窗口的正在播放面板与全屏播放器共用。
 *
 * 也是一个落点：把任何列表里的歌拖到这里，它会接在队列最后
 * （iPadOS 接妙控板拖、桌面直接拖；见 lib/songDrag）。
 */

import { useMemo, useState } from 'react'
import type { DragEvent } from 'react'
import { cn } from '@/lib/utils'
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
        'flex flex-col rounded-md transition-colors',
        dropActive && 'bg-primary/10 outline outline-2 outline-offset-2 outline-primary/60',
        className
      )}
      aria-label={t('shell.upNext')}
    >
      <div className="flex items-baseline justify-between pb-1.5">
        <h3 className="text-[14px] font-semibold text-ink">{t('shell.upNext')}</h3>
        {onOpenQueue && (
          <button onClick={onOpenQueue} className="rounded-sm text-[13px] font-medium text-primary hover:underline">
            {t('player.queue')}
          </button>
        )}
      </div>
      {upNext.length === 0 ? (
        <p className="rounded-md bg-paper-deep px-3 py-3 text-[13px] text-ink-faint">{t('shell.upNextEmpty')}</p>
      ) : (
        <ol className="flex flex-col">
          {upNext.map(({ index, song }) => {
            const cover = song.coverArt ? findAdapterFor(song.serverId)?.getCoverUrl(song.coverArt, 80) ?? undefined : undefined
            return (
              <li key={`${song.id}-${index}`}>
                <button
                  onClick={() => jumpToIndex(index)}
                  className="flex w-full items-center gap-3 rounded-sm px-1.5 py-1.5 text-left transition-colors hover:bg-paper-deep"
                >
                  <span className="h-10 w-10 flex-none overflow-hidden rounded-[8px] bg-paper-3">
                    <ImageWithFallback src={cover} alt="" fallbackType="album" className="h-full w-full" />
                  </span>
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className="truncate text-[14px] font-medium text-ink">{spaceCJK(song.title)}</span>
                    <span className="mt-0.5 truncate text-[12.5px] text-ink-faint">{spaceCJK(song.artist)}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
