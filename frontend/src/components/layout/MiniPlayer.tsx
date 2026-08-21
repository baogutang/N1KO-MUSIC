/**
 * 移动端迷你播放器（底部导航上方）
 * 顶缘 2px 播放进度线；左 = 封面 + 曲名/歌手（点击展开全屏播放器）
 * 右 = 播放/暂停（实心朱红圆）+ 下一首 + 队列
 * 细粒度 selector 订阅 store，进度线独立渲染避免整体高频重渲染
 */

import { memo } from 'react'
import { Play, Pause, SkipForward, Queue } from '@phosphor-icons/react'
import { Haptics, ImpactStyle } from '@capacitor/haptics'
import { cn } from '@/lib/utils'
import { usePlayerStore } from '@/store/playerStore'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'
import { getAdapter, hasAdapter } from '@/api'
import { isNativePlatform } from '@/lib/platform'
import { spaceCJK } from '@/utils/cjkTypography'
import { useT } from '@/i18n'

/** 主控制轻触感（仅原生壳） */
function lightImpact() {
  if (isNativePlatform) Haptics.impact({ style: ImpactStyle.Light }).catch(() => {})
}

/** 顶缘播放进度线：独立订阅高频字段 */
const ProgressLine = memo(function ProgressLine() {
  const currentTime = usePlayerStore(s => s.currentTime)
  const duration = usePlayerStore(s => s.duration)
  const safeDuration = isFinite(duration) && duration > 0 ? duration : 1
  const percent = Math.min(100, (currentTime / safeDuration) * 100)
  return (
    <div className="absolute top-0 left-0 right-0 h-[2px] bg-hair-soft">
      <div
        className="h-full bg-primary transition-[width] duration-300"
        style={{ width: `${percent}%` }}
      />
    </div>
  )
})

export function MiniPlayer() {
  const { t } = useT()
  const currentSong = usePlayerStore(s => s.currentSong)
  const isPlaying = usePlayerStore(s => s.isPlaying)
  const isQueueOpen = usePlayerStore(s => s.isQueueOpen)
  const togglePlay = usePlayerStore(s => s.togglePlay)
  const next = usePlayerStore(s => s.next)
  const toggleFullscreen = usePlayerStore(s => s.toggleFullscreen)
  const setQueueOpen = usePlayerStore(s => s.setQueueOpen)

  const coverUrl = currentSong?.coverArt && hasAdapter()
    ? getAdapter().getCoverUrl(currentSong.coverArt, 96)
    : undefined

  if (!currentSong) return null

  return (
    <div className="relative flex-shrink-0 border-t border-hair bg-paper">
      <ProgressLine />
      <div className="flex items-center gap-3 px-3 h-[58px]">
        <button
          onClick={toggleFullscreen}
          className="flex items-center gap-3 min-w-0 flex-1 text-left"
          aria-label={t('player.openNowPlaying')}
        >
          <span className="w-10 h-10 rounded-sm overflow-hidden ring-1 ring-border flex-shrink-0">
            <ImageWithFallback
              src={coverUrl}
              alt={currentSong.album}
              fallbackType="album"
              className="w-full h-full"
              eager
              songId={currentSong.id}
              customCoverParams={{ type: 'song', title: currentSong.title, artist: currentSong.artist, album: currentSong.album, path: currentSong.path }}
            />
          </span>
          {/* 切歌翻页，与桌面播放条同一套动作 */}
          <span
            key={currentSong.id}
            className="block min-w-0 animate-page-turn motion-reduce:animate-none"
            style={{ transformOrigin: 'left center', perspective: '640px' }}
          >
            <span className="block font-serif text-[14px] font-semibold text-foreground truncate">
              {spaceCJK(currentSong.title)}
            </span>
            <span className="block text-[11px] text-ink-soft truncate mt-0.5">
              {spaceCJK(currentSong.artist)}
            </span>
          </span>
        </button>

        <button
          onClick={() => { lightImpact(); togglePlay() }}
          className="w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center active:scale-95 transition-transform duration-150 flex-shrink-0"
          aria-label={t(isPlaying ? 'player.pause' : 'player.play')}
        >
          {isPlaying ? (
            <Pause size={16} weight="fill" />
          ) : (
            <Play size={16} weight="fill" className="ml-0.5" />
          )}
        </button>

        <button
          onClick={() => { lightImpact(); next() }}
          className="w-9 h-9 rounded-full flex items-center justify-center text-ink-soft active:text-primary active:scale-95 transition-all duration-150 flex-shrink-0"
          aria-label={t('player.next')}
        >
          <SkipForward size={20} weight="fill" />
        </button>

        <button
          onClick={() => setQueueOpen(!isQueueOpen)}
          className={cn(
            'w-9 h-9 rounded-full flex items-center justify-center active:scale-95 transition-all duration-150 flex-shrink-0',
            isQueueOpen ? 'text-primary' : 'text-ink-soft active:text-primary'
          )}
          aria-label={t('player.queue')}
        >
          <Queue size={20} />
        </button>
      </div>
    </div>
  )
}
