import { useState, useEffect } from 'react'
import { ClockCounterClockwise, Play, Trash } from '@phosphor-icons/react'
import { usePlayerStore } from '@/store/playerStore'
import { getAdapter, hasAdapter } from '@/api'
import { formatRelativeTime, formatDuration } from '@/utils/formatters'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { Song } from '@/api/types'

interface HistoryEntry {
  song: Song
  playedAt: number
}

// 本地播放历史（存储在 localStorage）
const HISTORY_KEY = 'msp-play-history'

function getHistory(): HistoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]')
  } catch {
    return []
  }
}

function clearHistory() {
  localStorage.setItem(HISTORY_KEY, '[]')
}

export function recordPlay(song: Song) {
  const history = getHistory()
  const entry: HistoryEntry = { song, playedAt: Date.now() }
  // Remove duplicate
  const filtered = history.filter(e => e.song.id !== song.id)
  const updated = [entry, ...filtered].slice(0, 500)
  localStorage.setItem(HISTORY_KEY, JSON.stringify(updated))
}

export default function History() {
  const [history, setHistory] = useState<HistoryEntry[]>(getHistory)
  const [confirmClear, setConfirmClear] = useState(false)
  const playQueue = usePlayerStore(s => s.playQueue)

  // 进入页面时刷新，并监听音频引擎写入历史后的通知事件
  useEffect(() => {
    setHistory(getHistory())
    const onUpdate = () => setHistory(getHistory())
    window.addEventListener('msp-history-updated', onUpdate)
    return () => window.removeEventListener('msp-history-updated', onUpdate)
  }, [])

  function handleClear() {
    clearHistory()
    setHistory([])
    setConfirmClear(false)
  }

  function handlePlay(index: number) {
    const songs = history.map(e => e.song)
    playQueue(songs, index)
  }

  // Group by date
  const grouped = history.reduce<Record<string, HistoryEntry[]>>((acc, entry) => {
    const d = new Date(entry.playedAt)
    const dateKey = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
    if (!acc[dateKey]) acc[dateKey] = []
    acc[dateKey].push(entry)
    return acc
  }, {})

  function formatDateLabel(key: string): string {
    const [y, m, d] = key.split('-').map(Number)
    const date = new Date(y, m - 1, d)
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    if (date.toDateString() === today.toDateString()) return '今天'
    if (date.toDateString() === yesterday.toDateString()) return '昨天'
    return `${m}月${d}日`
  }

  return (
    <div className="min-h-full pb-8 animate-fade-in">
      <div className="px-6 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold tracking-tight">播放历史</h1>
          {history.length > 0 && (
            <button
              onClick={() => setConfirmClear(true)}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-destructive transition-colors active:scale-[0.97]"
            >
              <Trash className="w-4 h-4" />
              清除记录
            </button>
          )}
        </div>

        {history.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground border-t border-border">
            <ClockCounterClockwise className="w-16 h-16 mb-4 opacity-20" />
            <p className="text-lg mb-1">暂无播放记录</p>
            <p className="text-sm">播放音乐后记录会出现在这里</p>
          </div>
        ) : (
          <div>
            {Object.entries(grouped).map(([dateKey, entries]) => (
              <div key={dateKey} className="border-t border-border pt-5 mt-5 first:mt-0">
                <h2 className="text-[11px] font-medium text-muted-foreground tracking-[0.14em] mb-3 px-3">
                  {formatDateLabel(dateKey)}
                </h2>
                <div className="space-y-0.5">
                  {entries.map((entry, idx) => {
                    const globalIndex = history.indexOf(entry)
                    return (
                      <div
                        key={`${entry.song.id}-${entry.playedAt}`}
                        className="group flex items-center gap-4 px-3 py-2 rounded-lg hover:bg-surface cursor-pointer transition-colors duration-150"
                        onClick={() => handlePlay(globalIndex)}
                      >
                        {/* Cover */}
                        <div className="relative flex-shrink-0">
                          <div className="w-10 h-10 rounded-md ring-1 ring-border overflow-hidden">
                            <ImageWithFallback
                              src={entry.song.coverArt && hasAdapter() ? getAdapter().getCoverUrl(entry.song.coverArt, 64) : undefined}
                              alt={entry.song.title}
                              fallbackType="album"
                              className="w-full h-full"
                              customCoverParams={{ type: 'song', title: entry.song.title, artist: entry.song.artist, album: entry.song.album, path: entry.song.path }}
                            />
                          </div>
                          <div className="absolute inset-0 bg-background/60 opacity-0 group-hover:opacity-100 flex items-center justify-center rounded-md transition-opacity duration-150">
                            <Play className="w-4 h-4 text-foreground" weight="fill" />
                          </div>
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold truncate text-[13px] group-hover:text-primary transition-colors">
                            {entry.song.title}
                          </p>
                          <p className="text-xs text-muted-foreground truncate mt-0.5">
                            {entry.song.artist}
                            {entry.song.album && ` · ${entry.song.album}`}
                          </p>
                        </div>

                        {/* Time & duration */}
                        <div className="flex-shrink-0 text-right">
                          <p className="font-num text-xs text-muted-foreground">
                            {formatRelativeTime(entry.playedAt)}
                          </p>
                          {entry.song.duration && (
                            <p className="font-num text-xs text-muted-foreground mt-0.5">
                              {formatDuration(entry.song.duration)}
                            </p>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>清除播放历史？</DialogTitle>
            <DialogDescription>此操作不可撤销，本地播放记录将被全部删除。</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setConfirmClear(false)}>取消</Button>
            <Button variant="destructive" onClick={handleClear}>清除</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
