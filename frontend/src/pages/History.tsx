import { useState, useEffect } from 'react'
import { Clock, Play, Trash2 } from 'lucide-react'
import { usePlayerStore } from '@/store/playerStore'
import { getAdapter, hasAdapter } from '@/api'
import { formatRelativeTime, formatDuration } from '@/utils/formatters'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'
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
    <div className="min-h-full pb-8">
      <div className="px-6 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Clock className="w-8 h-8 text-primary" />
            播放历史
          </h1>
          {history.length > 0 && (
            <button
              onClick={handleClear}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-destructive transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              清除记录
            </button>
          )}
        </div>

        {history.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
            <Clock className="w-16 h-16 mb-4 opacity-20" />
            <p className="text-lg mb-1">暂无播放记录</p>
            <p className="text-sm">播放音乐后记录会出现在这里</p>
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(grouped).map(([dateKey, entries]) => (
              <div key={dateKey}>
                <h2 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wider">
                  {formatDateLabel(dateKey)}
                </h2>
                <div className="space-y-0.5">
                  {entries.map((entry, idx) => {
                    const globalIndex = history.indexOf(entry)
                    return (
                      <div
                        key={`${entry.song.id}-${entry.playedAt}`}
                        className="group flex items-center gap-4 p-3 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                        onClick={() => handlePlay(globalIndex)}
                      >
                        {/* Cover */}
                        <div className="relative flex-shrink-0">
                          <div className="w-11 h-11 rounded-lg overflow-hidden">
                            <ImageWithFallback
                              src={entry.song.coverArt && hasAdapter() ? getAdapter().getCoverUrl(entry.song.coverArt, 64) : undefined}
                              alt={entry.song.title}
                              fallbackType="album"
                              className="w-full h-full"
                              customCoverParams={{ type: 'song', title: entry.song.title, artist: entry.song.artist, album: entry.song.album, path: entry.song.path }}
                            />
                          </div>
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center rounded-lg transition-opacity">
                            <Play className="w-4 h-4 text-white fill-white" />
                          </div>
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate text-sm group-hover:text-primary transition-colors">
                            {entry.song.title}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {entry.song.artist}
                            {entry.song.album && ` · ${entry.song.album}`}
                          </p>
                        </div>

                        {/* Time & duration */}
                        <div className="flex-shrink-0 text-right">
                          <p className="text-xs text-muted-foreground">
                            {formatRelativeTime(entry.playedAt)}
                          </p>
                          {entry.song.duration && (
                            <p className="text-xs text-muted-foreground/60">
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
    </div>
  )
}
