/**
 * 全屏播放器电视排法用到的两块（排法本身在 FullscreenPlayer 的 layout === 'tv'）：
 *
 * - useTvIdle：八秒没按键，进度和控制淡下去，只剩封面和歌词（电视开着放歌，没人盯着按钮）。
 *   淡下去以后第一下方向键 / 确认只是把控件叫回来，不挪焦点、不切歌。
 * - TvUpNextRow：「接下来」那一排。平时藏在屏幕下沿外面，焦点从控制键往下一走它就升起来；
 *   确认键跳到那一首，返回键收起、焦点回到播放键。
 */

import { useEffect, useRef, useState } from 'react'
import type { Song } from '@/api/types'
import { addNavInterceptor } from '@/lib/spatialNav'
import { useCoverUrl } from '@/hooks/useCoverUrl'
import { CoverImage } from '@/components/common/CoverImage'
import { spaceCJK } from '@/utils/cjkTypography'
import { cn } from '@/lib/utils'
import { useT } from '@/i18n'

const IDLE_MS = 8000
const WAKE_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '])

export function useTvIdle(enabled: boolean): boolean {
  const [idle, setIdle] = useState(false)
  const idleRef = useRef(false)

  useEffect(() => {
    if (!enabled) {
      idleRef.current = false
      setIdle(false)
      return
    }
    let timer = 0
    const arm = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => { idleRef.current = true; setIdle(true) }, IDLE_MS)
    }
    arm()
    const remove = addNavInterceptor(e => {
      const wasIdle = idleRef.current
      idleRef.current = false
      setIdle(false)
      arm()
      return wasIdle && WAKE_KEYS.has(e.key)
    })
    return () => {
      window.clearTimeout(timer)
      remove()
    }
  }, [enabled])

  return idle
}

function UpNextCard({ song, first, onPick }: { song: Song; first: boolean; onPick: () => void }) {
  const { primary, fallback } = useCoverUrl(song, { size: 240 })
  return (
    <div
      role="button"
      tabIndex={0}
      data-tv-card=""
      // 从控制往下进来总是落在下一首上，不管控制键正下方是哪一张
      data-nav-preferred={first ? '' : undefined}
      aria-label={`${song.title} · ${song.artist}`}
      onClick={onPick}
      onKeyDown={e => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        onPick()
      }}
      className="w-[120px] flex-none cursor-pointer snap-start rounded-md"
    >
      <div className="cover-frame aspect-square w-full shadow-md">
        <CoverImage primary={primary} fallback={fallback} alt="" className="h-full w-full" songId={song.id} />
      </div>
      <p className="mt-2.5 truncate text-[13px] font-semibold text-ink-2">{spaceCJK(song.title)}</p>
      <p className="truncate text-[11.5px] text-ink-3">{spaceCJK(song.artist)}</p>
    </div>
  )
}

/**
 * upcoming 是队列下标（已按播放顺序排好、开了循环会绕回开头）。
 * onBack：返回键收起这一排时把焦点交回去。
 */
export function TvUpNextRow({
  queue, upcoming, onPick, onBack,
}: {
  queue: Song[]
  upcoming: number[]
  onPick: (queueIndex: number) => void
  onBack: () => void
}) {
  const { t } = useT()
  const rootRef = useRef<HTMLDivElement>(null)

  // 返回键（TvModeEffects / useNativeAppIntegration 先发 n1ko:back 给焦点所在的元素）
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const onBackEvent = (e: Event) => {
      e.preventDefault()
      onBack()
    }
    root.addEventListener('n1ko:back', onBackEvent)
    /* 这一排升起来时上面的控制是淡出的（透明度 0），焦点引擎看不见它们：
       往上那一下由这里接住，直接回到播放键 */
    const removeInterceptor = addNavInterceptor(e => {
      if (e.key !== 'ArrowUp' || !root.contains(document.activeElement)) return false
      onBack()
      return true
    })
    return () => {
      root.removeEventListener('n1ko:back', onBackEvent)
      removeInterceptor()
    }
  }, [onBack])

  return (
    <div
      ref={rootRef}
      className={cn(
        'tv-np-upnext absolute inset-x-0 bottom-0 z-20 h-[250px] px-[80px] pt-6',
        'bg-surface/55 shadow-[inset_0_1px_0_oklch(var(--ink)/0.1)] backdrop-blur-[30px] backdrop-saturate-150'
      )}
    >
      <h2 className="mb-3.5 flex items-baseline gap-2.5 font-display text-[19px] font-semibold tracking-[-0.02em] text-ink">
        {t('shell.upNext')}
        <small className="font-ui text-[12px] font-normal tracking-normal text-ink-3">
          {upcoming.length > 0 ? t('tv.upNextCount', { count: upcoming.length }) : t('shell.upNextEmpty')}
        </small>
      </h2>
      <div
        className="-ml-3 -mr-[80px] flex gap-4 overflow-x-auto scroll-pl-3 py-3 pl-3 pr-[80px] scrollbar-hide"
        data-nav-group="upnext"
        data-nav-shelf=""
      >
        {upcoming.map((qi, i) => {
          const song = queue[qi]
          if (!song) return null
          return <UpNextCard key={`${song.id}-${qi}`} song={song} first={i === 0} onPick={() => onPick(qi)} />
        })}
      </div>
    </div>
  )
}
