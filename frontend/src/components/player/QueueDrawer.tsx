/**
 * 播放队列抽屉
 * 显示当前播放列表，支持拖拽排序、删除
 */

import { X, GripVertical, Play } from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePlayerStore } from '@/store/playerStore'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'
import { getAdapter, hasAdapter } from '@/api'
import { formatDuration } from '@/utils/formatters'
import { ScrollArea } from '@/components/ui/scroll-area'

export function QueueDrawer() {
  const queue           = usePlayerStore(s => s.queue)
  const queueIndex      = usePlayerStore(s => s.queueIndex)
  const isQueueOpen     = usePlayerStore(s => s.isQueueOpen)
  const setQueueOpen    = usePlayerStore(s => s.setQueueOpen)
  const jumpToIndex     = usePlayerStore(s => s.jumpToIndex)
  const removeFromQueue = usePlayerStore(s => s.removeFromQueue)
  const clearQueue      = usePlayerStore(s => s.clearQueue)
  const currentSong     = usePlayerStore(s => s.currentSong)

  if (!isQueueOpen) return null

  return (
    <div className="w-80 border-l border-border/50 bg-background/95 backdrop-blur-xl flex flex-col flex-shrink-0 animate-slide-up">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
        <h3 className="font-semibold text-sm">播放队列</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={clearQueue}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            清空
          </button>
          <button
            onClick={() => setQueueOpen(false)}
            className="p-1 rounded-full hover:bg-accent transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 队列列表 */}
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
                  key={song.id + index}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer group transition-colors',
                    isCurrent ? 'bg-accent' : 'hover:bg-accent/50'
                  )}
                  onDoubleClick={() => jumpToIndex(index)}
                >
                  {/* 拖拽图标 */}
                  <GripVertical className="w-4 h-4 text-muted-foreground/30 opacity-0 group-hover:opacity-100 flex-shrink-0" />

                  {/* 封面 */}
                  <div className="w-9 h-9 rounded overflow-hidden flex-shrink-0">
                    <ImageWithFallback
                      src={coverUrl}
                      alt={song.album}
                      fallbackType="album"
                      className="w-full h-full"
                      customCoverParams={{ type: 'song', title: song.title, artist: song.artist, album: song.album, path: song.path }}
                    />
                  </div>

                  {/* 信息 */}
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

                  {/* 时长 */}
                  <span className="text-xs text-muted-foreground tabular-nums flex-shrink-0">
                    {formatDuration(song.duration)}
                  </span>

                  {/* 播放/删除 */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                    <button
                      onClick={() => jumpToIndex(index)}
                      className="p-1 rounded hover:bg-accent"
                    >
                      <Play className="w-3 h-3" fill="currentColor" />
                    </button>
                    <button
                      onClick={() => removeFromQueue(index)}
                      className="p-1 rounded hover:bg-accent"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </ScrollArea>

      {/* 底部信息 */}
      {queue.length > 0 && (
        <div className="px-4 py-2 border-t border-border/50">
          <p className="text-xs text-muted-foreground text-center">
            {queue.length} 首歌曲 · {queueIndex + 1} / {queue.length}
          </p>
        </div>
      )}
    </div>
  )
}
