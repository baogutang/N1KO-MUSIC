/**
 * 封面卡（阶段 7.4）：专辑墙 / 歌单墙 / 歌手墙共用的外壳。
 *
 * 此前同一张「方封面 + 图注」有五套手写实现（Playlists 两套、AlbumCard、
 * MiniSheetCard、ArtistCard），圆角/描边/hover 动效各差一点，键盘可达性只有
 * AlbumCard 有。收敛后：
 * - 外层统一 role=button + tabIndex + Enter/Space（可键盘）；
 * - 封面砖统一 .cover-tile（抬起的方片，见 index.css）；
 * - 砖内容（图片/占位）与浮层（播放键、角标）、图注（标题、计数）由调用方提供。
 *
 * 另外导出 CoverShelf（横向书架）与 CoverGrid（自适应网格），封面卡的两种摆法。
 */

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { CaretLeft, CaretRight } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { rememberCoverOrigin } from '@/lib/sharedCover'
import { useT } from '@/i18n'

export function CoverCard({
  onClick,
  onActivate,
  className,
  tileClassName,
  round = false,
  tile,
  overlay,
  title,
  meta,
  captionExtra,
  centered = false,
  'aria-label': ariaLabel,
}: {
  onClick: () => void
  /** 键盘激活入口；缺省与 onClick 相同（两者大多一致，个别卡要区分） */
  onActivate?: () => void
  className?: string
  tileClassName?: string
  /** 歌手语境：圆形头像 */
  round?: boolean
  /** 封面砖的内容（图片 / 占位图标），铺满砖 */
  tile: ReactNode
  /** 封面上的浮层（播放键、角标），绝对定位由内容自理 */
  overlay?: ReactNode
  /** 图注主行（标题） */
  title: ReactNode
  /** 图注次行（计数、歌手名） */
  meta?: ReactNode
  /** 图注之后的整块内容（本地歌单的徽标行等） */
  captionExtra?: ReactNode
  /** 居中图注（歌手墙是圆像居中排版） */
  centered?: boolean
  'aria-label'?: string
}) {
  const tileRef = useRef<HTMLDivElement>(null)
  // 点开前记下封面的位置：详情页的大封面从这里飞过去（lib/sharedCover）
  const open = () => {
    rememberCoverOrigin(tileRef.current)
    onClick()
  }
  const activate = onActivate ?? open
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      className={cn(
        'group min-w-0 cursor-pointer rounded-md',
        centered && 'w-full text-center',
        className
      )}
      onClick={open}
      onKeyDown={e => {
        /* 内层控件（播放键、菜单项）自己的 Enter/Space 不归卡片管（A6）：
           冒泡上来直接跳转会吞掉它们的默认行为 */
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          activate()
        }
      }}
    >
      <div className="relative mb-2.5">
        <div
          ref={tileRef}
          className={cn(
            'cover-frame aspect-square',
            round
              ? 'rounded-full shadow-md transition-transform duration-4 ease-smooth [@media(hover:hover)]:group-hover:scale-[1.03] group-active:scale-[0.98]'
              : 'cover-tile',
            tileClassName
          )}
        >
          {tile}
        </div>
        {overlay}
      </div>
      <div className={cn('min-w-0', !centered && 'px-0.5')}>
        <p className="truncate text-[14.5px] font-semibold leading-snug text-ink">
          {title}
        </p>
        {meta !== undefined && <p className="mt-0.5 truncate text-[13px] text-ink-3">{meta}</p>}
        {captionExtra}
      </div>
    </div>
  )
}

/**
 * 横向书架：一排封面卡，横向滑动，贴着页面左右内边距出血。
 * 卡片宽度由书架统一给（子元素选择器），调用方只管放 CoverCard。
 * 上下留的 padding 是给 hover 抬起与投影的——overflow-x 会把纵向也裁掉。
 */
export function CoverShelf({ children, className }: { children: ReactNode; className?: string }) {
  const { t } = useT()
  const railRef = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ start: true, end: true })

  // 两端的翻页键只在还能翻的那一侧出现（有鼠标的设备；触屏直接滑，按卡片吸附）
  useEffect(() => {
    const rail = railRef.current
    if (!rail) return
    let raf = 0
    const measure = () => {
      raf = 0
      const max = rail.scrollWidth - rail.clientWidth
      const start = rail.scrollLeft <= 4
      const end = rail.scrollLeft >= max - 4
      setEdges(prev => (prev.start === start && prev.end === end ? prev : { start, end }))
    }
    // 每帧最多量一次；两端状态没变就不 setState（以前每个 scroll 事件都新建对象，整排书架跟着重渲染）
    const sync = () => { if (!raf) raf = requestAnimationFrame(measure) }
    measure()
    rail.addEventListener('scroll', sync, { passive: true })
    const ro = new ResizeObserver(sync)
    ro.observe(rail)
    return () => {
      cancelAnimationFrame(raf)
      rail.removeEventListener('scroll', sync)
      ro.disconnect()
    }
  }, [])

  const page = (dir: 1 | -1) => {
    const rail = railRef.current
    if (!rail) return
    rail.scrollBy({ left: dir * rail.clientWidth * 0.8, behavior: 'smooth' })
  }

  const arrow = 'press-pop glass absolute top-[38%] z-raised hidden h-10 w-10 -translate-y-1/2 place-items-center rounded-pill text-ink [@media(hover:hover)]:grid'
  return (
    <div className="group/shelf relative">
      <div
        ref={railRef}
        className={cn(
          'flex snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain scrollbar-hide -mx-4 scroll-px-4 px-4 pb-5 pt-2 regular:-mx-6 regular:scroll-px-6 regular:px-6 wide:-mx-8 wide:scroll-px-8 wide:px-8',
          '[&>*]:w-[148px] [&>*]:flex-none [&>*]:snap-start regular:[&>*]:w-[164px] wide:[&>*]:w-[180px]',
          className
        )}
      >
        {children}
      </div>
      {!edges.start && (
        <button
          type="button"
          onClick={() => page(-1)}
          aria-label={t('action.previousPage')}
          className={cn(arrow, '-left-3 opacity-0 transition-opacity duration-3 group-hover/shelf:opacity-100 focus-visible:opacity-100')}
        >
          <CaretLeft size={18} weight="bold" />
        </button>
      )}
      {!edges.end && (
        <button
          type="button"
          onClick={() => page(1)}
          aria-label={t('action.nextPage')}
          className={cn(arrow, '-right-3 opacity-0 transition-opacity duration-3 group-hover/shelf:opacity-100 focus-visible:opacity-100')}
        >
          <CaretRight size={18} weight="bold" />
        </button>
      )}
    </div>
  )
}

/** 自适应封面网格：一行放多少列看宽度，最小 160px */
export function CoverGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'grid grid-cols-[repeat(auto-fill,minmax(min(100%,160px),1fr))] gap-x-5 gap-y-7',
        className
      )}
    >
      {children}
    </div>
  )
}
