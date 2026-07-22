/**
 * 播放队列面板（杂志编辑风，DESIGN v2）
 * 右侧滑出：纸面底、左缘 1px 发丝线、宽 320px、浮层淡投影
 * 编号行（mono 序号 + 衬线曲名 + mono 时长），当前行 accent + EQ 动画
 * 支持拖拽排序、删除、清空（二次确认）
 */

import { useState, useCallback } from 'react'
import { X, DotsSixVertical, Play } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { usePlayerStore } from '@/store/playerStore'
import { formatDuration } from '@/utils/formatters'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

export function QueueDrawer() {
  const queue           = usePlayerStore(s => s.queue)
  const queueIndex      = usePlayerStore(s => s.queueIndex)
  const isQueueOpen     = usePlayerStore(s => s.isQueueOpen)
  const isPlaying       = usePlayerStore(s => s.isPlaying)
  const setQueueOpen    = usePlayerStore(s => s.setQueueOpen)
  const jumpToIndex     = usePlayerStore(s => s.jumpToIndex)
  const removeFromQueue = usePlayerStore(s => s.removeFromQueue)
  const reorderQueue    = usePlayerStore(s => s.reorderQueue)
  const clearQueue      = usePlayerStore(s => s.clearQueue)

  const [confirmClear, setConfirmClear] = useState(false)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  const handleDragStart = useCallback((index: number) => {
    setDragIndex(index)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault()
    setOverIndex(index)
  }, [])

  const handleDrop = useCallback((index: number) => {
    if (dragIndex !== null && dragIndex !== index) {
      reorderQueue(dragIndex, index)
    }
    setDragIndex(null)
    setOverIndex(null)
  }, [dragIndex, reorderQueue])

  if (!isQueueOpen) return null

  return (
    <>
      {/* 右侧滑出面板：停在内容区（不遮挡报头与播放条） */}
      <div className="absolute inset-y-0 right-0 z-30 w-[320px] bg-paper border-l border-hair shadow-float flex flex-col animate-slide-in-right">
        {/* 头部：衬线标题 + 清空 / 关闭 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-hair flex-shrink-0">
          <h3 className="font-serif font-bold text-[17px]">播放队列</h3>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setConfirmClear(true)}
              className="text-[12px] tracking-[0.14em] text-ink-soft hover:text-primary transition-colors duration-200"
            >
              清空
            </button>
            <button
              onClick={() => setQueueOpen(false)}
              className="w-7 h-7 rounded-full flex items-center justify-center text-ink-soft hover:text-primary transition-colors duration-200 active:scale-95"
              aria-label="关闭队列"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <ScrollArea className="flex-1">
          {queue.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="font-serif text-[15px] text-foreground">队列还是空的</p>
              <p className="text-[12px] text-ink-faint mt-1">去音乐库挑几首歌放进来</p>
            </div>
          ) : (
            <ol>
              {queue.map((song, index) => {
                const isCurrent = index === queueIndex

                return (
                  <li
                    key={`${song.id}-${index}`}
                    draggable
                    onDragStart={() => handleDragStart(index)}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDrop={() => handleDrop(index)}
                    onDragEnd={() => { setDragIndex(null); setOverIndex(null) }}
                    onClick={() => jumpToIndex(index)}
                    className={cn(
                      'group flex items-center gap-3 px-4 py-2.5 border-b border-hair-soft cursor-pointer transition-colors duration-150',
                      'hover:bg-paper-deep/60',
                      overIndex === index && dragIndex !== null && 'ring-1 ring-inset ring-primary/40',
                      dragIndex === index && 'opacity-50'
                    )}
                  >
                    {/* 序号：当前行 accent / 播放中换 EQ；hover 浮现拖拽柄 */}
                    <span className="w-5 flex-shrink-0 flex items-center justify-center">
                      {isCurrent && isPlaying ? (
                        <span className="playing-bar" aria-hidden="true">
                          <span /><span /><span />
                        </span>
                      ) : (
                        <>
                          <span
                            className={cn(
                              'font-num text-[11px] group-hover:hidden',
                              isCurrent ? 'text-primary' : 'text-ink-faint'
                            )}
                          >
                            {String(index + 1).padStart(2, '0')}
                          </span>
                          <DotsSixVertical
                            size={14}
                            aria-hidden="true"
                            className="hidden group-hover:block text-ink-faint cursor-grab active:cursor-grabbing"
                          />
                        </>
                      )}
                    </span>

                    <span className="flex-1 min-w-0">
                      <span
                        className={cn(
                          'block font-serif text-[13.5px] font-semibold truncate',
                          isCurrent ? 'text-primary' : 'text-foreground'
                        )}
                      >
                        {song.title}
                      </span>
                      <span className="block text-[11px] text-ink-faint truncate mt-0.5">
                        {song.artist}
                      </span>
                    </span>

                    <span className="font-num text-[11px] text-ink-faint flex-shrink-0">
                      {formatDuration(song.duration)}
                    </span>

                    <span className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex-shrink-0">
                      <button
                        onClick={(e) => { e.stopPropagation(); jumpToIndex(index) }}
                        className="w-6 h-6 rounded-full flex items-center justify-center text-ink-soft hover:text-primary transition-colors duration-150 active:scale-95"
                        aria-label="播放"
                      >
                        <Play size={11} weight="fill" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); removeFromQueue(index) }}
                        className="w-6 h-6 rounded-full flex items-center justify-center text-ink-soft hover:text-primary transition-colors duration-150 active:scale-95"
                        aria-label="移除"
                      >
                        <X size={12} />
                      </button>
                    </span>
                  </li>
                )
              })}
            </ol>
          )}
        </ScrollArea>

        {queue.length > 0 && (
          <div className="px-5 py-2.5 border-t border-hair flex-shrink-0">
            <p className="text-[11px] text-ink-faint text-center">
              <span className="font-num">{queue.length}</span> 首歌曲 · <span className="font-num">{queueIndex + 1} / {queue.length}</span>
            </p>
          </div>
        )}
      </div>

      <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>清空播放队列？</DialogTitle>
            <DialogDescription>
              将移除队列中的其他歌曲，当前正在播放的歌曲会保留。
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setConfirmClear(false)}>取消</Button>
            <Button
              variant="destructive"
              onClick={() => {
                clearQueue()
                setConfirmClear(false)
              }}
            >
              清空
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
