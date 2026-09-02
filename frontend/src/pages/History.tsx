import { useState, useEffect, useMemo } from 'react'
import { Play, Trash } from '@phosphor-icons/react'
import { usePlayerStore } from '@/store/playerStore'
import { findAdapterFor } from '@/api'
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
import { playListFrom } from '@/utils/playActions'
import {
  clearListeningEvents,
  readListeningEvents,
  type ListeningEvent,
} from '@/services/listeningHistory'
import { EmptyState } from '@/components/common/EmptyState'
import { useT } from '@/i18n'

/** 格式化时刻为 HH:mm（mono 展示用） */
function formatTimeOfDay(timestamp: number): string {
  const d = new Date(timestamp)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * 单页渲染的条数上限。
 * 历史迁到 IndexedDB 后保留上限提升到 2 万条，一次性渲染会直接卡死页面。
 */
const PAGE_SIZE = 150

export default function History() {
  const { t } = useT()
  const activeServerId = useServerStore(s => s.activeServerId)
  const [history, setHistory] = useState<ListeningEvent[]>(() =>
    activeServerId ? readListeningEvents(activeServerId) : []
  )
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [confirmClear, setConfirmClear] = useState(false)

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

  // 切换服务器后重新从第一页开始
  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [activeServerId])

  function handleClear() {
    if (activeServerId) clearListeningEvents(activeServerId)
    setHistory([])
    setConfirmClear(false)
  }

  const visible = useMemo(() => history.slice(0, visibleCount), [history, visibleCount])

  function handlePlay(index: number) {
    // 只把已展示的部分入队，避免一次把两万首塞进播放队列
    playListFrom(visible.map(entry => entry.song), index)
  }

  const grouped = useMemo(
    () =>
      visible.reduce<Record<string, ListeningEvent[]>>((acc, entry) => {
        const d = new Date(entry.endedAt)
        const dateKey = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
        if (!acc[dateKey]) acc[dateKey] = []
        acc[dateKey].push(entry)
        return acc
      }, {}),
    [visible]
  )

  // entry -> 全局序号 预建索引，渲染时 O(1) 查询（替代 history.indexOf 的 O(n²)）
  const globalIndexMap = useMemo(() => {
    const map = new Map<ListeningEvent, number>()
    visible.forEach((entry, i) => map.set(entry, i))
    return map
  }, [visible])

  function formatDateLabel(key: string): string {
    const [y, m, d] = key.split('-').map(Number)
    const date = new Date(y, m - 1, d)
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    if (date.toDateString() === today.toDateString()) return t('history.today')
    if (date.toDateString() === yesterday.toDateString()) return t('history.yesterday')
    return t('history.monthDay', { month: m, day: d })
  }

  return (
    <div className="pt-8 animate-fade-in">
      {/* 页头：衬线标题 + mono 总条数 + 文字级次操作（DESIGN v2 §3/§4.1） */}
      <header className="flex items-end justify-between gap-6 border-b border-hair pb-6">
        <div>
          <h1 className="font-serif text-[30px] font-bold leading-tight tracking-[-0.01em]">
            {t('nav.history')}
            <span className="latin-tag ml-4 align-[4px] font-sans text-[11px] font-normal tracking-[0.3em] text-ink-faint">
              HISTORY
            </span>
          </h1>
          {history.length > 0 && (
            <p className="mt-1.5 text-sm text-ink-faint">
              {t('history.recordCount', { count: history.length })}
              {visible.length < history.length && (
                <span> · {t('history.shownCount', { count: visible.length })}</span>
              )}
            </p>
          )}
        </div>
        {history.length > 0 && (
          <button
            onClick={() => setConfirmClear(true)}
            className="inline-flex flex-shrink-0 items-center gap-1.5 text-sm text-ink-soft transition-colors hover:text-destructive active:scale-[0.97]"
          >
            <Trash className="w-3.5 h-3.5" />
            {t('history.clear')}
          </button>
        )}
      </header>

      {history.length === 0 ? (
        <EmptyState
          title={t('empty.history.title')}
          description={t('empty.history.description')}
        />
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
                          src={entry.song.coverArt ? (findAdapterFor(entry.song.serverId)?.getCoverUrl(entry.song.coverArt, 64) ?? undefined) : undefined}
                          alt={entry.song.title}
                          fallbackType="album"
                          className="h-full w-full"
                          songId={entry.song.id}
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

                      {/* 收听结果：只标注跳过，正常收听不加视觉噪音 */}
                      <span className="w-8 flex-shrink-0 text-right text-[11px] text-ink-faint">
                        {entry.outcome === 'skipped' ? t('history.skipped') : ''}
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

          {visible.length < history.length && (
            <div className="mt-10 border-t border-hair pt-6 text-center">
              <button
                type="button"
                onClick={() => setVisibleCount(count => count + PAGE_SIZE)}
                className="text-sm text-ink-soft underline decoration-hair underline-offset-[6px] transition-colors hover:text-primary hover:decoration-primary"
              >
                {t('history.loadMore')}
              </button>
            </div>
          )}
        </div>
      )}

      <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('history.clearConfirmTitle')}</DialogTitle>
            <DialogDescription>{t('history.clearConfirmDescription')}</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setConfirmClear(false)}>{t('action.cancel')}</Button>
            <Button variant="destructive" onClick={handleClear}>{t('action.clear')}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
