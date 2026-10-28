/**
 * 设置页共用排版原语（v6 舞台光）。
 * iOS「设置」式的分组列表：分组标题在面板上方，选项行躺在一块抬起的面板里，
 * 行与行之间只有一个设备像素的 hairline（最后一行不画）。
 * 分段控件是 SegmentedPill：轨道里一片被托起的面，切换时它顺着弹簧滑过去。
 * 页面里的视图切换（搜索结果、统计范围……）也用同一件，手感只此一份。
 * 从 Settings 页抽出，供拆分出去的设置分区复用，保证视觉语言一致。
 */

import { useId } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { cn } from '@/lib/utils'
import { SPRING_SNAPPY } from '@/lib/motion'

/**
 * 分组列表里的一行：≥52px 高，底边一个设备像素的 hairline（最后一行不画）。
 * Row 之外需要自绘行（服务器行、端点输入行……）的地方复用这一串，保持同一条线。
 */
export const rowClass =
  'flex min-h-[52px] items-center gap-x-4 px-4 py-3 hairline-b last:shadow-none'

/** 分组：小号分组标题在面板上方（句子式大小写），选项行在面板里 */
export function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section>
      <h2 className="px-1 pb-2 text-[13px] font-semibold text-ink-3">{title}</h2>
      <div className="sheet">{children}</div>
    </section>
  )
}

/** 选项行：左名称 + ink-3 说明，右控件；窄屏放不下时控件折到下一行靠右 */
export function Row({
  name,
  desc,
  children,
}: {
  name: string
  desc?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <div className={cn(rowClass, 'flex-wrap gap-y-2')}>
      <div className="min-w-[11rem] flex-1">
        <p className="text-[15px] font-medium leading-snug text-ink">{name}</p>
        {desc && <p className="mt-0.5 text-[13px] leading-snug text-ink-3">{desc}</p>}
      </div>
      {/* max-w-full：控件组（如滑块 + 数值 + 五档分段）比一行还宽时，在自己里面折行，不把整页撑出横向滚动 */}
      {children && <div className="ml-auto flex max-w-full flex-shrink-0 items-center">{children}</div>}
    </div>
  )
}

/**
 * 开关：50×30 的胶囊轨道，开启为叶绿（暗色下就是青柠），滑块带一点投影。
 * 外层按钮撑到 44px 高，保证触屏命中区；按下整枚开关收一点，松手回弹。
 */
export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="press-pop flex h-11 flex-shrink-0 items-center rounded-pill"
    >
      <span
        className={cn(
          'relative block h-[30px] w-[50px] rounded-pill transition-colors duration-3 motion-reduce:transition-none',
          checked ? 'bg-leaf' : 'bg-edge/60'
        )}
      >
        <span
          className={cn(
            'absolute left-[3px] top-[3px] block h-6 w-6 rounded-full bg-surface shadow-md ring-[0.5px] ring-ink/10 dark:bg-ink',
            'transition-transform duration-4 ease-snappy motion-reduce:transition-none',
            checked ? 'translate-x-5' : 'translate-x-0'
          )}
        />
      </span>
    </button>
  )
}

/**
 * 分段控件：胶囊轨道里一片被托起的面（motion 的 layoutId），切换时顺着弹簧滑到新选项。
 * 语义三选一，按用处给：radio（一组单选）、tabs（视图页签）、pressed（一组开关按钮）。
 * 选项视觉高 36px，命中区用伪元素撑满轨道的 44px。
 */
export function SegmentedPill<T extends string>({
  value,
  onChange,
  options,
  label,
  semantics = 'radio',
  className,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: React.ReactNode }[]
  /** 控件组的无障碍名称；视觉上已有标题时可省 */
  label?: string
  semantics?: 'radio' | 'tabs' | 'pressed'
  className?: string
}) {
  const reduce = useReducedMotion()
  const layoutId = `seg-${useId()}`
  const groupRole = semantics === 'tabs' ? 'tablist' : semantics === 'pressed' ? 'group' : 'radiogroup'
  return (
    <div
      role={groupRole}
      aria-label={label}
      className={cn('inline-flex rounded-pill bg-ink/[0.06] p-1', className)}
    >
      {options.map(opt => {
        const on = value === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            role={semantics === 'tabs' ? 'tab' : semantics === 'radio' ? 'radio' : undefined}
            aria-checked={semantics === 'radio' ? on : undefined}
            aria-selected={semantics === 'tabs' ? on : undefined}
            aria-pressed={semantics === 'pressed' ? on : undefined}
            onClick={() => onChange(opt.value)}
            className={cn(
              "relative isolate h-9 min-w-[44px] whitespace-nowrap rounded-pill px-4 text-[14px] font-semibold transition-colors duration-2 motion-reduce:transition-none after:absolute after:inset-x-0 after:-inset-y-1 after:content-['']",
              on ? 'text-ink' : 'text-ink-3 hover:text-ink-2'
            )}
          >
            {on && (
              <motion.span
                layoutId={layoutId}
                transition={reduce ? { duration: 0 } : SPRING_SNAPPY}
                aria-hidden="true"
                className="absolute inset-0 -z-10 rounded-pill seg-pill"
              />
            )}
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

/** 设置行里的分段控件：一组单选（radiogroup） */
export function Segmented<T extends string>({ value, onChange, options, label }: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  label: string
}) {
  return <SegmentedPill value={value} onChange={onChange} options={options} label={label} semantics="radio" />
}

/** 子组标题：面板里的小标题，把后面几行归成一组 */
export function SubHead({ title }: { title: string }) {
  return <p className="px-4 pb-1 pt-5 text-[13px] font-semibold text-ink-3">{title}</p>
}

/**
 * 面板里的输入框：在白面板上落一层下沉底，边是 --edge 的软描边（输入框的边界要看得见），
 * 聚焦换回面板底，焦点环走全局 :focus-visible。
 * 叠在 ui/Input 的类后面（twMerge 去重），不另起一套形状。
 */
export const fieldInputClass =
  'h-10 rounded-sm border-edge/60 bg-fill placeholder:text-ink-3 focus-visible:bg-surface'

/** 原生下拉：与 fieldInputClass 同一副边与底，右侧留出系统箭头的位置 */
export const selectClass =
  'h-10 cursor-pointer rounded-pill border border-edge/60 bg-fill px-4 text-[14px] text-ink hover:border-edge ' +
  'focus-visible:bg-surface disabled:cursor-not-allowed disabled:bg-fill disabled:text-ink-3'
