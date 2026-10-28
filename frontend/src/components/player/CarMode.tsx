/**
 * 车载模式。
 *
 * 开车时的约束和平时完全不是一回事：一眼最多零点几秒，手指落点不准，
 * 车里有震动，屏幕可能在阳光下。所以这一屏只做三件事——
 *
 *   1. 触控目标全部按「不用瞄准」来做：主键（青柠播放键）112–128px，副键 72–96px，
 *      顶栏的键也有 64px，各家无障碍指南 44/48pt 下限的近一倍半以上；
 *   2. 字号按「余光扫一眼」来定，曲名 clamp 到接近整屏宽；
 *   3. 屏幕不许自己黑掉——用 Wake Lock 顶住，退出时立刻释放。
 *
 * 它是一整块「灯暗下来」的舞台（.stage：与全屏播放器同一套暗色 token，色相取自当前封面），
 * 开车时不该有一块亮屏晃眼睛。真正提高可读性的是尺寸和留白，不是荧光色：
 * 只有播放键和进度是青柠。
 * 竖屏是上下三段（顶栏 / 曲目 / 控制），横屏把曲目放左、控制放右。
 */

import { useCallback, useEffect, useRef } from 'react'
import { Play, Pause, SkipBack, SkipForward, X } from '@phosphor-icons/react'
import { usePlayerStore } from '@/store/playerStore'
import { seekHowl } from '@/hooks/useAudioEngine'
import { useToggleStar } from '@/hooks/useServerQueries'
import { useSourceCapabilities } from '@/hooks/useSourceQueries'
import { sourceSupportsFavorites } from '@/services/heartCapability'
import { formatDuration } from '@/utils/formatters'
import { spaceCJK } from '@/utils/cjkTypography'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { HeartGlyph } from '@/components/player/glyphs'
import { useT } from '@/i18n'

/** 屏幕常亮句柄的最小接口，避免为一个实验性 API 引入整套 DOM 类型 */
interface WakeLockSentinelLike {
  release: () => Promise<void>
  addEventListener: (type: 'release', handler: () => void) => void
}

/**
 * 屏幕常亮。
 *
 * 标签页切走时系统会自动释放，切回来必须重新申请——不补这一下，
 * 从导航切回音乐后屏幕会在几十秒内黑掉，正是最需要它亮着的时候。
 */
function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> }
    }
    if (!nav.wakeLock) return

    let sentinel: WakeLockSentinelLike | null = null
    let disposed = false

    const acquire = async () => {
      if (disposed || document.visibilityState !== 'visible') return
      try {
        const next = await nav.wakeLock!.request('screen')
        if (disposed) {
          void next.release()
          return
        }
        sentinel = next
        /**
         * 浏览器可以自己撤销这把锁（电量过低、系统省电模式介入），
         * 而且撤销时**不会**触发 visibilitychange。只盯着可见性的话，
         * 屏幕一旦被系统黑掉就再也不会重新顶住——正是开车时最需要它亮着的时候。
         */
        next.addEventListener('release', () => {
          if (sentinel === next) sentinel = null
          void acquire()
        })
      } catch {
        // 电量过低 / 用户拒绝 / 浏览器不支持：退化成普通行为即可
      }
    }

    const onVisibility = () => { if (document.visibilityState === 'visible') void acquire() }
    void acquire()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', onVisibility)
      void sentinel?.release().catch(() => {})
    }
  }, [active])
}

export function CarMode({ onExit }: { onExit: () => void }) {
  const { t } = useT()
  const currentSong = usePlayerStore(s => s.currentSong)
  /* B4：心形按 favorites 能力出现，占位保持按钮间距 */
  const caps = useSourceCapabilities()
  const canFavoriteCurrent = sourceSupportsFavorites(caps, currentSong?.serverId)
  const isPlaying = usePlayerStore(s => s.isPlaying)
  const currentTime = usePlayerStore(s => s.currentTime)
  const duration = usePlayerStore(s => s.duration)
  const togglePlay = usePlayerStore(s => s.togglePlay)
  const next = usePlayerStore(s => s.next)
  const prev = usePlayerStore(s => s.prev)
  const toggleStar = useToggleStar()

  useWakeLock(true)

  // Esc 退出：车机上多半接了键盘/方向盘按键，桌面上也顺手
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onExit() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onExit])

  /**
   * 左右滑动切歌。
   *
   * 开车时最可靠的手势是「往一个方向抹一下」，不需要看准任何按钮。
   * 阈值定得比平常大（80px）：车里的抖动很容易蹭出十几像素的位移。
   */
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0]
    touchStart.current = { x: touch.clientX, y: touch.clientY }
  }, [])
  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    const start = touchStart.current
    touchStart.current = null
    if (!start) return
    const touch = e.changedTouches[0]
    const dx = touch.clientX - start.x
    const dy = touch.clientY - start.y
    if (Math.abs(dx) < 80 || Math.abs(dx) < Math.abs(dy) * 1.5) return
    if (dx < 0) next()
    else prev()
  }, [next, prev])

  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0

  if (!currentSong) {
    return (
      <div className="stage stage-fallback fixed inset-0 z-[100] flex flex-col items-center justify-center px-6 text-center text-ink">
        <p className="font-display text-3xl font-semibold tracking-[-0.02em]">{t('player.nothingPlaying')}</p>
        <Button
          variant="secondary"
          size="lg"
          onClick={onExit}
          className="mt-10 h-16 px-10 text-xl"
        >
          {t('player.exitCarMode')}
        </Button>
      </div>
    )
  }

  return (
    <div
      className="stage stage-fallback fixed inset-0 z-[100] flex flex-col pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] pt-[env(safe-area-inset-top)] text-ink"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      role="region"
      aria-label={t('player.carMode')}
    >
      {/*
        顶栏：收藏放这里，退出放对角。
        收藏不是开车时的关键操作，把它从拇指区挪上来，下面那一排就只剩
        「上一首 / 播放 / 下一首」——窄屏上三个键才排得开，不会被切掉。
      */}
      <div className="flex flex-shrink-0 items-center justify-between p-4 regular:p-6">
        {canFavoriteCurrent ? (
          <Button
            variant="secondary"
            size="icon-lg"
            onClick={() => toggleStar.mutate({
              id: currentSong.id,
              type: 'song',
              isStarred: !!currentSong.starred,
              song: currentSong,
            })}
            aria-label={currentSong.starred ? t('player.unfavorite') : t('player.favorite')}
            className="h-16 w-16"
          >
            <HeartGlyph on={!!currentSong.starred} size={30} />
          </Button>
        ) : (
          <span className="grid h-16 w-16" aria-hidden="true" />
        )}
        <Button
          variant="secondary"
          size="icon-lg"
          onClick={onExit}
          aria-label={t('player.exitCarMode')}
          className="h-16 w-16"
        >
          <X size={30} />
        </Button>
      </div>

      {/* 竖屏上下排，横屏左右排：曲目信息在左，控制在右 */}
      <div className="flex min-h-0 flex-1 flex-col landscape:flex-row landscape:items-center">
        {/* 曲目信息：整屏最先被看到的东西 */}
        <div className="flex min-w-0 flex-1 flex-col items-center justify-center px-6 text-center landscape:items-start landscape:text-left regular:px-10">
          <h1 className="line-clamp-2 font-display text-[clamp(2.5rem,8vw,5rem)] font-bold leading-[1.08] tracking-[-0.03em]">
            {spaceCJK(currentSong.title)}
          </h1>
          <p className="mt-4 line-clamp-1 text-[clamp(1.25rem,3.4vw,2rem)] font-medium text-ink-2">
            {spaceCJK(currentSong.artist)}
          </p>

          {/* 进度：青柠填进淡墨轨，不做刻度也不做可拖拽——开车时不该去够它；只动 transform */}
          <div className="mt-12 w-full max-w-3xl landscape:mt-8">
            <div className="h-3 w-full overflow-hidden rounded-pill bg-ink/20">
              <div
                className="h-full w-full origin-left rounded-pill bg-lime transition-transform duration-500 motion-reduce:transition-none"
                style={{ transform: `scaleX(${progress})` }}
              />
            </div>
            <div className="num mt-3 flex justify-between text-[18px] font-medium text-ink-3">
              <span>{formatDuration(currentTime)}</span>
              <span>{formatDuration(duration)}</span>
            </div>
          </div>
        </div>

        {/*
          控制区：主键 112（窄屏）/ 128，副键 72 / 96。
          最小的那一档也是 44pt 下限的近两倍，而三个键加间距在 375px 上仍排得开——
          按钮被屏幕切掉，比按钮小更危险。
        */}
        <div className="flex flex-shrink-0 items-center justify-center gap-5 pb-[max(2rem,env(safe-area-inset-bottom))] regular:gap-10 landscape:gap-5 landscape:px-8 landscape:pb-[max(1rem,env(safe-area-inset-bottom))]">
          <CarButton
            label={t('player.previous')}
            onClick={() => (currentTime > 3 ? seekHowl(0) : prev())}
            className="h-[72px] w-[72px] regular:h-24 regular:w-24"
          >
            <SkipBack size={36} weight="fill" />
          </CarButton>

          <CarButton
            label={isPlaying ? t('player.pause') : t('player.play')}
            onClick={togglePlay}
            className="h-28 w-28 regular:h-32 regular:w-32"
            primary
          >
            {isPlaying ? <Pause size={56} weight="fill" /> : <Play size={56} weight="fill" />}
          </CarButton>

          <CarButton
            label={t('player.next')}
            onClick={next}
            className="h-[72px] w-[72px] regular:h-24 regular:w-24"
          >
            <SkipForward size={36} weight="fill" />
          </CarButton>
        </div>
      </div>
    </div>
  )
}

/** 主键是青柠播放键（.play-key）；副键是舞台上抬一档的圆钮 */
function CarButton({
  label, onClick, className, primary, children,
}: {
  label: string
  onClick: () => void
  className: string
  primary?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        primary
          ? 'play-key flex-none'
          : 'press-pop grid flex-none place-items-center rounded-full bg-fill text-ink hover:bg-fill-2',
        className
      )}
    >
      {children}
    </button>
  )
}
