/**
 * 卡片叠：横屏正在播放的那一叠大封面，像 iPhone 的多任务界面。
 *
 * 排法：从左往右一张压一张。焦点那张最大最亮，略偏右；左边是翻过去的，越往左露得越少、越小、
 * 越暗，最后叠在一起；右边那张盖在焦点上方、只露出一截，告诉你后面还有。
 * 位置 p 以「张」为单位、是连续的（可以停在两张之间），每一帧按 p 直接写 transform 和蒙版透明度，
 * 不经 React 渲染；只挂看得见的十来张，几百首的队列也不怕。
 *
 * 手感：按住就跟手，正在飞的卡片随时接得住；松手按速度往前「甩」——落点 = 当前位置 + 速度 × 0.45 秒，
 * 甩得越狠飞得越远；落点取整到最近的一张，用临界阻尼弹簧带着松手时的速度滑过去，到点停稳、不回弹。
 * 滚轮 / 触控板跟着滚，停下 140ms 后吸附。两头拉过头有橡皮筋。←→ / Home / End 一张张走，回车播放。
 * 点焦点那张 = 播放，点别的 = 把它挪到中间。卡片是扁平的：不旋转、不打光（DESIGN.md「不做拟物的 3D」）。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { useReducedMotion } from 'motion/react'
import { Play } from '@phosphor-icons/react'
import type { Song } from '@/api/types'
import { cn } from '@/lib/utils'
import { rubberBand } from '@/lib/motion'
import { useT } from '@/i18n'
import { useCoverUrl } from '@/hooks/useCoverUrl'
import { CoverImage } from '@/components/common/CoverImage'
import { isDiscreteWheel } from '@/hooks/useWheelInertia'

export interface StackCard {
  key: string
  title: string
  subtitle?: string
  /** 歌曲封面走 useCoverUrl（自定义封面、失败兜底都在里面）；其它直接给地址 */
  song?: Song
  url?: string
  /** 正在放的就是它（角标「正在播放」） */
  current?: boolean
}

/* ------------------------------------------------------------------ 几何与物理（纯函数，有测试） */

/** 卡片边长、焦点那张的左边缘、竖直位置、拖多远算一张 */
export function stackGeometry(width: number, height: number) {
  const size = Math.round(Math.max(140, Math.min(height * 0.86, width * 0.4, 620)))
  return {
    size,
    // 焦点略偏右：左边要留地方给翻过去的那一叠
    left: Math.round((width - size) / 2 + size * 0.2),
    top: Math.round(Math.max(0, (height - size) / 2)),
    unit: size * 0.62,
  }
}

/** 离焦点 u 张（负数在左）的那张：左边缘的横向位置（以边长为单位）、缩放、蒙版透明度 */
export function cardPose(u: number): { x: number; scale: number; dim: number } {
  // 左边：越往左挪得越少，最后叠在 0.85 个边长处；右边：先慢后快，第二张已经出了屏幕。
  // 两段在 0 处的斜率都是 0.4，拖动经过焦点时速度不跳
  const SPEED = 0.4
  const LEFT_MAX = 0.85
  const NEXT = 1.08
  let x: number
  if (u < 0) x = -LEFT_MAX * (1 - Math.exp((SPEED * u) / LEFT_MAX))
  else if (u <= 1) x = SPEED * u + (NEXT - SPEED) * u * u
  else x = NEXT + (SPEED + 2 * (NEXT - SPEED)) * (u - 1)
  const scale = u < 0 ? 1 - 0.18 * (1 - Math.exp(0.35 * u)) : 1
  const dim = u < 0 ? Math.min(0.62, -u * 0.2) : Math.min(0.35, u * 0.3)
  return { x, scale, dim }
}

/** 松手时往哪一张落：当前位置 + 速度 × 0.45 秒，取整、夹在两头之间 */
export function flingTarget(position: number, velocity: number, count: number): number {
  const v = Math.max(-45, Math.min(45, velocity))
  const projected = Math.abs(v) < 0.25 ? position : position + v * 0.45
  return Math.max(0, Math.min(count - 1, Math.round(projected)))
}

/**
 * 弹簧的角频率：带着速度 v 滑到 distance 之外。ω ≤ 2|v|/|d| 时一开始就是减速、而且不会冲过头；
 * 慢慢松手（几乎没速度）就用一根硬一点的弹簧，干脆地吸过去
 */
export function springOmega(distance: number, velocity: number): number {
  if (Math.abs(velocity) < 0.6) return 11
  // 速度背离目标（往回甩、或者拉过头了）：硬弹簧收回来
  if (distance * velocity < 0) return 13
  // 下限：只挪一两张时干脆一点（0.5 秒内到位）；甩很远时软一点，让它滑够距离再停
  const floor = Math.abs(distance) <= 1.5 ? 8 : 5.5
  return Math.max(floor, Math.min(13, (2 * Math.abs(velocity)) / Math.max(Math.abs(distance), 0.05)))
}

/* ------------------------------------------------------------------ 卡面 */

function SongArt({ song }: { song: Song }) {
  const { primary, fallback } = useCoverUrl(song, { size: 640 })
  return <CoverImage primary={primary} fallback={fallback} alt="" className="h-full w-full" eager songId={song.id} />
}

function CardArt({ card }: { card: StackCard }) {
  if (card.song) return <SongArt song={card.song} />
  return <CoverImage primary={card.url} alt="" className="h-full w-full" eager />
}

/* ------------------------------------------------------------------ 卡片叠 */

const RUBBER = 0.35
/** 左边挂几张、右边挂几张（再远的被盖住或者出了屏幕） */
const MOUNT_LEFT = 7
const MOUNT_RIGHT = 3

export function CardStack({
  cards,
  initial,
  focusTo,
  onFocus,
  onActivate,
  label,
  className,
}: {
  cards: StackCard[]
  /** 挂上时停在哪一张 */
  initial: number
  /** 外面要它挪到某一张（比如换歌了）：token 变了才算一次新的请求；instant = 直接到位不飞（卡片自己换了位置时） */
  focusTo?: { index: number; token: number; instant?: boolean }
  onFocus: (index: number) => void
  onActivate: (index: number) => void
  label: string
  className?: string
}) {
  const { t } = useT()
  const reduce = useReducedMotion()
  const n = cards.length
  const rootRef = useRef<HTMLDivElement>(null)
  const nodes = useRef(new Map<number, HTMLDivElement>())
  const [box, setBox] = useState({ w: 0, h: 0 })
  const geo = stackGeometry(box.w, box.h)
  const geoRef = useRef(geo)
  geoRef.current = geo
  const nRef = useRef(n)
  nRef.current = n

  const pRef = useRef(Math.max(0, Math.min(n - 1, initial)))
  /** 正在跑的弹簧（0 = 静止） */
  const rafRef = useRef(0)
  const [focus, setFocus] = useState(() => Math.round(pRef.current))
  const focusRef = useRef(focus)
  const onFocusRef = useRef(onFocus)
  onFocusRef.current = onFocus
  const [range, setRange] = useState<[number, number]>(() => [focus - MOUNT_LEFT, focus + MOUNT_RIGHT])

  // 挂上时停在哪张也要告诉外面一声：数据晚到时外面的说明文字还停在第 0 张
  useLayoutEffect(() => {
    onFocusRef.current(focusRef.current)
  }, [])

  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const measure = () => setBox(b => (b.w === el.clientWidth && b.h === el.clientHeight ? b : { w: el.clientWidth, h: el.clientHeight }))
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    measure()
    return () => ro.disconnect()
  }, [])

  /** 按 p 画一帧：每张卡的位置、缩放、压暗；焦点变了才回到 React */
  const paint = useCallback(() => {
    const p = pRef.current
    const { size, left } = geoRef.current
    for (const [i, node] of nodes.current) {
      const pose = cardPose(i - p)
      node.style.transform = `translate3d(${left + pose.x * size}px, 0, 0) scale(${pose.scale})`
      const veil = node.lastElementChild as HTMLElement | null
      if (veil) veil.style.opacity = String(pose.dim)
    }
    const f = Math.max(0, Math.min(nRef.current - 1, Math.round(p)))
    if (f !== focusRef.current) {
      for (const [i, node] of nodes.current) {
        if (i === f) node.setAttribute('data-focus', '')
        else node.removeAttribute('data-focus')
      }
      focusRef.current = f
      setFocus(f)
      onFocusRef.current(f)
      setRange(r => (r[0] === f - MOUNT_LEFT && r[1] === f + MOUNT_RIGHT ? r : [f - MOUNT_LEFT, f + MOUNT_RIGHT]))
    }
  }, [])

  const setP = useCallback((p: number) => {
    pRef.current = p
    paint()
  }, [paint])

  // 每次渲染后当帧补画：尺寸变了、挂上了新的几张、卡片换了一批（数量不变也算）——新节点要马上有位置。最多十来张，很便宜
  useLayoutEffect(() => {
    if (!rafRef.current) pRef.current = Math.max(0, Math.min(n - 1, pRef.current))
    paint()
  })

  /* ---------- 弹簧：临界阻尼，带着初速度滑到目标，到点停稳 ---------- */
  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = 0
  }, [])

  const springTo = useCallback((target: number, velocity: number) => {
    stop()
    const T = Math.max(0, Math.min(nRef.current - 1, target))
    const A = pRef.current - T
    if (reduce || (Math.abs(A) < 1e-4 && Math.abs(velocity) < 1e-3)) {
      setP(T)
      return
    }
    const omega = springOmega(-A, velocity)
    const B = velocity + omega * A
    const t0 = performance.now()
    const step = (now: number) => {
      const s = (now - t0) / 1000
      const e = Math.exp(-omega * s)
      const x = T + (A + B * s) * e
      const v = (B - omega * (A + B * s)) * e
      // 飞的途中卡片变少了（推荐刷新、队列被删）：目标出界，带着当前速度改道到最后一张
      if (T > nRef.current - 1) {
        pRef.current = x
        springTo(nRef.current - 1, v)
        return
      }
      if (Math.abs(x - T) < 5e-4 && Math.abs(v) < 5e-3) {
        rafRef.current = 0
        setP(T)
        return
      }
      setP(x)
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
  }, [reduce, setP, stop])

  useEffect(() => stop, [stop])

  // 外面要它挪过去（换歌了）：正拖着就不抢
  const dragRef = useRef<null | {
    id: number
    x: number
    p: number
    moved: boolean
    /** 按下那一刻叠还在飞：这一下是「接住」，不是点 */
    caught: boolean
    card: number | null
    samples: Array<{ t: number; x: number }>
  }>(null)
  const lastToken = useRef(focusTo?.token)
  useEffect(() => {
    if (!focusTo || focusTo.token === lastToken.current) return
    lastToken.current = focusTo.token
    if (dragRef.current) return
    if (focusTo.instant) {
      stop()
      setP(Math.max(0, Math.min(nRef.current - 1, focusTo.index)))
    } else springTo(focusTo.index, 0)
  }, [focusTo, springTo, setP, stop])

  /** 拖过两头：橡皮筋，最多再多出 0.35 张 */
  const bounded = (raw: number) => {
    const last = nRef.current - 1
    if (raw < 0) return -rubberBand(-raw, RUBBER)
    if (raw > last) return last + rubberBand(raw - last, RUBBER)
    return raw
  }

  /* ---------- 手指 / 鼠标 ---------- */
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const caught = rafRef.current !== 0
    stop()
    const hit = (e.target as HTMLElement).closest<HTMLElement>('[data-card-index]')
    dragRef.current = {
      id: e.pointerId,
      x: e.clientX,
      p: pRef.current,
      moved: false,
      caught,
      card: hit ? Number(hit.dataset.cardIndex) : null,
      samples: [{ t: performance.now(), x: e.clientX }],
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d || d.id !== e.pointerId) return
    const dx = e.clientX - d.x
    if (!d.moved && Math.abs(dx) < 6) return
    d.moved = true
    const now = performance.now()
    d.samples.push({ t: now, x: e.clientX })
    while (d.samples.length > 2 && now - d.samples[0].t > 100) d.samples.shift()
    setP(bounded(d.p - dx / geoRef.current.unit))
  }

  const release = (e: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const d = dragRef.current
    if (!d || d.id !== e.pointerId) return
    dragRef.current = null
    if (!d.moved) {
      if (cancelled || d.caught || d.card === null) {
        springTo(Math.round(pRef.current), 0)
        return
      }
      // 轻点：焦点那张 = 播放；别的 = 挪到中间
      if (d.card === focusRef.current && Math.abs(pRef.current - d.card) < 0.3) {
        springTo(d.card, 0)
        onActivate(d.card)
      } else {
        springTo(d.card, 0)
      }
      return
    }
    // 速度：最后 100ms 的位移；松手前手指停住了（最后一个采样太旧）就是 0
    const now = performance.now()
    const first = d.samples[0]
    const last = d.samples[d.samples.length - 1]
    const pxPerSec = now - last.t > 60 || last.t === first.t ? 0 : ((last.x - first.x) / (last.t - first.t)) * 1000
    const velocity = -pxPerSec / geoRef.current.unit
    springTo(flingTarget(pRef.current, velocity, nRef.current), velocity)
  }

  /* ---------- 滚轮 / 触控板 ---------- */
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    let timer: ReturnType<typeof setTimeout> | null = null
    let notchTarget: number | null = null
    let notchAt = 0
    /** 最近见过精细滚动（触控板）：这一串里偶尔「像一格」的事件也按触控板处理（和 useWheelInertia 同一道保险） */
    let preciseUntil = 0
    const onWheel = (e: WheelEvent) => {
      const delta = Math.abs(e.deltaX) >= Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      if (!delta) return
      e.preventDefault()
      // 一格一格的鼠标滚轮：每一格走一张。按像素算的话一格只有 0.3 张，停下来又吸回原处，像没滚动
      const discrete = isDiscreteWheel(e)
      if (!discrete) preciseUntil = e.timeStamp + 400
      if (discrete && e.timeStamp >= preciseUntil) {
        const now = performance.now()
        const base = notchTarget !== null && now - notchAt < 400 ? notchTarget : focusRef.current
        notchTarget = Math.max(0, Math.min(nRef.current - 1, base + Math.sign(delta)))
        notchAt = now
        springTo(notchTarget, 0)
        return
      }
      notchTarget = null
      stop()
      const scale = e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? el.clientWidth : 1
      setP(bounded(pRef.current + (delta * scale) / geoRef.current.unit))
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => springTo(Math.round(pRef.current), 0), 140)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
      if (timer) clearTimeout(timer)
    }
    // bounded 只读 ref，不进依赖
  }, [setP, springTo, stop])

  /* ---------- 键盘 ---------- */
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const f = focusRef.current
    if (e.key === 'ArrowRight') { e.preventDefault(); springTo(f + 1, 0) }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); springTo(f - 1, 0) }
    else if (e.key === 'Home') { e.preventDefault(); springTo(0, 0) }
    else if (e.key === 'End') { e.preventDefault(); springTo(n - 1, 0) }
    else if (e.key === 'Enter') { e.preventDefault(); onActivate(f) }
  }

  const items: number[] = []
  for (let i = Math.max(0, range[0]); i < Math.min(n, range[1] + 1); i++) items.push(i)

  return (
    <div
      ref={rootRef}
      role="listbox"
      aria-label={label}
      aria-activedescendant={n ? `cs-card-${focus}` : undefined}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={e => release(e, false)}
      onPointerCancel={e => release(e, true)}
      className={cn('card-stack relative min-h-0 w-full touch-none select-none overflow-hidden', className)}
    >
      {items.map(i => {
        const c = cards[i]
        return (
          <div
            key={c.key}
            id={`cs-card-${i}`}
            role="option"
            aria-selected={i === focus}
            aria-setsize={n}
            aria-posinset={i + 1}
            aria-label={c.subtitle ? `${c.title}, ${c.subtitle}` : c.title}
            data-card-index={i}
            data-focus={i === focus ? '' : undefined}
            ref={node => {
              if (node) nodes.current.set(i, node)
              else nodes.current.delete(i)
            }}
            className="absolute left-0 origin-left will-change-transform"
            style={{ top: geo.top, width: geo.size, height: geo.size, zIndex: 100 + i }}
          >
            {/* 图片不接指针：鼠标按住图片一拖会变成浏览器在拖拽图片（整次拖动被取消）；iPad 长按也不弹「存储图像」 */}
            <div className="cover-frame card-stack-shadow h-full w-full cursor-pointer [&_img]:pointer-events-none">
              <CardArt card={c} />
              {c.current ? (
                <span className="absolute left-3 top-3 rounded-pill bg-stage-deep/70 px-2.5 py-1 text-[12px] font-semibold text-ink">
                  {t('player.nowPlaying')}
                </span>
              ) : (
                // 焦点那张右下角一枚青柠播放键：告诉你「点它就放」。只在焦点上出现（CSS 看 data-focus），换焦点时淡入
                <span aria-hidden="true" className="card-play absolute bottom-3 right-3 grid h-12 w-12 place-items-center rounded-pill bg-lime text-lime-ink shadow-lg">
                  <Play size={22} weight="fill" />
                </span>
              )}
            </div>
            {/* 压暗：一层深色蒙版的透明度，比 filter 便宜；离焦点越远越暗 */}
            <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[var(--r-cover)] bg-stage-deep opacity-0" />
          </div>
        )
      })}
    </div>
  )
}
