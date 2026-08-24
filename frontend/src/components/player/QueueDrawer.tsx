/**
 * 播放队列面板（杂志编辑风，DESIGN v2）
 * 右侧滑出：纸面底、左缘 1px 发丝线、宽 320px、浮层淡投影
 * 编号行（mono 序号 + 衬线曲名 + mono 时长），当前行 accent + EQ 动画
 * 支持拖拽排序、删除、清空（二次确认）
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { X, DotsSixVertical, Play, CaretUp, CaretDown, Shuffle } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { useT } from '@/i18n'
import { usePlayerStore } from '@/store/playerStore'
import { useIsMobileLayout } from '@/lib/platform'
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
import { spaceCJK } from '@/utils/cjkTypography'

export function QueueDrawer() {
  const { t }           = useT()
  const queue           = usePlayerStore(s => s.queue)
  const queueIndex      = usePlayerStore(s => s.queueIndex)
  const shuffle         = usePlayerStore(s => s.shuffle)
  const shuffledIndexes = usePlayerStore(s => s.shuffledIndexes)
  const isQueueOpen     = usePlayerStore(s => s.isQueueOpen)
  const isPlaying       = usePlayerStore(s => s.isPlaying)
  const setQueueOpen    = usePlayerStore(s => s.setQueueOpen)
  const jumpToIndex     = usePlayerStore(s => s.jumpToIndex)
  const removeFromQueue = usePlayerStore(s => s.removeFromQueue)
  const reorderQueue    = usePlayerStore(s => s.reorderQueue)
  const reorderPlayOrder = usePlayerStore(s => s.reorderPlayOrder)
  const clearQueue      = usePlayerStore(s => s.clearQueue)
  const isMobile        = useIsMobileLayout()

  /**
   * 队列可以很长——按一次「全库随机」就是几百上千首。
   * 全量实挂时抽屉一打开要造上万个 DOM 节点，入场动画当场卡顿。
   * 超过阈值才虚拟化：短队列实挂更简单，也没有测量带来的首帧抖动。
   */
  const viewportRef = useRef<HTMLDivElement | null>(null)

  const [confirmClear, setConfirmClear] = useState(false)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  // ESC 关闭；模态对话框（如清空确认）打开时让位给对话框自身的 ESC 处理
  useEffect(() => {
    if (!isQueueOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return
      setQueueOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isQueueOpen, setQueueOpen])

  /**
   * 面板必须按「接下来会怎么播」渲染，而不是按数组存储顺序。
   *
   * 旧实现直接 queue.map()，开着随机时看到的仍是专辑/歌单原始曲序，
   * 当前行在列表里上下乱跳，当前行的下一行并不是下一首要播的歌 ——
   * 用户唯一能看见播放顺序的界面完全没体现随机，于是判定「随机是假的」。
   */
  const order = useMemo(() => {
    const identity = queue.map((_, i) => i)
    if (!shuffle) return identity
    // 随机顺序与队列长度对不上（异常状态）时退回存储序，至少不会漏显或越界
    if (shuffledIndexes.length !== queue.length) return identity
    const seen = new Set(shuffledIndexes)
    if (seen.size !== queue.length) return identity
    return shuffledIndexes
  }, [queue, shuffle, shuffledIndexes])

  const position = order.indexOf(queueIndex)

  const handleDragStart = useCallback((index: number) => {
    setDragIndex(index)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault()
    setOverIndex(index)
  }, [])

  /** 拖拽的下标是「显示位置」：随机开启时改播放顺序，否则改队列顺序 */
  const moveByPosition = useCallback((fromPos: number, toPos: number) => {
    if (fromPos === toPos) return
    if (shuffle) reorderPlayOrder(fromPos, toPos)
    else reorderQueue(fromPos, toPos)
  }, [shuffle, reorderPlayOrder, reorderQueue])

  const handleDrop = useCallback((index: number) => {
    if (dragIndex !== null && dragIndex !== index) {
      moveByPosition(dragIndex, index)
    }
    setDragIndex(null)
    setOverIndex(null)
  }, [dragIndex, moveByPosition])

  const renderRow = useCallback((qi: number, pos: number) => {
            const song = queue[qi]
            if (!song) return null
            const isCurrent = qi === queueIndex

            return (
              <li
                key={`${song.id}-${qi}`}
                draggable
                onDragStart={() => handleDragStart(pos)}
                onDragOver={(e) => handleDragOver(e, pos)}
                onDrop={() => handleDrop(pos)}
                onDragEnd={() => { setDragIndex(null); setOverIndex(null) }}
                onClick={() => jumpToIndex(qi)}
                className={cn(
                  'group flex items-center gap-3 px-4 py-2.5 border-b border-hair-soft cursor-pointer transition-colors duration-150',
                  'hover:bg-paper-deep/60',
                  overIndex === pos && dragIndex !== null && 'ring-1 ring-inset ring-primary/40',
                  dragIndex === pos && 'opacity-50'
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
                        {String(pos + 1).padStart(2, '0')}
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
                    {spaceCJK(song.title)}
                  </span>
                  <span className="block text-[11px] text-ink-faint truncate mt-0.5">
                    {spaceCJK(song.artist)}
                  </span>
                </span>

                <span className="font-num text-[11px] text-ink-faint flex-shrink-0">
                  {formatDuration(song.duration)}
                </span>

                {/* 触屏上 HTML5 拖拽事件不触发，用上移/下移按钮兜底 */}
                {isMobile ? (
                  <span className="flex items-center gap-0.5 flex-shrink-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); moveByPosition(pos, pos - 1) }}
                      disabled={pos === 0}
                      className="w-11 h-11 -my-2 rounded-full flex items-center justify-center text-ink-soft disabled:opacity-25 active:scale-95"
                      aria-label={t('queue.moveUp', { title: song.title })}
                    >
                      <CaretUp size={14} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); moveByPosition(pos, pos + 1) }}
                      disabled={pos === order.length - 1}
                      className="w-11 h-11 -my-2 rounded-full flex items-center justify-center text-ink-soft disabled:opacity-25 active:scale-95"
                      aria-label={t('queue.moveDown', { title: song.title })}
                    >
                      <CaretDown size={14} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); removeFromQueue(qi) }}
                      className="w-11 h-11 -my-2 rounded-full flex items-center justify-center text-ink-soft active:scale-95"
                      aria-label={t('queue.remove', { title: song.title })}
                    >
                      <X size={13} />
                    </button>
                  </span>
                ) : (
                  <span className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-150 flex-shrink-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); jumpToIndex(qi) }}
                      className="w-6 h-6 rounded-full flex items-center justify-center text-ink-soft hover:text-primary transition-colors duration-150 active:scale-95"
                      aria-label={t('queue.playSong', { title: song.title })}
                    >
                      <Play size={11} weight="fill" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); removeFromQueue(qi) }}
                      className="w-6 h-6 rounded-full flex items-center justify-center text-ink-soft hover:text-primary transition-colors duration-150 active:scale-95"
                      aria-label={t('queue.remove', { title: song.title })}
                    >
                      <X size={12} />
                    </button>
                  </span>
                )}
              </li>
            )
  }, [queue, queueIndex, isPlaying, isMobile, order.length, dragIndex, overIndex, handleDragStart, handleDragOver, handleDrop, jumpToIndex, moveByPosition, removeFromQueue, t])

  if (!isQueueOpen) return null

  return (
    <>
      {/* 透明遮罩：点击面板外区域关闭（只覆盖内容区，不遮挡报头与播放条） */}
      <div className="absolute inset-0 z-20" aria-hidden="true" onClick={() => setQueueOpen(false)} />

      {/* 面板：桌面右侧滑出；移动端底部弹层（含底部安全区） */}
      <div
        className={cn(
          'absolute z-30 bg-paper shadow-float flex flex-col',
          isMobile
            ? 'inset-x-0 bottom-0 max-h-[85%] border-t border-hair animate-slide-up'
            : 'inset-y-0 right-0 w-[320px] border-l border-hair animate-slide-in-right'
        )}
        style={isMobile ? { paddingBottom: 'env(safe-area-inset-bottom)' } : undefined}
      >
        {/* 头部：衬线标题 + 清空 / 关闭 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-hair flex-shrink-0">
          <h3 className="font-serif font-bold text-[17px] flex items-baseline gap-2.5">
            {t('player.queue')}
            {/* 面板此时显示的是随机顺序而非原始曲序，必须说明，否则用户会以为随机没生效 */}
            {shuffle && (
              <span className="inline-flex items-center gap-1 text-[10.5px] font-sans font-medium tracking-[0.14em] text-primary">
                <Shuffle size={11} aria-hidden="true" />
                {t('queue.shuffledOrder')}
              </span>
            )}
          </h3>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setConfirmClear(true)}
              className="text-[12px] tracking-[0.14em] text-ink-soft hover:text-primary transition-colors duration-200"
            >
              {t('queue.clear')}
            </button>
            <button
              onClick={() => setQueueOpen(false)}
              className="w-7 h-7 rounded-full flex items-center justify-center text-ink-soft hover:text-primary transition-colors duration-200 active:scale-95"
              aria-label={t('queue.close')}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <ScrollArea className="flex-1" viewportRef={viewportRef}>
          {queue.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="font-serif text-[15px] text-foreground">{t('empty.queue.title')}</p>
              <p className="text-[12px] text-ink-faint mt-1">{t('empty.queue.description')}</p>
            </div>
          ) : (
            <QueueList
              order={order}
              renderRow={renderRow}
              viewportRef={viewportRef}
            />
          )}
        </ScrollArea>

        {queue.length > 0 && (
          <div className="px-5 py-2.5 border-t border-hair flex-shrink-0">
            {/* 计数按播放位置算：随机时数组下标毫无意义（会显示成「17 / 40」而实际在第 3 首） */}
            <p className="text-[11px] text-ink-faint text-center">
              {/* 数字留在 .font-num 里（等宽 tabular），单位词跟着语言走 */}
              <span className="font-num">{queue.length}</span>{' '}
              {queue.length === 1 ? t('queue.trackUnit') : t('queue.tracksUnit')} ·{' '}
              <span className="font-num">{position >= 0 ? position + 1 : '–'} / {order.length}</span>
              {shuffle && <span className="ml-1.5">{t('queue.shuffledOrderNote')}</span>}
            </p>
          </div>
        )}
      </div>

      <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('queue.clearConfirmTitle')}</DialogTitle>
            <DialogDescription>
              {t('queue.clearConfirmDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setConfirmClear(false)}>{t('action.cancel')}</Button>
            <Button
              variant="destructive"
              onClick={() => {
                clearQueue()
                setConfirmClear(false)
              }}
            >
              {t('queue.clear')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** 超过这个长度才虚拟化。短队列实挂更简单，也没有测量带来的首帧抖动。 */
const QUEUE_VIRTUALIZE_THRESHOLD = 80
/** 行高估计值：序号 + 两行文字 + 上下 padding，实测约 54px */
const QUEUE_ROW_HEIGHT = 54

/**
 * 队列列表。
 *
 * 拖拽排序是原生 HTML5 drag——虚拟化之后只有渲染出来的行能当放置目标，
 * 但拖动时滚动会把新的行渲染出来，所以长队列里依然能拖到任意位置。
 * overscan 给得比常规大一些，正是为了让拖动经过的边缘行提前就位。
 */
function QueueList({
  order,
  renderRow,
  viewportRef,
}: {
  order: number[]
  renderRow: (qi: number, pos: number) => React.ReactNode
  viewportRef: React.RefObject<HTMLDivElement | null>
}) {
  /**
   * 滚动容器要放进 state，不能只读 ref。
   *
   * useVirtualizer 在首帧调用 getScrollElement 时 ref 还是 null，算不出可视
   * 区间，于是永远落在下面那个「先实挂一屏」的兜底分支里——长队列会被
   * **截断**在阈值处，看起来像虚拟化生效了，实则整段队列丢失。
   * 用 state 持有元素，拿到的那一刻触发一次重渲染，虚拟化才真正启动。
   */
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  useEffect(() => {
    setScrollEl(viewportRef.current)
  }, [viewportRef, order.length])

  const virtualizer = useVirtualizer({
    count: order.length,
    getScrollElement: () => scrollEl,
    estimateSize: () => QUEUE_ROW_HEIGHT,
    overscan: 16,
  })

  if (order.length <= QUEUE_VIRTUALIZE_THRESHOLD) {
    return <ol>{order.map((qi, pos) => renderRow(qi, pos))}</ol>
  }

  const items = virtualizer.getVirtualItems()
  /**
   * 尺寸还没就绪时的兜底。这里**必须把整条队列都渲染出来**，
   * 只是不做虚拟化——若只挂前一屏，一旦测量始终失败（容器被折叠、
   * 浏览器不支持某项测量），用户看到的就是一条被悄悄截断的队列。
   * 宁可慢，不可少。
   */
  if (!items.length) {
    return <ol>{order.map((qi, pos) => renderRow(qi, pos))}</ol>
  }

  return (
    <ol style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
      {items.map(item => (
        <div
          key={item.key}
          data-index={item.index}
          ref={virtualizer.measureElement}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            transform: `translateY(${item.start}px)`,
          }}
        >
          {renderRow(order[item.index], item.index)}
        </div>
      ))}
    </ol>
  )
}
