/**
 * 卡片叠：横屏正在播放的那一叠大封面，像 iPhone 的多任务界面（左右镜像过来）。
 *
 * 排法：焦点那张最大最亮、略偏左；后面的叠在它右边、压在它底下，越往后露得越少、越小、越暗，
 * 最后叠在一起；前一张在左边、压在它上面，露出一截，告诉你从哪儿来。
 *
 * 为什么是后面的叠在右边：手指底下那张要一直跟着手指走。卡片叠的两侧不一样快——散开的那侧匀速，
 * 叠着的那侧越往里挪得越少。拖动按散开那侧的间距换算（拖一个间距 = 一张），所以只有往散开那侧走的卡
 * 和手指一样快。最常用的一划是「下一张」：焦点那张往左走（散开的那侧，跟手），下一张从叠里抽出来。
 * v1.16.0 是叠在左边、下一张从右边进来，「下一张」就成了把手里那张往叠里压：卡只走手指一半的路、
 * 右边那张却比手指快一倍多，怎么调都不跟手。iPhone 上最常用的一划（往回翻）也是把卡从叠里抽出来。
 *
 * 位置 p 以「张」为单位、是连续的（可以停在两张之间），每一帧按 p 直接写 transform、蒙版透明度、
 * 焦点和 aria 属性，不经 React 渲染；焦点变了才把说明文字、挂哪几张交给 React（startTransition，
 * 不和这一帧抢时间）。只挂看得见的十来张，几百首的队列也不怕。
 *
 * 手感：按住就跟手，正在飞的卡片随时接得住；松手按速度往前「甩」——落点 = 当前位置 + 速度 × 0.5 秒，
 * 甩得越狠飞得越远，轻轻一扫也至少翻一张；落点取整到最近的一张，用临界阻尼弹簧带着松手时的速度滑过去，
 * 到点停稳、不回弹。滚轮 / 触控板跟着滚，停下 140ms 后吸附。两头拉过头有橡皮筋。
 * ←→ / Home / End 一张张走，回车播放。点焦点那张 = 播放，点别的 = 把它挪到中间。
 * 卡片是扁平的：不旋转、不打光（DESIGN.md「不做拟物的 3D」）。
 */
import { startTransition, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
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

/** 左边（前面的）相邻两张的间距，以边长为单位：比 1 大一点，前一张不挡住焦点那张 */
const SPREAD = 1.08
// 右边那一叠：x(u) = A(1 − e^(−αu)) + B(1 − e^(−βu))。四个数是解出来的：在 0 处斜率 = SPREAD
// （卡片经过焦点时速度不突变）、第一张露出 0.46 个边长、叠最深处停在 A + B = 0.9 个边长，
// 往后每一张露出的约是前一张的 0.6 倍（β）
const PILE_A = 0.17191
const PILE_ALPHA = 4.1223
const PILE_B = 0.72809
const PILE_BETA = 0.51
/** 松手速度低于它（张 / 秒）算没甩：就近吸附 */
const FLICK = 0.35
/** 落点 = 当前位置 + 速度 × 这么多秒（和 iOS 滚动减速到停走的路差不多） */
const PROJECT = 0.5

/** 卡片边长、焦点那张的左边缘、竖直位置、拖多远算一张 */
export function stackGeometry(width: number, height: number) {
  const size = Math.round(Math.max(140, Math.min(height * 0.86, width * 0.4, 620)))
  return {
    size,
    // 焦点略偏左：右边要留地方给后面那一叠
    left: Math.round((width - size) / 2 - size * 0.2),
    top: Math.round(Math.max(0, (height - size) / 2)),
    // 拖一个「左边的间距」算一张：焦点那张和左边那张与手指一样快
    unit: size * SPREAD,
  }
}

/** 离焦点 u 张（负数在左）的那张：横向位置（以边长为单位）、缩放（以右边缘为原点）、蒙版透明度 */
export function cardPose(u: number): { x: number; scale: number; dim: number } {
  // 左边：匀速散开，前一张压暗 30%，再往左已经出了屏幕
  if (u < 0) return { x: SPREAD * u, scale: 1, dim: Math.min(0.35, -u * 0.3) }
  // 右边：叠起来，越往后挪得越少、越小（最多缩到 0.82）、越暗
  const x = PILE_A * (1 - Math.exp(-PILE_ALPHA * u)) + PILE_B * (1 - Math.exp(-PILE_BETA * u))
  return { x, scale: 1 - 0.18 * (1 - Math.exp(-0.35 * u)), dim: Math.min(0.55, u * 0.16) }
}

/**
 * 松手时往哪一张落：当前位置 + 速度 × 0.5 秒，取整、夹在两头之间。
 * 甩了（速度过了 FLICK）就至少翻到甩的方向上的下一张——离某一张不到 0.15 张算已经在它上面，
 * 和系统的分页一样：轻轻一扫不会又吸回原处
 */
export function flingTarget(position: number, velocity: number, count: number): number {
  const v = Math.max(-40, Math.min(40, velocity))
  let target = Math.round(position)
  if (Math.abs(v) >= FLICK) {
    target = Math.round(position + v * PROJECT)
    target = v > 0
      ? Math.max(target, Math.floor(position + 0.15) + 1)
      : Math.min(target, Math.ceil(position - 0.15) - 1)
  }
  return Math.max(0, Math.min(count - 1, target))
}

/**
 * 弹簧的角频率：带着速度 v 滑到 distance 之外。临界阻尼弹簧 x(t) = T + (A + Bt)e^(−ωt)：
 * ω ≥ |v|/|d| 不冲过头；ω ≤ 2|v|/|d| 一开始就是减速。取 2.5|v|/|d|——松手后最多快出 7.5%，换来收得利落。
 * 下限：只挪一两张时干脆一点（0.8 秒内到位）；甩很远时软一点，让它滑够距离再停。
 * 没甩（几乎没速度）用一根硬一点的弹簧干脆吸过去；速度背离目标（拉过头了）用最硬的收回来
 */
export function springOmega(distance: number, velocity: number): number {
  if (Math.abs(velocity) < FLICK) return 11
  if (distance * velocity < 0) return 13
  const floor = Math.abs(distance) <= 1.5 ? 8 : 5
  return Math.max(floor, Math.min(13, (2.5 * Math.abs(velocity)) / Math.max(Math.abs(distance), 0.05)))
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
/** 左边挂几张、右边挂几张（左边第二张已经出了屏幕，右边第八张只露几个像素） */
const MOUNT_LEFT = 3
const MOUNT_RIGHT = 8

interface Spring {
  T: number
  A: number
  B: number
  omega: number
  t0: number
}

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
  const springRef = useRef<Spring | null>(null)
  /** 焦点那张：只在这里（paint）改，DOM 上的 data-focus / aria-selected / aria-activedescendant 跟着它 */
  const focusRef = useRef(Math.round(pRef.current))
  const onFocusRef = useRef(onFocus)
  onFocusRef.current = onFocus
  const [range, setRange] = useState<[number, number]>(() => [focusRef.current - MOUNT_LEFT, focusRef.current + MOUNT_RIGHT])

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

  /** 按 p 画一帧：每张卡的位置、缩放、压暗、是不是焦点；焦点变了才回到 React */
  const paint = useCallback(() => {
    const p = pRef.current
    const { size, left } = geoRef.current
    const f = Math.max(0, Math.min(nRef.current - 1, Math.round(p)))
    for (const [i, node] of nodes.current) {
      const pose = cardPose(i - p)
      node.style.transform = `translate3d(${left + pose.x * size}px, 0, 0) scale(${pose.scale})`
      const veil = node.lastElementChild as HTMLElement | null
      if (veil) veil.style.opacity = String(pose.dim)
      // 只在变了的时候碰属性：每帧重写同样的值也会让 WebKit 重算样式
      const on = i === f
      if (node.hasAttribute('data-focus') !== on) {
        node.toggleAttribute('data-focus', on)
        node.setAttribute('aria-selected', String(on))
      }
    }
    if (f !== focusRef.current) {
      focusRef.current = f
      rootRef.current?.setAttribute('aria-activedescendant', `cs-card-${f}`)
      // 说明文字、挂哪几张：交给 React 慢慢来，不和这一帧抢
      startTransition(() => {
        onFocusRef.current(f)
        setRange(r => (r[0] === f - MOUNT_LEFT && r[1] === f + MOUNT_RIGHT ? r : [f - MOUNT_LEFT, f + MOUNT_RIGHT]))
      })
    }
  }, [])

  const setP = useCallback((p: number) => {
    pRef.current = p
    paint()
  }, [paint])

  // 每次渲染后当帧补画：尺寸变了、挂上了新的几张、卡片换了一批（数量不变也算）——新节点要马上有位置和焦点。
  // 最多十来张，很便宜
  useLayoutEffect(() => {
    if (!rafRef.current) pRef.current = Math.max(0, Math.min(n - 1, pRef.current))
    paint()
    const root = rootRef.current
    const active = n ? `cs-card-${focusRef.current}` : null
    if (root && root.getAttribute('aria-activedescendant') !== active) {
      if (active) root.setAttribute('aria-activedescendant', active)
      else root.removeAttribute('aria-activedescendant')
    }
  })

  /* ---------- 弹簧：临界阻尼，带着初速度滑到目标，到点停稳 ---------- */
  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = 0
    springRef.current = null
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
    const s: Spring = { T, A, B: velocity + omega * A, omega, t0: performance.now() }
    springRef.current = s
    const step = (now: number) => {
      // 头一帧的时间戳可能早于松手那一刻：不往回算
      const t = Math.max(0, (now - s.t0) / 1000)
      const e = Math.exp(-omega * t)
      const x = T + (s.A + s.B * t) * e
      const v = (s.B - omega * (s.A + s.B * t)) * e
      // 飞的途中卡片变少了（推荐刷新、队列被删）：目标出界，带着当前速度改道到最后一张
      if (T > nRef.current - 1) {
        pRef.current = x
        springTo(nRef.current - 1, v)
        return
      }
      if (Math.abs(x - T) < 5e-4 && Math.abs(v) < 5e-3) {
        rafRef.current = 0
        springRef.current = null
        setP(T)
        return
      }
      setP(x)
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
  }, [reduce, setP, stop])

  useEffect(() => stop, [stop])

  /**
   * 叠还飞得快吗（每秒超过 0.6 张）：这时按下去是「接住」，不是点。
   * 弹簧最后那一段走得很慢（一秒多才完全停住），慢下来以后点上去的就是你看见的那张，算点
   */
  const flying = () => {
    const s = springRef.current
    if (!rafRef.current || !s) return false
    const t = Math.max(0, (performance.now() - s.t0) / 1000)
    const v = (s.B - s.omega * (s.A + s.B * t)) * Math.exp(-s.omega * t)
    return Math.abs(v) > 0.6
  }

  // 外面要它挪过去（换歌了）：正拖着就不抢
  const dragRef = useRef<null | {
    id: number
    x: number
    p: number
    moved: boolean
    /** 按下那一刻叠还在飞：这一下是「接住」，不是点；接住了马上跟手，不等 6px */
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
    const caught = flying()
    // 按住就停在手指底下；松手时再吸到最近的一张（点了就放那张）
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
    // 指针这时可能已经不在了（系统收走了手势）：捕获失败也照样跟着 pointermove 走
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* 无妨 */ }
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d || d.id !== e.pointerId) return
    const dx = e.clientX - d.x
    if (!d.moved && !d.caught && Math.abs(dx) < 6) return
    d.moved = true
    const now = performance.now()
    d.samples.push({ t: now, x: e.clientX })
    while (d.samples.length > 2 && now - d.samples[0].t > 100) d.samples.shift()
    // 手指走一个「左边的间距」= 一张：焦点那张和左边的卡与手指同速
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
    const pxPerSec = cancelled || now - last.t > 60 || last.t === first.t ? 0 : ((last.x - first.x) / (last.t - first.t)) * 1000
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
      // 一格一格的鼠标滚轮：每一格走一张。按像素算的话一格只有零点几张，停下来又吸回原处，像没滚动
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
    // aria-activedescendant、每张的 aria-selected / data-focus 由 paint 直接维护（焦点一帧一变，不走 React）
    <div
      ref={rootRef}
      role="listbox"
      aria-label={label}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={e => release(e, false)}
      onPointerCancel={e => release(e, true)}
      className={cn('card-stack relative isolate min-h-0 w-full touch-none select-none overflow-hidden', className)}
    >
      {items.map(i => {
        const c = cards[i]
        return (
          <div
            key={c.key}
            id={`cs-card-${i}`}
            role="option"
            // 挂上时一律 false，之后焦点那张由 paint 改成 true；这里的值从不变，React 不会再写回去
            aria-selected={false}
            aria-setsize={n}
            aria-posinset={i + 1}
            aria-label={c.subtitle ? `${c.title}, ${c.subtitle}` : c.title}
            data-card-index={i}
            ref={node => {
              if (node) nodes.current.set(i, node)
              else nodes.current.delete(i)
            }}
            // 以右边缘为原点缩放：叠里的卡露出来的是右边那一截，缩了也贴着那一截
            className="absolute left-0 origin-right will-change-transform"
            // 左边的压在右边的上面：前一张盖住焦点，焦点盖住后面那一叠
            style={{ top: geo.top, width: geo.size, height: geo.size, zIndex: n - i }}
          >
            {/* 图片不接指针：鼠标按住图片一拖会变成浏览器在拖拽图片（整次拖动被取消）；iPad 长按也不弹「存储图像」 */}
            <div className="cover-frame card-stack-shadow h-full w-full cursor-pointer [&_img]:pointer-events-none">
              <CardArt card={c} />
              {c.current ? (
                // 右上角：叠里的卡露出来的是右边那一截，角标也得在那儿才看得见
                <span className="absolute right-3 top-3 rounded-pill bg-stage-deep/70 px-2.5 py-1 text-[12px] font-semibold text-ink">
                  {t('player.nowPlaying')}
                </span>
              ) : (
                // 焦点那张右下角一枚青柠播放键：告诉你「点它就放」。只在焦点上出现（CSS 看 data-focus），换焦点时淡入
                <span aria-hidden="true" className="card-play absolute bottom-3 right-3 grid h-12 w-12 place-items-center rounded-pill bg-lime text-lime-ink shadow-lg">
                  <Play size={22} weight="fill" />
                </span>
              )}
            </div>
            {/* 压暗：一层深色蒙版的透明度，比 filter 便宜；自己一层（.card-veil），每帧改透明度不用重画封面 */}
            <span aria-hidden="true" className="card-veil pointer-events-none absolute inset-0 rounded-[var(--r-cover)] bg-stage-deep opacity-0" />
          </div>
        )
      })}
    </div>
  )
}
