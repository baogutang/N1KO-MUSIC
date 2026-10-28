/**
 * 播放队列面板（v6）
 * 一张浮起的面：宽窗口贴右侧浮着（避开底部播放区），窄窗口是从底部升起的弹层（顶上一条把手）。
 * 行与「接下来」列表同一个样子：44px 封面 + 曲名 / 歌手，行与行之间不画线，
 * hover 铺一层墨色淡底，当前行是青柠淡底 + 叶绿曲名，正在播放时封面上跳 EQ。
 * 支持拖拽排序、删除、清空（二次确认）。
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { describeError } from '@/services/errors'
import { useVirtualizer } from '@tanstack/react-virtual'
import { X, Play, CaretUp, CaretDown, Shuffle, BookmarkSimple } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { useT } from '@/i18n'
import { usePlayerStore } from '@/store/playerStore'
import type { Song } from '@/api/types'
import { useLocalPlaylistStore } from '@/store/localPlaylistStore'
import { useServerStore } from '@/store/serverStore'
import { findAdapterFor } from '@/api'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'
import { EmptyState } from '@/components/common/EmptyState'
import { SourceBadge } from '@/components/sources/SourceBadge'
import { VipTag } from '@/components/sources/VipTag'
import { useCreatePlaylist } from '@/hooks/useServerQueries'
import { useSourceCapabilities } from '@/hooks/useSourceQueries'
import { toast } from '@/components/ui/use-toast'
import { Input } from '@/components/ui/input'
import { useWindowClass } from '@/lib/platform'
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

/** 行内的小圆键：上移 / 下移 / 删除 / 播放共用；触屏 44px，鼠标下 36px */
const ROW_BTN =
  'press-pop grid flex-none place-items-center rounded-pill text-ink-2 hover:bg-ink/[0.08] hover:text-ink disabled:cursor-not-allowed disabled:text-ink-3 disabled:opacity-40 disabled:hover:bg-transparent'

export function QueueDrawer() {
  const { t }           = useT()
  const queue           = usePlayerStore(s => s.queue)
  const multiSource     = useServerStore(s => s.connectedServerIds.length > 1)
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
  const isMobile        = useWindowClass() === 'compact'

  /**
   * 队列可以很长——按一次「全库随机」就是几百上千首。
   * 全量实挂时抽屉一打开要造上万个 DOM 节点，入场动画当场卡顿。
   * 超过阈值才虚拟化：短队列实挂更简单，也没有测量带来的首帧抖动。
   */
  const viewportRef = useRef<HTMLDivElement | null>(null)

  /**
   * 「存为歌单」。
   *
   * 随机播放撞出一段好听的序列，或者手动排了半天队列——关掉播放器就没了。
   * createPlaylist 早就实现好了，缺的只是一个入口。
   *
   * 存的是 order（当前播放顺序）而不是 queue（数组存储顺序）：
   * 开着随机时，用户想留住的正是他刚听到的那个顺序。
   */
  const createPlaylist = useCreatePlaylist()
  const primaryServerId = useServerStore(s => s.activeServerId)
  const caps = useSourceCapabilities()
  const createLocal = useLocalPlaylistStore(s => s.create)
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveName, setSaveName] = useState('')

  const [confirmClear, setConfirmClear] = useState(false)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  // ESC 关闭；模态对话框（如清空确认）打开时让位给对话框自身的 ESC 处理
  useEffect(() => {
    if (!isQueueOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // 全屏播放器（页面级）不算模态，ESC 仍归队列抽屉（A1 同款排除）
      if (document.querySelector('[role="dialog"]:not([data-fullscreen-player]), [role="alertdialog"]:not([data-fullscreen-player])')) return
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

  const handleSaveAsPlaylist = useCallback(async () => {
    const name = saveName.trim()
    if (!name) return
    /*
     * 混源队列分家（阶段 1.10；复核 F7 补 caps 闸）：主库的歌进服务端歌单
     * （id 有意义），但只在主库声明了 playlistWrite 时——主库是只读账号或
     * 插件源时发给它只会建出指向别的曲子的歌单，这些歌同样落本地。
     * 插件源的歌 id 只在自己源里有效，永远落本地混合歌单
     * （新建一张本地单，不是并进已有的；与「加入歌单」的跨源策略一致）。
     */
    const songsInOrder = order.map(qi => queue[qi]).filter((song): song is Song => !!song)
    const primaryWritable = !!primaryServerId && caps[primaryServerId]?.playlistWrite === true
    const belongsToPrimary = (song: Song) => (song.serverId || primaryServerId || '') === primaryServerId
    const primarySongs: Song[] = []
    const localSongs: Song[] = []
    for (const song of songsInOrder) {
      if (primaryWritable && belongsToPrimary(song)) primarySongs.push(song)
      else localSongs.push(song)
    }
    try {
      if (primarySongs.length) {
        await createPlaylist.mutateAsync({ name, songIds: primarySongs.map(song => song.id) })
      }
      if (localSongs.length) {
        await createLocal(name, localSongs)
      }
      setSaveOpen(false)
      toast({
        title: t('queue.saved', { name }),
        ...(primarySongs.length && localSongs.length
          ? { description: t('queue.savedMixed', { server: primarySongs.length, local: localSongs.length }) }
          : !primarySongs.length && localSongs.length
            ? { description: t('queue.savedLocal', { count: localSongs.length }) }
            : {}),
      })
    } catch (err) {
      toast({
        title: t('queue.saveFailed'),
        /* 错误文案走唯一映射（阶段 8.3）；翻不出来给通用句，不亮原始 message */
        description: describeError(err),
        variant: 'destructive',
      })
    }
  }, [saveName, order, queue, createPlaylist, createLocal, primaryServerId, caps, t])

  const renderRow = useCallback((qi: number, pos: number) => {
            const song = queue[qi]
            if (!song) return null
            const isCurrent = qi === queueIndex
            const cover = song.coverArt ? findAdapterFor(song.serverId)?.getCoverUrl(song.coverArt, 88) ?? undefined : undefined

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
                  'press-pop group mx-2 flex cursor-pointer items-center gap-3 rounded-[12px] px-2 py-2',
                  isCurrent ? 'bg-lime/20' : 'hover:bg-ink/[0.06]',
                  overIndex === pos && dragIndex !== null && 'ring-2 ring-inset ring-leaf/50',
                  dragIndex === pos && 'opacity-50'
                )}
              >
                {/* 封面：当前曲在播放时盖一层暗幕，上面跳 EQ */}
                <span className="cover-frame h-11 w-11 flex-none rounded-[9px] shadow-sm">
                  <ImageWithFallback src={cover} alt="" fallbackType="album" className="h-full w-full" />
                  {isCurrent && isPlaying && (
                    <span className="absolute inset-0 z-[1] grid place-items-center bg-stage-deep/55" aria-hidden="true">
                      <span className="playing-bar">
                        <span /><span /><span />
                      </span>
                    </span>
                  )}
                </span>

                <span className="flex min-w-0 flex-1 flex-col leading-tight">
                  <span
                    className={cn(
                      'flex min-w-0 items-center gap-1.5 text-[14.5px] font-semibold',
                      isCurrent ? 'text-leaf' : 'text-ink'
                    )}
                  >
                    <span className="truncate">{spaceCJK(song.title)}</span>
                    <VipTag song={song} />
                    {multiSource && <SourceBadge serverId={song.serverId} />}
                  </span>
                  <span className="mt-0.5 flex min-w-0 items-baseline gap-2 text-[13px] text-ink-3">
                    <span className="min-w-0 truncate">{spaceCJK(song.artist)}</span>
                    <span className="num flex-none text-[12.5px]">{formatDuration(song.duration)}</span>
                  </span>
                </span>

                {/* 触屏上 HTML5 拖拽事件不触发，用上移/下移按钮兜底 */}
                {isMobile ? (
                  <span className="-mr-1 flex flex-none items-center">
                    <button
                      onClick={(e) => { e.stopPropagation(); moveByPosition(pos, pos - 1) }}
                      disabled={pos === 0}
                      className={cn(ROW_BTN, 'h-11 w-11')}
                      aria-label={t('queue.moveUp', { title: song.title })}
                    >
                      <CaretUp size={16} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); moveByPosition(pos, pos + 1) }}
                      disabled={pos === order.length - 1}
                      className={cn(ROW_BTN, 'h-11 w-11')}
                      aria-label={t('queue.moveDown', { title: song.title })}
                    >
                      <CaretDown size={16} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); removeFromQueue(qi) }}
                      className={cn(ROW_BTN, 'h-11 w-11')}
                      aria-label={t('queue.remove', { title: song.title })}
                    >
                      <X size={15} />
                    </button>
                  </span>
                ) : (
                  <span className="flex flex-none items-center gap-0.5 transition-opacity duration-2 ease-out motion-reduce:transition-none [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100">
                    <button
                      onClick={(e) => { e.stopPropagation(); jumpToIndex(qi) }}
                      className={cn(ROW_BTN, 'h-9 w-9 hover:text-leaf')}
                      aria-label={t('queue.playSong', { title: song.title })}
                    >
                      <Play size={13} weight="fill" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); removeFromQueue(qi) }}
                      className={cn(ROW_BTN, 'h-9 w-9 hover:text-leaf')}
                      aria-label={t('queue.remove', { title: song.title })}
                    >
                      <X size={14} />
                    </button>
                  </span>
                )}
              </li>
            )
    // 依赖必须是 order 本身而不是 order.length：拖拽重排后长度不变、内容变了，
    // 只盯长度的话 renderRow 不会重建，行上的操作会作用在**旧顺序**上——
    // 于是「上移」挪的是另一首歌。order 是 useMemo 出来的，引用稳定，不会多余重建。
  }, [queue, queueIndex, isPlaying, isMobile, multiSource, order, dragIndex, overIndex, handleDragStart, handleDragOver, handleDrop, jumpToIndex, moveByPosition, removeFromQueue, t])

  if (!isQueueOpen) return null

  return (
    <>
      {/* 点击面板外区域关闭：宽窗口是透明遮罩（只覆盖内容区，不遮挡播放条）；窄窗口是模态弹层，压暗它后面的一切 */}
      <div
        className={cn(
          'absolute inset-0',
          isMobile ? 'z-[45] bg-ink/25 animate-overlay-in motion-reduce:animate-none' : 'z-20'
        )}
        aria-hidden="true"
        onClick={() => setQueueOpen(false)}
      />

      {/* 面板：宽窗口贴右侧浮起（底边让开底部播放区）；窄窗口是底部弹层（含底部安全区，盖过标签栏） */}
      <div
        className={cn(
          'absolute flex flex-col overflow-hidden bg-surface shadow-lg motion-reduce:animate-none',
          isMobile
            ? 'inset-x-0 bottom-0 z-50 max-h-[85%] rounded-t-xl animate-sheet-in'
            : 'right-2.5 top-2.5 z-30 w-[360px] max-w-[calc(100%-20px)] rounded-xl animate-slide-in-right'
        )}
        style={isMobile
          ? { paddingBottom: 'env(safe-area-inset-bottom)' }
          : { bottom: 'calc(var(--dock-h, 96px) + 10px)' }}
      >
        {/* 把手：只在底部弹层上有，提示它是从下面升起来的 */}
        {isMobile && <div className="mx-auto mt-2.5 h-1 w-10 flex-none rounded-pill bg-ink/20" aria-hidden="true" />}

        {/* 头部：标题 + 关闭；下一行是存为歌单 / 清空 */}
        <div className={cn('flex-none px-5 pb-1', isMobile ? 'pt-2' : 'pt-5')}>
          <div className="flex items-center justify-between gap-3">
            <h3 className="flex min-w-0 items-baseline gap-2.5 font-display text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink">
              {t('player.queue')}
              {/* 面板此时显示的是随机顺序而非原始曲序，必须说明，否则用户会以为随机没生效 */}
              {shuffle && (
                <span className="inline-flex items-center gap-1 font-sans text-[12.5px] font-semibold tracking-normal text-leaf">
                  <Shuffle size={12} weight="bold" aria-hidden="true" />
                  {t('queue.shuffledOrder')}
                </span>
              )}
            </h3>
            <Button
              variant="icon"
              size="icon-sm"
              onClick={() => setQueueOpen(false)}
              aria-label={t('queue.close')}
              className="-mr-2 h-11 w-11 flex-none bg-ink/[0.05] hover:bg-ink/[0.09] regular:h-9 regular:w-9"
            >
              <X size={17} />
            </Button>
          </div>
          <div className="-ml-3 mt-1 flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setSaveName(''); setSaveOpen(true) }}
              className="h-11 gap-1.5 text-[13.5px] regular:h-9"
            >
              <BookmarkSimple size={15} aria-hidden="true" />
              {t('queue.saveAsPlaylist')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmClear(true)}
              className="h-11 text-[13.5px] regular:h-9"
            >
              {t('queue.clear')}
            </Button>
          </div>
        </div>

        <ScrollArea className="flex-1" viewportRef={viewportRef}>
          {queue.length === 0 ? (
            <EmptyState mascot="nuomi-sleep"
              title={t('empty.queue.title')}
              description={t('empty.queue.description')}
              className="py-12"
            />
          ) : (
            <QueueList
              order={order}
              renderRow={renderRow}
              viewportRef={viewportRef}
              scrollToPosition={position}
            />
          )}
        </ScrollArea>

        {queue.length > 0 && (
          <div className="flex-none px-5 py-3">
            {/* 计数按播放位置算：随机时数组下标毫无意义（会显示成「17 / 40」而实际在第 3 首） */}
            <p className="flex flex-wrap justify-center gap-x-3 text-[12.5px] text-ink-3">
              {/* 数字留在 .num 里（等宽 tabular），单位词跟着语言走 */}
              <span>
                <span className="num">{queue.length}</span>{' '}
                {queue.length === 1 ? t('queue.trackUnit') : t('queue.tracksUnit')}
              </span>
              <span className="num">{position >= 0 ? position + 1 : '–'} / {order.length}</span>
              {shuffle && <span>{t('queue.shuffledOrderNote')}</span>}
            </p>
          </div>
        )}
      </div>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="regular:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('queue.saveAsPlaylist')}</DialogTitle>
            <DialogDescription>
              {t('queue.saveDesc', { count: order.length })}
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={saveName}
            onChange={e => setSaveName(e.target.value)}
            onKeyDown={e => {
              /* 组词中的 Enter 是确认候选词，不是提交（阶段 2.5） */
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) void handleSaveAsPlaylist()
            }}
            placeholder={t('queue.savePlaceholder')}
            aria-label={t('playlist.name')}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setSaveOpen(false)}>{t('action.cancel')}</Button>
            <Button
              onClick={() => { void handleSaveAsPlaylist() }}
              disabled={!saveName.trim() || createPlaylist.isPending}
            >
              {createPlaylist.isPending ? t('queue.saving') : t('action.save')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
        <DialogContent className="regular:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('queue.clearConfirmTitle')}</DialogTitle>
            <DialogDescription>
              {t('queue.clearConfirmDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setConfirmClear(false)}>{t('action.cancel')}</Button>
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
/** 行高估计值：44px 封面 + 上下 padding，实测 60px */
const QUEUE_ROW_HEIGHT = 60

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
  scrollToPosition,
}: {
  order: number[]
  renderRow: (qi: number, pos: number) => React.ReactNode
  viewportRef: React.RefObject<HTMLDivElement | null>
  /** 打开时要滚到的播放位置；-1 表示不滚 */
  scrollToPosition: number
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

  /**
   * 打开时滚到正在播放的那一首。
   *
   * 「全库随机」之后队列有几百首，当前曲通常在中间某处——不滚的话
   * 每次打开都得自己翻找，而这个面板最常见的用途恰恰是「看看接下来是什么」。
   *
   * 只在拿到滚动容器后做一次：scrollEl 就绪即为「面板已打开」，
   * 面板关闭时整棵子树会卸载，下次打开是全新的一轮。
   */
  const didScrollRef = useRef(false)
  useEffect(() => {
    if (didScrollRef.current || !scrollEl || scrollToPosition < 0) return
    didScrollRef.current = true
    if (order.length > QUEUE_VIRTUALIZE_THRESHOLD) {
      virtualizer.scrollToIndex(scrollToPosition, { align: 'center' })
    } else {
      // 未虚拟化时直接找那一行；rAF 等布局稳定后再滚
      requestAnimationFrame(() => {
        scrollEl.querySelectorAll('li')[scrollToPosition]
          ?.scrollIntoView({ block: 'center' })
      })
    }
  }, [scrollEl, scrollToPosition, order.length, virtualizer])

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
