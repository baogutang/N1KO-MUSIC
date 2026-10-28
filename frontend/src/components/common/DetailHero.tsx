/**
 * 详情页的沉浸式头部（专辑、歌单、歌手、榜单、单曲共用）。
 *
 * - 光：头部底下铺一片这张封面自己的光（ArtWash 固定调色板），离你看的东西最近的那张唱片照亮这一块。
 * - 共享元素：从卡片点进来时，大封面从卡片原来的位置飞过来（lib/sharedCover），
 *   落地前先垫上卡片那张已经加载好的小图，不闪白。
 * - 滚动联动：往下滚，大封面缩小、变淡，文字一起往上收一点；光也跟着退下去。
 *   只动 transform / opacity，由 motion 的滚动值直接写样式，不触发 React 重渲染。
 *
 * 版式：窄窗口封面在上、文字在下（居中）；宽一些的窗口左封面右文字，文字贴底对齐。
 * 大标题是 Geologica；元信息是独立的 span（不用中点串），由调用方给。
 */
import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { animate, motion, useReducedMotion, useScroll, useTransform } from 'motion/react'
import { cn } from '@/lib/utils'
import { SPRING_MORPH } from '@/lib/motion'
import { takeCoverOrigin } from '@/lib/sharedCover'
import { useCoverPalette } from '@/hooks/useCoverPalette'
import { useScrollContainer } from '@/components/layout/scrollContainer'
import { ArtWash } from '@/components/art/ArtWash'

export function DetailHero({
  cover,
  coverUrl,
  round = false,
  title,
  subtitle,
  meta,
  actions,
  className,
}: {
  /** 封面元素（ImageWithFallback / CoverImage），铺满封面框 */
  cover: ReactNode
  /** 取色用的封面地址（与 cover 里那张同一张，尺寸可以小） */
  coverUrl?: string
  /** 歌手：圆形头像 */
  round?: boolean
  title: ReactNode
  /** 标题下面一行：歌手链接、创建者 */
  subtitle?: ReactNode
  /** 元信息：若干独立 span，自动换行 */
  meta?: ReactNode
  /** 动作行：一个青柠主键 + 次要键 */
  actions?: ReactNode
  className?: string
}) {
  const reduce = useReducedMotion()
  const palette = useCoverPalette(coverUrl)
  const container = useScrollContainer()
  const { scrollY } = useScroll(container ? { container } : undefined)
  const coverScale = useTransform(scrollY, [0, 320], [1, 0.84], { clamp: true })
  const coverOpacity = useTransform(scrollY, [0, 320], [1, 0.35], { clamp: true })
  const textY = useTransform(scrollY, [0, 320], [0, -24], { clamp: true })
  const washOpacity = useTransform(scrollY, [0, 420], [1, 0.25], { clamp: true })

  // 从卡片飞过来：挂载那一帧先摆到卡片的位置，再弹回自己的位置
  const coverRef = useRef<HTMLDivElement>(null)
  const [underlay, setUnderlay] = useState<string | undefined>()
  useLayoutEffect(() => {
    const origin = takeCoverOrigin()
    const el = coverRef.current
    if (!origin || !el || reduce) return
    const target = el.getBoundingClientRect()
    if (target.width < 8) return
    setUnderlay(origin.src)
    const dx = origin.rect.left + origin.rect.width / 2 - (target.left + target.width / 2)
    const dy = origin.rect.top + origin.rect.height / 2 - (target.top + target.height / 2)
    animate(el, { x: [dx, 0], y: [dy, 0], scale: [origin.rect.width / target.width, 1] }, SPRING_MORPH)
  }, [reduce])

  return (
    <header className={cn('relative isolate pb-2 pt-2 regular:pt-4', className)}>
      {/* 这张封面自己的光：铺得比头部宽，左右出血到页面边缘 */}
      <motion.div
        aria-hidden="true"
        style={reduce ? undefined : { opacity: washOpacity }}
        className="pointer-events-none absolute -inset-x-8 -top-24 bottom-[-30%] -z-10 [mask-image:linear-gradient(to_bottom,black_55%,transparent)]"
      >
        {palette && <ArtWash palette={palette} className="absolute inset-0" />}
      </motion.div>

      <div className="grid grid-cols-1 items-end justify-items-center gap-6 regular:grid-cols-[220px_minmax(0,1fr)] regular:justify-items-start regular:gap-8 wide:grid-cols-[264px_minmax(0,1fr)] wide:gap-10">
        <motion.div
          style={reduce ? undefined : { scale: coverScale, opacity: coverOpacity }}
          className="w-[min(72vw,280px)] origin-bottom regular:w-full"
        >
          <div
            ref={coverRef}
            className={cn(
              'cover-frame aspect-square w-full shadow-cover',
              round && 'rounded-full'
            )}
          >
            {underlay && (
              <img src={underlay} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover" />
            )}
            <div className="relative h-full w-full">{cover}</div>
          </div>
        </motion.div>

        <motion.div
          style={reduce ? undefined : { y: textY }}
          className="flex w-full min-w-0 flex-col items-center gap-3 text-center regular:items-start regular:text-left"
        >
          <h1 className="w-full font-display text-[32px] font-bold leading-[1.04] tracking-[-0.035em] text-ink [overflow-wrap:break-word] regular:text-[44px] wide:text-[56px]">
            {title}
          </h1>
          {subtitle && <div className="min-w-0 text-[17px] font-semibold text-leaf">{subtitle}</div>}
          {meta && (
            <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-[14px] font-medium text-ink-3 regular:justify-start [&>*]:num">
              {meta}
            </div>
          )}
          {actions && <div className="mt-2 flex flex-wrap items-center justify-center gap-3 regular:justify-start">{actions}</div>}
        </motion.div>
      </div>
    </header>
  )
}
