/**
 * 电视的工具栏：没有后退前进（遥控器有返回键）、没有「更多」（导航条全摊开了），
 * 只剩滚动后浮现的栏目名，和右上角的「正在播放」——按确认打开播放页。
 *
 * data-nav-noscroll：它吸顶，焦点停在这里时内容区不该为它滚动。
 * data-nav-noauto：它在 DOM 里排在内容前面，进页面时焦点不该先落到它上面。
 * data-nav-last：往上走先到页面顶上的标签、按钮，上面真没东西了才到这里。
 */

import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { usePlayerStore } from '@/store/playerStore'
import { useCoverUrl } from '@/hooks/useCoverUrl'
import { CoverImage } from '@/components/common/CoverImage'
import { spaceCJK } from '@/utils/cjkTypography'
import { useT } from '@/i18n'
import { sectionKeyFor } from '@/components/layout/sections'

function NowPlayingChip() {
  const { t } = useT()
  const song = usePlayerStore(s => s.currentSong)
  const isPlaying = usePlayerStore(s => s.isPlaying)
  const setFullscreen = usePlayerStore(s => s.setFullscreen)
  const { primary, fallback } = useCoverUrl(song ?? undefined, { size: 96 })
  if (!song) return null
  return (
    <button
      type="button"
      onClick={() => setFullscreen(true)}
      aria-label={t('tv.nowPlayingChip', { title: song.title })}
      className="glass flex h-8 max-w-[300px] flex-none items-center gap-2 rounded-pill py-0 pl-1 pr-3.5 text-[12px] text-ink-2"
    >
      {/* 播放页的大封面从这里飞出去、收起时飞回来（FullscreenPlayer 的 anchorRects） */}
      <span className="cover-frame h-6 w-6 flex-none rounded-pill" data-np-anchor="">
        <CoverImage primary={primary} fallback={fallback} alt="" className="h-full w-full" songId={song.id} />
      </span>
      {isPlaying && (
        <span className="playing-bar flex-none" style={{ height: 11 }} aria-hidden="true">
          <span /><span /><span />
        </span>
      )}
      <span className="min-w-0 truncate">
        <b className="font-semibold text-ink">{spaceCJK(song.title)}</b>
        <span className="text-ink-3"> · {spaceCJK(song.artist)}</span>
      </span>
    </button>
  )
}

export function TvToolbar({ scrolled, titled, children }: { scrolled: boolean; titled: boolean; children?: ReactNode }) {
  const { t } = useT()
  const { pathname } = useLocation()
  const sectionKey = sectionKeyFor(pathname)
  return (
    <div className="sticky top-0 z-30" data-scrolled={scrolled || undefined} data-nav-noscroll="" data-nav-noauto="" data-nav-last="">
      <div className="scroll-edge flex h-[60px] items-end gap-4 pb-2 pl-[116px] pr-12">
        <p
          className={cn(
            'min-w-0 flex-1 truncate pb-1.5 font-display text-[15.5px] font-semibold tracking-[-0.01em] text-ink transition-[opacity,transform] duration-3 ease-out',
            titled ? 'translate-y-0 opacity-100' : 'translate-y-1.5 opacity-0'
          )}
          aria-hidden={!titled}
        >
          {sectionKey ? t(sectionKey) : ''}
        </p>
        <NowPlayingChip />
      </div>
      {children}
    </div>
  )
}
