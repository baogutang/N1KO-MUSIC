/**
 * 开屏（v6）：每次打开 App 播一遍，约 2 秒，点一下或按任意键就跳过。一场小演出：
 *
 *   开灯  场灯的青柠与叶绿两团柔光从中心开出来；两束追光从左右上方扫进来，停在角色身上轻轻晃
 *   登场  糯米和毛豆从下面跳上来：起跳拉长、到顶、落地压扁再回弹，脚下扬起几团小烟尘
 *   演出  落地后跟着拍子蹦两下；毛豆耳机里飘出音符，糯米耳朵边闪两下小星光；最后两只一起眨一下眼
 *   字标  N1KO 一个字母一个字母地升起，底下一道青柠的线从左划到右
 *   收场  角色和字标朝镜头冲出去淡掉，中心随即开出一个洞，底下早已渲染好的 App 从洞里扩散出来
 *
 * 它不挡启动：App 在它底下照常挂载、加载；开屏只是盖在上面的一层，时间到了自己收走。
 * 同一次打开只播一遍（sessionStorage）；自动化环境（webdriver、测试）不播；
 * 减弱动态效果时只留一个很短的淡出（全局的 reduced-motion 兜底会把关键帧压成瞬时）。
 * 整块对读屏隐藏：它不承载任何信息。
 */
import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { MusicNote, MusicNotes, Sparkle } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { prefersReducedMotion } from '@/lib/motion'

const SEEN_KEY = 'n1ko-splash-seen'
const WORD = ['N', '1', 'K', 'O']

/**
 * 开发用：?splash-t=毫秒 把开屏定格在那一刻（逐帧检查编排），加 &splash-theme=dark 看深色；正式包里没有这段。
 * 在模块加载时就读：路由一挂上可能马上把网址换掉，等到 effect 里再读参数已经没了
 */
const DEV_QUERY = import.meta.env.DEV && typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
const FREEZE_AT = DEV_QUERY?.get('splash-t') ?? null
const FORCE_DARK = DEV_QUERY?.get('splash-theme') === 'dark'

/** 毛豆耳机里飘出的音符：起点（占图的百分比）、飘向（px）、大小 */
const NOTES = [
  { left: 80, top: 20, dx: 22, dy: -66, r: 14, size: 34, double: false },
  { left: 89, top: 30, dx: 34, dy: -46, r: 22, size: 26, double: true },
  { left: 71, top: 10, dx: -8, dy: -70, r: -10, size: 24, double: false },
  { left: 93, top: 18, dx: 30, dy: -78, r: 18, size: 30, double: true },
  { left: 76, top: 27, dx: 10, dy: -54, r: 8, size: 22, double: false },
]

/** 糯米耳朵边、举起的爪子边的小星光 */
const SPARKS = [
  { left: 8, top: 8, size: 28 },
  { left: 34, top: 3, size: 22 },
  { left: 2, top: 39, size: 20 },
]

/** 落地扬起的小烟尘：脚下的横向位置（%）和飞散方向（px） */
const PUFFS = [
  { left: 24, dx: -34 },
  { left: 40, dx: -14 },
  { left: 62, dx: 16 },
  { left: 80, dx: 36 },
]

function shouldShow(): boolean {
  if (typeof window === 'undefined') return false
  if (import.meta.env.MODE === 'test') return false
  if (navigator.webdriver) return false
  try {
    if (sessionStorage.getItem(SEEN_KEY)) return false
    sessionStorage.setItem(SEEN_KEY, '1')
  } catch {
    /* 私密模式拿不到 sessionStorage：照常播 */
  }
  return true
}

export function Splash() {
  const [phase, setPhase] = useState<'in' | 'out' | 'gone'>(() => (shouldShow() ? 'in' : 'gone'))

  useEffect(() => {
    if (FREEZE_AT === null || phase !== 'in') return
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(() => {
        if (FORCE_DARK) {
          // 等主题自己那一轮设置完再切，免得被它改回去
          document.documentElement.classList.add('dark')
          document.documentElement.setAttribute('data-theme', 'dark')
        }
        for (const a of document.getAnimations()) {
          a.pause()
          a.currentTime = Number(FREEZE_AT)
        }
      })
    })
    return () => cancelAnimationFrame(id)
  }, [phase])

  useEffect(() => {
    if (phase !== 'in' || FREEZE_AT !== null) return
    const timer = setTimeout(() => setPhase('out'), prefersReducedMotion() ? 320 : 2050)
    const skip = () => setPhase('out')
    window.addEventListener('keydown', skip, { once: true })
    return () => {
      clearTimeout(timer)
      window.removeEventListener('keydown', skip)
    }
  }, [phase])

  if (phase === 'gone') return null

  return (
    <div
      aria-hidden="true"
      className={cn('splash fixed inset-0 z-[200] grid select-none place-items-center overflow-hidden bg-ground', phase === 'out' && 'splash-out')}
      onPointerDown={() => setPhase('out')}
      onAnimationEnd={e => {
        if (phase === 'out' && e.target === e.currentTarget) setPhase('gone')
      }}
    >
      <div className="splash-light pointer-events-none absolute inset-0" />
      <div className="splash-beam splash-beam-l pointer-events-none absolute" />
      <div className="splash-beam splash-beam-r pointer-events-none absolute" />

      <div className="splash-stage relative flex flex-col items-center">
        {/* 宽度按合影原图的宽高比（960×896 ≈ 1.07）卡住高度：矮屏上整组也放得下 */}
        <div className="relative w-[min(86vw,420px,calc((100dvh_-_160px)*1.07))] wide:w-[min(520px,calc((100dvh_-_180px)*1.07))]">
          <div className="splash-hop relative">
            <div className="splash-bop relative">
              <img src="/mascots/duo-wave.webp" alt="" draggable={false} className="block h-auto w-full" />
              <img src="/mascots/duo-wave-blink.webp" alt="" draggable={false} className="splash-blink absolute inset-0 block h-auto w-full" />
            </div>
          </div>

          {PUFFS.map((p, i) => (
            <span key={i} className="splash-puff" style={{ '--i': i, '--dx': `${p.dx}px`, left: `${p.left}%` } as CSSProperties} />
          ))}
          {NOTES.map((n, i) => {
            const Icon = n.double ? MusicNotes : MusicNote
            return (
              <span
                key={i}
                // 叶绿：浅色底上青柠太淡看不见；深色主题里叶绿这个 token 本身就是亮青柠
                className="splash-note text-leaf"
                style={{ '--i': i, '--dx': `${n.dx}px`, '--dy': `${n.dy}px`, '--r': `${n.r}deg`, left: `${n.left}%`, top: `${n.top}%` } as CSSProperties}
              >
                <Icon size={n.size} weight="fill" />
              </span>
            )
          })}
          {SPARKS.map((s, i) => (
            <span key={i} className="splash-spark text-leaf" style={{ '--i': i, left: `${s.left}%`, top: `${s.top}%` } as CSSProperties}>
              <Sparkle size={s.size} weight="fill" />
            </span>
          ))}
        </div>

        <div className="mt-4 flex font-display text-[64px] font-bold leading-none tracking-[-0.045em] text-ink regular:text-[80px]">
          {WORD.map((ch, i) => (
            <span key={i} className="splash-letter inline-block" style={{ '--i': i } as CSSProperties}>
              {ch}
            </span>
          ))}
        </div>
        <span className="splash-line mt-4 block h-[3px] w-14 rounded-pill bg-lime" />
      </div>
    </div>
  )
}
