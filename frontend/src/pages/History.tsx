import { useState, useEffect, useMemo } from 'react'
import { Play, Trash } from '@phosphor-icons/react'
import { usePlayerStore } from '@/store/playerStore'
import { getAdapter, hasAdapter } from '@/api'
import { formatDuration } from '@/utils/formatters'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useServerStore } from '@/store/serverStore'
import {
  clearListeningEvents,
  readListeningEvents,
  type ListeningEvent,
} from '@/services/listeningHistory'

/** 格式化时刻为 HH:mm（mono 展示用） */
function formatTimeOfDay(timestamp: number): string {
  const d = new Date(timestamp)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default function History() {
  const activeServerId = useServerStore(s => s.activeServerId)
  const [history, setHistory] = useState<ListeningEvent[]>(() =>
    activeServerId ? readListeningEvents(activeServerId) : []
  )
  const [confirmClear, setConfirmClear] = useState(false)
  const playQueue = usePlayerStore(s => s.playQueue)

  // 进入页面时刷新，并监听音频引擎写入历史后的通知事件
  useEffect(() => {
    const refresh = () => setHistory(activeServerId ? readListeningEvents(activeServerId) : [])
    refresh()
    const onUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ serverId?: string }>).detail
      if (!detail?.serverId || detail.serverId === activeServerId) refresh()
    }
    window.addEventListener('msp-history-updated', onUpdate)
    return () => window.removeEventListener('msp-history-updated', onUpdate)
  }, [activeServerId])

  function handleClear() {
    if (activeServerId) clearListeningEvents(activeServerId)
    setHistory([])
    setConfirmClear(false)
  }

  function handlePlay(index: number) {
    const songs = history.map(e => e.song)
    playQueue(songs, index)
  }

  // Group by date
  const grouped = history.reduce<Record<string, ListeningEvent[]>>((acc, entry) => {
    const d = new Date(entry.endedAt)
    const dateKey = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
    if (!acc[dateKey]) acc[dateKey] = []
    acc[dateKey].push(entry)
    return acc
  }, {})

  // entry -> 全局序号 预建索引，渲染时 O(1) 查询（替代 history.indexOf 的 O(n²)）
  const globalIndexMap = useMemo(() => {
    const map = new Map<ListeningEvent, number>()
    history.forEach((entry, i) => map.set(entry, i))
    return map
  }, [history])

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
    <div className="pt-8 animate-fade-in">
      {/* 页头：衬线标题 + mono 总条数 + 文字级次操作（DESIGN v2 §3/§4.1） */}
      <header className="flex items-end justify-between gap-6 border-b border-hair pb-6">
        <div>
          <h1 className="font-serif text-[30px] font-bold leading-tight tracking-[-0.01em]">
            最近播放
            <span className="ml-4 align-[4px] font-sans text-[11px] font-normal tracking-[0.3em] text-ink-faint">
              HISTORY
            </span>
          </h1>
          {history.length > 0 && (
            <p className="mt-1.5 text-sm text-ink-faint">
              <span className="font-num">{history.length}</span> 条记录
            </p>
          )}
        </div>
        {history.length > 0 && (
          <button
            onClick={() => setConfirmClear(true)}
            className="inline-flex flex-shrink-0 items-center gap-1.5 text-sm text-ink-soft transition-colors hover:text-destructive active:scale-[0.97]"
          >
            <Trash className="w-3.5 h-3.5" />
            清空记录
          </button>
        )}
      </header>

      {history.length === 0 ? (
        <div className="py-24 text-center">
          <p className="font-serif text-xl font-semibold">还没有播放记录。</p>
          <p className="mt-2 text-sm text-ink-faint">播放音乐后，最近听过的歌会记在这里。</p>
        </div>
      ) : (
        <div>
          {Object.entries(grouped).map(([dateKey, entries]) => (
            <section key={dateKey} className="mt-10 first:mt-8">
              {/* 组标题：小号 wide-tracking 标签 + 发丝线 + mono 组内条数 */}
              <div className="flex items-baseline gap-4">
                <h2 className="text-[11px] font-medium tracking-[0.3em] text-ink-faint">
                  {formatDateLabel(dateKey)}
                </h2>
                <span className="h-px flex-1 bg-hair-soft" aria-hidden="true" />
                <span className="font-num text-[11px] text-ink-faint">{entries.length}</span>
              </div>

              {/* 曲目行：SongList 范式（mono 序号 + 小封面 + 衬线曲名 + 歌手 + mono 时长 + mono 播放时间） */}
              <div className="mt-1 divide-y divide-hair-soft">
                {entries.map((entry, idx) => {
                  const globalIndex = globalIndexMap.get(entry) ?? 0
                  return (
                    <div
                      key={entry.eventId}
                      className="song-row group"
                      onClick={() => handlePlay(globalIndex)}
                    >
                      {/* 序号：hover 浮现细线圆播放键 */}
                      <span className="relative flex w-8 flex-shrink-0 items-center justify-center">
                        <span className="font-num text-xs text-ink-faint transition-opacity duration-200 group-hover:opacity-0">
                          {String(idx + 1).padStart(2, '0')}
                        </span>
                        <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                          <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full border border-hair text-ink-soft">
                            <Play className="ml-px h-2.5 w-2.5" weight="fill" />
                          </span>
                        </span>
                      </span>

                      {/* 小封面 */}
                      <span className="h-10 w-10 flex-shrink-0 overflow-hidden rounded-sm ring-1 ring-hair-soft">
                        <ImageWithFallback
                          src={entry.song.coverArt && hasAdapter() ? getAdapter().getCoverUrl(entry.song.coverArt, 64) : undefined}
                          alt={entry.song.title}
                          fallbackType="album"
                          className="h-full w-full"
                          customCoverParams={{ type: 'song', title: entry.song.title, artist: entry.song.artist, album: entry.song.album, path: entry.song.path }}
                        />
                      </span>

                      {/* 曲名 + 歌手 */}
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-1 font-serif text-[15px] font-semibold leading-snug transition-colors group-hover:text-primary">
                          {entry.song.title}
                        </p>
                        <p className="mt-0.5 line-clamp-1 text-xs text-ink-soft">
                          {entry.song.artist}
                          {entry.song.album && <span className="text-ink-faint"> · {entry.song.album}</span>}
                        </p>
                      </div>

                      {/* mono 时长 */}
                      <span className="w-12 flex-shrink-0 text-right font-num text-xs text-ink-faint">
                        {entry.song.duration ? formatDuration(entry.song.duration) : ''}
                      </span>

                      {/* mono 播放时间 HH:mm */}
                      <span className="w-12 flex-shrink-0 text-right font-num text-xs text-ink-faint">
                        {formatTimeOfDay(entry.endedAt)}
                      </span>
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>清除播放历史？</DialogTitle>
            <DialogDescription>此操作不可撤销，当前服务器的本地播放记录将被全部删除。</DialogDescription>
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
