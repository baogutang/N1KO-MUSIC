/**
 * 封面卡（阶段 7.4）：专辑墙 / 歌单墙 / 歌手墙共用的外壳。
 *
 * 此前同一张「方封面 + 图注」有五套手写实现（Playlists 两套、AlbumCard、
 * MiniSheetCard、ArtistCard），圆角/描边/hover 动效各差一点，键盘可达性只有
 * AlbumCard 有。收敛后：
 * - 外层统一 role=button + tabIndex + Enter/Space（可键盘）；
 * - 封面砖统一 .cover-tile（皮肤差异都在那个类里，见 index.css）；
 * - 砖内容（图片/占位）与浮层（播放键、角标）、图注（标题、计数）由调用方提供。
 */

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

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
  /** 图注主行（衬线标题） */
  title: ReactNode
  /** 图注次行（计数、歌手名） */
  meta?: ReactNode
  /** 图注之后的整块内容（本地歌单的徽标行等） */
  captionExtra?: ReactNode
  /** 居中图注（歌手墙是圆像居中排版） */
  centered?: boolean
  'aria-label'?: string
}) {
  const activate = onActivate ?? onClick
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      className={cn(
        'group cursor-pointer min-w-0',
        centered && 'w-full text-center',
        'rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        className
      )}
      onClick={onClick}
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
          className={cn(
            'aspect-square overflow-hidden bg-paper-deep',
            round
              ? 'rounded-full ring-1 ring-hair-soft transition-transform duration-300 ease-out group-hover:scale-[1.03]'
              : 'cover-tile rounded-md ring-1 ring-hair-soft pop:ring-0',
            tileClassName
          )}
        >
          {tile}
        </div>
        {overlay}
      </div>
      <div className={cn('min-w-0', !centered && 'px-0.5')}>
        <p className="font-serif font-semibold text-[15px] leading-snug text-foreground truncate group-hover:text-primary transition-colors">
          {title}
        </p>
        {meta !== undefined && <p className="text-xs text-ink-faint mt-0.5 truncate">{meta}</p>}
        {captionExtra}
      </div>
    </div>
  )
}
