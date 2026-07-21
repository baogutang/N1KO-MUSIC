/**
 * 播放队列抽屉 — 悬浮玻璃面板（现代 Hi-Fi 设计，见 DESIGN.md）
 * 显示当前播放列表，支持拖拽排序、删除
 */

import { useState, useCallback } from 'react'
import { X, DotsSixVertical, Play } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { usePlayerStore } from '@/store/playerStore'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'
import { getAdapter, hasAdapter } from '@/api'
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
      {/* 悬浮玻璃面板：下沿停在悬浮控制台上方（--player-height 108px - 8px 间距）*/}
      <div className="absolute top-3 right-4 bottom-[calc(var(--player-height)-8px)] z-30 w-80 rounded-lg glass shadow-[0_18px_46px_-18px_rgba(0,0,0,0.55)] flex flex-col overflow-hidden animate-slide-up">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="font-bold text-sm">播放队列</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setConfirmClear(true)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              清空
            </button>
            <button
              onClick={() => setQueueOpen(false)}
              className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors active:scale-[0.94]"
              aria-label="关闭队列"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-2 space-y-0.5">
            {queue.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                队列为空
              </p>
            ) : (
              queue.map((song, index) => {
                const isCurrent = index === queueIndex
                const coverUrl = song.coverArt && hasAdapter()
                  ? getAdapter().getCoverUrl(song.coverArt, 64)
                  : undefined

                return (
                  <div
                    key={`${song.id}-${index}`}
                    draggable
                    onDragStart={() => handleDragStart(index)}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDrop={() => handleDrop(index)}
                    onDragEnd={() => { setDragIndex(null); setOverIndex(null) }}
                    className={cn(
                      'flex items-center gap-2 px-2 py-2 rounded-md cursor-pointer group transition-colors',
                      isCurrent ? 'bg-primary/10' : 'hover:bg-surface',
                      overIndex === index && dragIndex !== null && 'ring-1 ring-primary/40',
                      dragIndex === index && 'opacity-50'
                    )}
                    onClick={() => jumpToIndex(index)}
                  >
                    {isCurrent && isPlaying ? (
                      <span className="playing-bar w-4 justify-center flex-shrink-0" aria-hidden="true">
                        <span /><span /><span />
                      </span>
                    ) : (
                      <DotsSixVertical
                        size={16}
                        className={cn(
                          'flex-shrink-0 cursor-grab active:cursor-grabbing',
                          isCurrent ? 'text-primary/50' : 'text-muted-foreground/40'
                        )}
                      />
                    )}

                    <div className="w-9 h-9 rounded-md ring-1 ring-border overflow-hidden flex-shrink-0">
                      <ImageWithFallback
                        src={coverUrl}
                        alt={song.album}
                        fallbackType="album"
                        className="w-full h-full"
                        customCoverParams={{ type: 'song', title: song.title, artist: song.artist, album: song.album, path: song.path }}
                      />
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className={cn(
                        'text-xs font-medium line-clamp-1',
                        isCurrent ? 'text-primary' : 'text-foreground'
                      )}>
                        {song.title}
                      </p>
                      <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                        {song.artist}
                      </p>
                    </div>

                    <span className="font-num text-xs text-muted-foreground flex-shrink-0">
                      {formatDuration(song.duration)}
                    </span>

                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                      <button
                        onClick={(e) => { e.stopPropagation(); jumpToIndex(index) }}
                        className="p-1 rounded-md hover:bg-accent active:scale-[0.94] transition-colors"
                        aria-label="播放"
                      >
                        <Play size={12} weight="fill" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); removeFromQueue(index) }}
                        className="p-1 rounded-md hover:bg-accent active:scale-[0.94] transition-colors"
                        aria-label="移除"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </ScrollArea>

        {queue.length > 0 && (
          <div className="px-4 py-2 border-t border-border">
            <p className="text-xs text-muted-foreground text-center">
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
