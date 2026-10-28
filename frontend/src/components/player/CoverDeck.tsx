/**
 * 队列是一叠牌（v6 全屏播放器的签名交互）。
 *
 * 最上面是正在放的这首，后面两张是接下来的歌，从顶上露出一条边。
 *   左甩：这张飞走，下一张升上来（下一首）；右甩：上一首从左边落回牌堆顶上。
 *   甩的时候后面那张跟着往前凑（联动）；没甩够就弹回去。
 *   点露出来的那两张：展开完整的「接下来」。
 * 按钮切歌、自动播完也走同一套动画（方向读 lib/skipDirection）。
 *
 * 牌按歌曲 key 复用 DOM：下一首那张本来就在牌堆里，切歌时它是「从第二张的位置弹到顶上」，
 * 而不是凭空出现。只动 transform / opacity。
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
import { findAdapterFor } from '@/api'
import { useCoverUrl } from '@/hooks/useCoverUrl'
import { CoverImage } from '@/components/common/CoverImage'
import { useT } from '@/i18n'

const songKey = (s: Song) => `${s.serverId}:${s.id}`

/** 三个深度的姿态：顶上一张、后面两张往上露边。后面的牌是实的、只是暗一档——
 *  半透明的牌会透出底下的光场，看起来像一块玻璃片，不像一叠牌 */
const POSES = [
  { y: '0%', scale: 1, opacity: 1, filter: 'brightness(1)' },
  { y: '-6.5%', scale: 0.92, opacity: 1, filter: 'brightness(0.7)' },
  { y: '-12%', scale: 0.84, opacity: 1, filter: 'brightness(0.5)' },
] as const

function TopCover({ song, round }: { song: Song; round: boolean }) {
  const { primary, fallback } = useCoverUrl(song, { size: 640 })
  return (
    <CoverImage
      key={song.id}
      primary={primary}
      fallback={fallback}
      alt={song.album}
      className={cn('h-full w-full', round && 'rounded-full')}
      eager
      songId={song.id}
      customCoverParams={{ type: 'song', title: song.title, artist: song.artist, album: song.album, path: song.path }}
    />
  )
}

function BackCover({ song }: { song: Song }) {
  const url = song.coverArt ? findAdapterFor(song.serverId)?.getCoverUrl(song.coverArt, 320) ?? undefined : undefined
  return <CoverImage primary={url} alt="" className="h-full w-full" eager />
}

export function CoverDeck({
  current,
  upcoming,
  onNext,
  onPrev,
  onOpenQueue,
  playing,
  round = false,
  className,
  style,
  topRef,
}: {
  current: Song
  upcoming: Song[]
  onNext: () => void
  onPrev: () => void
  onOpenQueue: () => void
  playing: boolean
  round?: boolean
  className?: string
  style?: CSSProperties
  /** 顶上那张封面：共享元素的落点、光场扩散的原点 */
  topRef?: React.Ref<HTMLDivElement>
}) {
  const { t } = useT()
  const reduce = useReducedMotion()
  const boxRef = useRef<HTMLDivElement>(null)
  const dragX = useMotionValue(0)
  // 甩顶上那张时，第二张往前凑：最多补回一半的距离
  const followScale = useTransform(dragX, v => 1 + Math.min(1, Math.abs(v) / 220) * 0.045)
  const followY = useTransform(dragX, v => `${Math.min(1, Math.abs(v) / 220) * 3}%`)
  const rotate = useTransform(dragX, v => v / 22)

  const cards = useMemo(() => [current, ...upcoming.slice(0, 2)], [current, upcoming])
  const currentKey = songKey(current)
  const direction = useMemo(() => (currentKey ? skipDirection() : 1), [currentKey])

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const w = boxRef.current?.clientWidth ?? 300
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
    <div
      ref={boxRef}
      className={cn('relative aspect-square flex-none', className)}
      style={style}
    >
      <AnimatePresence initial={false} custom={direction}>
        {cards.map((song, depth) => {
          const key = songKey(song)
          const pose = POSES[depth]
          const isTop = depth === 0
          // 每张牌带着自己的深度去退场：顶上那张按方向飞走，后面的只是淡出
          const variants = {
            enter: (d: number) =>
              isTop && d < 0
                ? { x: '-115%', rotate: -12, y: '0%', scale: 1, opacity: 0 }
                : { x: 0, y: '-16%', scale: 0.78, opacity: 0, filter: 'brightness(0.4)' },
            pose: { x: 0, rotate: 0, ...pose },
            exit: (d: number) =>
              isTop && d > 0
                ? { x: '-125%', rotate: -16, opacity: 0, transition: { ...SPRING_SMOOTH, opacity: { duration: 0.35 } } }
                : isTop
                  ? { y: '-6.5%', scale: 0.92, opacity: 0 }
                  : { y: '-16%', scale: 0.78, opacity: 0 },
          }
          return (
            <motion.div
              key={key}
              custom={direction}
              variants={variants}
              initial={reduce ? false : 'enter'}
              animate="pose"
              exit={reduce ? undefined : 'exit'}
              transition={SPRING_SNAPPY}
              className="absolute inset-0"
              style={{ zIndex: 3 - depth, transformOrigin: '50% 0%' }}
            >
              {isTop ? (
                <motion.div
                  ref={topRef}
                  data-np-target=""
                  drag={reduce ? false : 'x'}
                  dragConstraints={{ left: 0, right: 0 }}
                  dragElastic={0.85}
                  dragMomentum={false}
                  onDragEnd={onDragEnd}
                  whileTap={reduce ? undefined : { scale: 0.985 }}
                  style={{ x: dragX, rotate }}
                  className={cn(
                    'cover-frame h-full w-full cursor-grab touch-pan-y shadow-cover active:cursor-grabbing',
                    round && 'rounded-full'
                  )}
                >
                  {/* 圆形封面跟着播放转、暂停就停；转动放在里层，不和拖动的 transform 打架 */}
                  <div
                    className={cn('h-full w-full', round && 'animate-spin-vinyl rounded-full')}
                    style={round ? { animationPlayState: playing ? 'running' : 'paused' } : undefined}
                  >
                    <TopCover song={song} round={round} />
                  </div>
                </motion.div>
              ) : (
                <motion.button
                  type="button"
                  onClick={onOpenQueue}
                  aria-label={t('shell.upNext')}
                  tabIndex={depth === 1 ? 0 : -1}
                  style={depth === 1 ? { scale: followScale, y: followY } : undefined}
                  className="cover-frame block h-full w-full shadow-md"
                >
                  <BackCover song={song} />
                </motion.button>
              )}
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
