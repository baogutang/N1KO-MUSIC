/**
 * 车载模式。
 *
 * 开车时的约束和平时完全不是一回事：一眼最多零点几秒，手指落点不准，
 * 车里有震动，屏幕可能在阳光下。所以这一屏只做三件事——
 *
 *   1. 触控目标全部按「不用瞄准」来做：主键 112–128px，副键 80–96px，
 *      最小的一档也是各家无障碍指南 44/48pt 下限的近两倍；
 *   2. 字号按「余光扫一眼」来定，曲名 clamp 到接近整屏宽；
 *   3. 屏幕不许自己黑掉——用 Wake Lock 顶住，退出时立刻释放。
 *
 * 它仍然是「纸·墨·朱」：不为了对比度换一套配色，只是把同一套字号和线条
 * 放大到能在颠簸里看清。真正提高可读性的是尺寸和留白，不是荧光色。
 */

import { useCallback, useEffect, useRef } from 'react'
import { Play, Pause, SkipBack, SkipForward, Heart, X } from '@phosphor-icons/react'
import { usePlayerStore } from '@/store/playerStore'
import { seekHowl } from '@/hooks/useAudioEngine'
import { useToggleStar } from '@/hooks/useServerQueries'
import { formatDuration } from '@/utils/formatters'
import { spaceCJK } from '@/utils/cjkTypography'
import { cn } from '@/lib/utils'
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
        sentinel = await nav.wakeLock!.request('screen')
        if (disposed) {
          void sentinel.release()
          sentinel = null
        }
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
      <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-paper">
        <p className="font-serif text-3xl font-semibold">{t('player.nothingPlaying')}</p>
        <button
          onClick={onExit}
          className="mt-10 h-16 px-10 font-serif text-xl underline decoration-hair decoration-1 underline-offset-8"
        >
          {t('player.exitCarMode')}
        </button>
      </div>
    )
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-paper text-ink"
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
      <div className="flex items-center justify-between p-4">
        <button
          onClick={() => toggleStar.mutate({
            id: currentSong.id,
            type: 'song',
            isStarred: !!currentSong.starred,
            song: currentSong,
          })}
          aria-label={currentSong.starred ? t('player.unfavorite') : t('player.favorite')}
          className="grid h-16 w-16 place-items-center rounded-full border border-hair transition-colors hover:border-ink"
        >
          <Heart
            size={26}
            weight={currentSong.starred ? 'fill' : 'regular'}
            className={currentSong.starred ? 'text-primary' : 'text-ink'}
          />
        </button>
        <button
          onClick={onExit}
          aria-label={t('player.exitCarMode')}
          className="grid h-16 w-16 place-items-center rounded-full text-ink-faint transition-colors hover:text-ink"
        >
          <X size={24} />
        </button>
      </div>

      {/* 曲目信息：整屏最先被看到的东西 */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <p className="text-[13px] tracking-[0.3em] text-primary">{t('player.nowPlaying')}</p>
        <h1 className="mt-5 line-clamp-2 font-serif text-[clamp(2.25rem,7vw,4.5rem)] font-bold leading-[1.15]">
          {spaceCJK(currentSong.title)}
        </h1>
        <p className="mt-4 line-clamp-1 text-[clamp(1.1rem,3vw,1.75rem)] text-ink-soft">
          {spaceCJK(currentSong.artist)}
        </p>

        {/* 进度：一根发丝线加一段朱色，不做刻度也不做可拖拽——开车时不该去够它 */}
        <div className="mt-12 w-full max-w-3xl">
          <div className="h-[3px] w-full bg-hair">
            <div
              className="h-full bg-primary transition-[width] duration-500"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
          <div className="font-num mt-3 flex justify-between text-[15px] text-ink-faint">
            <span>{formatDuration(currentTime)}</span>
            <span>{formatDuration(duration)}</span>
          </div>
        </div>
      </div>

      {/*
        控制区：主键 112（窄屏）/ 128，副键 80 / 96。
        最小的那一档也是 44pt 下限的近两倍，而三个键加间距在 375px 上仍排得开——
        按钮被屏幕切掉，比按钮小更危险。
      */}
      <div className="flex items-center justify-center gap-4 pb-[max(2rem,env(safe-area-inset-bottom))] sm:gap-10">
        <CarButton
          label={t('player.previous')}
          onClick={() => (currentTime > 3 ? seekHowl(0) : prev())}
          className="h-20 w-20 sm:h-24 sm:w-24"
        >
          <SkipBack size={38} weight="fill" />
        </CarButton>

        <CarButton
          label={isPlaying ? t('player.pause') : t('player.play')}
          onClick={togglePlay}
          className="h-28 w-28 sm:h-32 sm:w-32"
          primary
        >
          {isPlaying ? <Pause size={52} weight="fill" /> : <Play size={52} weight="fill" className="ml-2" />}
        </CarButton>

        <CarButton
          label={t('player.next')}
          onClick={next}
          className="h-20 w-20 sm:h-24 sm:w-24"
        >
          <SkipForward size={38} weight="fill" />
        </CarButton>
      </div>
    </div>
  )
}

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
      onClick={onClick}
      aria-label={label}
      className={cn(
        'grid flex-none place-items-center rounded-full border transition-transform duration-150 active:scale-95',
        primary
          ? 'border-primary bg-primary text-paper'
          : 'border-hair text-ink hover:border-ink',
        className
      )}
    >
      {children}
    </button>
  )
}
