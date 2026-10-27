import { useState, useEffect, useMemo, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { HISTORY_UPDATED_EVENT } from '@/services/storageKeys'
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
import { useServerStore , useHistoryScope } from '@/store/serverStore'
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
  const historyScope = useHistoryScope()
  const [history, setHistory] = useState<ListeningEvent[]>(() =>
    readListeningEvents(historyScope)
  )
  const locationKey = useLocation().key
  const [visibleCount, setVisibleCount] = useState<number>(() => {
    const saved = window.history.state?.mspHistoryDepth as { key?: string; count?: number } | undefined
    return saved?.key === locationKey && saved.count && saved.count > PAGE_SIZE ? saved.count : PAGE_SIZE
  })
  const [confirmClear, setConfirmClear] = useState(false)

  // 进入页面时刷新，并监听音频引擎写入历史后的通知事件
  useEffect(() => {
    const refresh = () => setHistory(readListeningEvents(historyScope))
    refresh()
    const onUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ serverId?: string }>).detail
      // 任何**在读取范围内**的音源写入历史都要刷新：只认主库的话，
      // 在网易云听完一首这一页不会动
      if (!detail?.serverId || historyScope.includes(detail.serverId)) refresh()
    }
    window.addEventListener(HISTORY_UPDATED_EVENT, onUpdate)
    return () => window.removeEventListener(HISTORY_UPDATED_EVENT, onUpdate)
  }, [historyScope])

  // 切换服务器后重新从第一页开始。跳过挂载首跑（复核 F4）：这个 effect
  // 挂载时也执行，会把上面恢复出来的 visibleCount 当帧冲回 150，
  // 随后 replaceState 又把 150 写回——恢复从未生效过。
  const scopeChangedRef = useRef(false)
  useEffect(() => {
    if (!scopeChangedRef.current) { scopeChangedRef.current = true; return }
    setVisibleCount(PAGE_SIZE)
  }, [historyScope])

  // 已见条数按 location.key 记（阶段 3.12）：返回保住翻过的深度
  useEffect(() => {
    try {
      window.history.replaceState({
        ...window.history.state,
        mspHistoryDepth: { key: locationKey, count: visibleCount },
      }, '')
    } catch { /* ignore */ }
  }, [locationKey, visibleCount])

  function handleClear() {
    /*
     * 清的是**全部已连接源**（阶段 1.6）：列表读 historyScope（多源合并），
     * 只清 activeServerId 的话，插件源的记录下一首播完又回来。
     */
    for (const serverId of historyScope) clearListeningEvents(serverId)
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
    <div className="pt-2 regular:pt-4 animate-fade-in">
      {/* 页头：大标题 + 条数（各自独立的 span）+ 清空 */}
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <h1 className="font-display text-[34px] regular:text-[40px] font-semibold leading-[1.05] tracking-[-0.02em]">
            {t('nav.history')}
          </h1>
          {history.length > 0 && (
            <p className="num mt-3 flex flex-wrap gap-x-3 text-sm text-ink-faint">
              <span>{t('history.recordCount', { count: history.length })}</span>
              {visible.length < history.length && (
                <span>{t('history.shownCount', { count: visible.length })}</span>
              )}
            </p>
          )}
        </div>
        {history.length > 0 && (
          <button
            onClick={() => setConfirmClear(true)}
            className="inline-flex min-h-[44px] flex-shrink-0 items-center gap-2 rounded-pill px-3 text-[14px] font-medium text-ink-soft transition-colors hover:text-destructive"
          >
            <Trash size={16} />
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
            <section key={dateKey} className="mt-8">
              {/* 组标题：小号次要字 + 组内条数 */}
              <div className="flex items-baseline gap-3 px-3">
                <h2 className="text-[13px] font-medium text-ink-faint">
                  {formatDateLabel(dateKey)}
                </h2>
                <span className="num text-[13px] text-ink-faint">{entries.length}</span>
              </div>

              {/* 曲目行：序号 + 小封面 + 曲名/歌手 + 时长 + 播放时间；行间靠留白与 hover 底 */}
              <div className="mt-1">
                {entries.map((entry, idx) => {
                  const globalIndex = globalIndexMap.get(entry) ?? 0
                  return (
                    <div
                      key={entry.eventId}
                      role="button"
                      tabIndex={0}
                      className="song-row group gap-3 regular:gap-4"
                      onClick={() => handlePlay(globalIndex)}
                      onKeyDown={e => {
                        if (e.target !== e.currentTarget) return
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          handlePlay(globalIndex)
                        }
                      }}
                    >
                      {/* 序号：hover 浮现播放键（窄屏不占位） */}
                      <span className="relative hidden w-8 flex-shrink-0 items-center justify-center regular:flex">
                        <span className="num text-[13px] text-ink-faint transition-opacity duration-200 [@media(hover:hover)]:group-hover:opacity-0">
                          {String(idx + 1).padStart(2, '0')}
                        </span>
                        <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-200 [@media(hover:hover)]:group-hover:opacity-100">
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-sheet text-ink shadow-press">
                            <Play className="h-3 w-3" weight="fill" />
                          </span>
                        </span>
                      </span>

                      {/* 小封面 */}
                      <span className="h-11 w-11 flex-shrink-0 overflow-hidden rounded-sm bg-paper-deep">
                        <ImageWithFallback
                          src={entry.song.coverArt ? (findAdapterFor(entry.song.serverId)?.getCoverUrl(entry.song.coverArt, 64) ?? undefined) : undefined}
                          alt={entry.song.title}
                          fallbackType="album"
                          className="h-full w-full"
                          songId={entry.song.id}
                          customCoverParams={{ type: 'song', title: entry.song.title, artist: entry.song.artist, album: entry.song.album, path: entry.song.path }}
                        />
                      </span>

                      {/* 曲名 + 歌手 / 专辑（各自独立的 span） */}
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-1 text-[15px] font-semibold leading-snug">
                          {entry.song.title}
                        </p>
                        <p className="mt-0.5 flex min-w-0 gap-x-3 text-[13px] text-ink-soft">
                          <span className="truncate">{entry.song.artist}</span>
                          {entry.song.album && <span className="hidden truncate text-ink-faint regular:inline">{entry.song.album}</span>}
                        </p>
                      </div>

                      {/* 时长（窄屏不占位） */}
                      <span className="num hidden w-12 flex-shrink-0 text-right text-[13px] text-ink-faint regular:block">
                        {entry.song.duration ? formatDuration(entry.song.duration) : ''}
                      </span>

                      {/* 播放时间 HH:mm；只标注跳过，正常收听不加视觉噪音 */}
                      <span className="w-12 flex-shrink-0 text-right text-[13px] text-ink-faint">
                        <span className="num block">{formatTimeOfDay(entry.endedAt)}</span>
                        {entry.outcome === 'skipped' && <span className="block text-[12px]">{t('history.skipped')}</span>}
                      </span>
                    </div>
                  )
                })}
              </div>
            </section>
          ))}

          {visible.length < history.length && (
            <div className="mt-10 flex justify-center">
              <button
                type="button"
                onClick={() => setVisibleCount(count => count + PAGE_SIZE)}
                className="act-secondary inline-flex items-center gap-2 text-[14px]"
              >
                {t('history.loadMore')}
              </button>
            </div>
          )}
        </div>
      )}

      <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
        <DialogContent className="max-w-sm">
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
