/**
 * 正在播放页的封面：只有正在放的这一张。
 *
 *   左甩：下一首；右甩：上一首。位移超过宽度的 26% 或速度超过 700 才算，没甩够就弹回去。
 *   切歌时旧封面顺着方向离场：下一首是它往左飞走、新封面在原位从小一档长出来；
 *   上一首是上一张从左边飞回来、旧的在原位缩回去。按钮切歌、自动播完也走这一套（方向读 lib/skipDirection）。
 *
 * v6 时这里是一叠牌，后面露着接下来的两张；v1.15.0 拿掉了——挑下一首去卡片浏览（CoverBrowser）。
 * 只动 transform / opacity。
 */
import { useMemo, useRef } from 'react'
import type { CSSProperties } from 'react'
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react'
import type { PanInfo } from 'motion/react'
import type { Song } from '@/api/types'
import { cn } from '@/lib/utils'
import { haptic } from '@/lib/haptics'
import { SPRING_SMOOTH, SPRING_SNAPPY } from '@/lib/motion'
import { markSkip, skipDirection } from '@/lib/skipDirection'
import { useCoverUrl } from '@/hooks/useCoverUrl'
import { CoverImage } from '@/components/common/CoverImage'

const songKey = (s: Song) => `${s.serverId}:${s.id}`

/** d > 0：下一首（含按钮与自动播完）；d < 0：上一首 */
const variants = {
  enter: (d: number) =>
    d < 0
      ? { x: '-115%', rotate: -12, scale: 1, opacity: 0 }
      : { x: 0, rotate: 0, scale: 0.9, opacity: 0 },
  pose: { x: 0, rotate: 0, scale: 1, opacity: 1 },
  exit: (d: number) =>
    d > 0
      ? { x: '-125%', rotate: -16, opacity: 0, transition: { ...SPRING_SMOOTH, opacity: { duration: 0.35 } } }
      : { scale: 0.9, opacity: 0 },
}

/** 能甩的那一张。拖动的位移每张各管各的：新封面不该接着上一张松手时的位置往回弹 */
function SwipeCover({
  song,
  round,
  playing,
  reduce,
  onDragEnd,
}: {
  song: Song
  round: boolean
  playing: boolean
  reduce: boolean
  onDragEnd: (_: unknown, info: PanInfo) => void
}) {
  const { primary, fallback } = useCoverUrl(song, { size: 640 })
  const dragX = useMotionValue(0)
  const rotate = useTransform(dragX, v => v / 22)
  return (
    <motion.div
      drag={reduce ? false : 'x'}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.85}
      dragMomentum={false}
      onDragEnd={onDragEnd}
      whileTap={reduce ? undefined : { scale: 0.985 }}
      style={{ x: dragX, rotate }}
      // 图片不接指针：鼠标按住图片一拖，浏览器会开始原生的「拖拽图片」，把这次甩动整个取消掉；
      // iPad 上长按图片也不会弹出「存储图像」的系统菜单
      className={cn('cover-frame h-full w-full cursor-grab touch-pan-y shadow-cover active:cursor-grabbing [&_img]:pointer-events-none', round && 'rounded-full')}
    >
      {/* 圆形封面跟着播放转、暂停就停；转动放在里层，不和拖动的 transform 打架 */}
      <div
        className={cn('h-full w-full', round && 'animate-spin-vinyl rounded-full')}
        style={round ? { animationPlayState: playing ? 'running' : 'paused' } : undefined}
      >
        <CoverImage
          primary={primary}
          fallback={fallback}
          alt={song.album}
          className={cn('h-full w-full', round && 'rounded-full')}
          eager
          songId={song.id}
          customCoverParams={{ type: 'song', title: song.title, artist: song.artist, album: song.album, path: song.path }}
        />
      </div>
    </motion.div>
  )
}

export function CurrentCover({
  current,
  onNext,
  onPrev,
  playing,
  round = false,
  className,
  style,
  boxRef,
}: {
  current: Song
  onNext: () => void
  onPrev: () => void
  playing: boolean
  round?: boolean
  className?: string
  style?: CSSProperties
  /** 封面所在的那块地方（不随切歌重新挂载）：光场扩散的原点 */
  boxRef?: React.Ref<HTMLDivElement>
}) {
  const reduce = !!useReducedMotion()
  const sizeRef = useRef<HTMLDivElement>(null)

  const currentKey = songKey(current)
  const direction = useMemo(() => (currentKey ? skipDirection() : 1), [currentKey])

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const w = sizeRef.current?.clientWidth ?? 300
    const dx = info.offset.x
    const vx = info.velocity.x
    if (Math.abs(dx) > w * 0.26 || Math.abs(vx) > 700) {
      haptic('light')
      if (dx < 0) {
        markSkip(1)
        onNext()
      } else {
        markSkip(-1)
        onPrev()
      }
    }
  }

  return (
    <div ref={boxRef} className={cn('relative aspect-square flex-none', className)} style={style}>
      <div ref={sizeRef} className="absolute inset-0">
        <AnimatePresence initial={false} custom={direction}>
          <motion.div
            key={currentKey}
            custom={direction}
            variants={variants}
            initial={reduce ? false : 'enter'}
            animate="pose"
            exit={reduce ? undefined : 'exit'}
            transition={SPRING_SNAPPY}
            className="absolute inset-0"
          >
            <SwipeCover song={current} round={round} playing={playing} reduce={reduce} onDragEnd={onDragEnd} />
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
