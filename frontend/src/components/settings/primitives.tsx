/**
 * 设置页共用排版原语（v5 暖纸）。
 * iOS「设置」式的分组列表：分组标题在纸片上方，选项行躺在一张 `.sheet` 里，
 * 行与行之间一条极淡、左缩进到文字起点的分隔线（全站唯一允许在列表里画线的地方）。
 * 从 Settings 页抽出，供拆分出去的设置分区复用，保证视觉语言一致。
 */

import { cn } from '@/lib/utils'

/**
 * 分组列表里的一行：≥52px 高，底边一条缩进的 hair-soft 分隔线（最后一行不画）。
 * 线用伪元素的 border 而不是 bg，免得 token 换皮后变成实心黑块。
 * Row 之外需要自绘行（服务器行、端点输入行……）的地方复用这一串，保持同一条线。
 */
export const rowClass =
  'relative flex min-h-[52px] items-center gap-x-4 px-4 py-3 ' +
  "after:pointer-events-none after:absolute after:bottom-0 after:left-4 after:right-0 after:border-b after:border-hair-soft after:content-[''] " +
  'last:after:hidden'

/** 分组：小号分组标题在纸片上方，选项行在纸片里 */
export function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section>
      <h2 className="mb-2 px-4 text-[13px] font-medium text-ink-faint">{title}</h2>
      <div className="sheet">{children}</div>
    </section>
  )
}

/** 选项行：左名称 + ink-faint 说明，右控件；窄屏放不下时控件折到下一行靠右 */
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
        <p className="text-[15px] font-medium leading-snug">{name}</p>
        {desc && <p className="mt-0.5 text-[13px] leading-snug text-ink-faint">{desc}</p>}
      </div>
      {children && <div className="ml-auto flex flex-shrink-0 items-center">{children}</div>}
    </div>
  )
}

/**
 * 开关：50×30 的胶囊轨道，开启为强调色，滑块是一小片抬起的纸。
 * 外层按钮撑到 44px 高，保证触屏命中区。
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
      className="flex h-11 flex-shrink-0 items-center rounded-pill"
    >
      <span
        className={cn(
          'relative block h-[30px] w-[50px] rounded-pill transition-colors duration-200 motion-reduce:transition-none',
          checked ? 'bg-vivid' : 'bg-paper-3'
        )}
      >
        <span
          className={cn(
            'absolute left-[3px] top-[3px] block h-6 w-6 rounded-full bg-sheet shadow-press',
            'transition-transform duration-200 motion-reduce:transition-none',
            checked ? 'translate-x-5' : 'translate-x-0'
          )}
        />
      </span>
    </button>
  )
}

/** 分段控件：下沉的胶囊凹槽里，当前项是一块被托起的纸片（`.seg-option.is-on`） */
export function Segmented<T extends string>({ value, onChange, options, label }: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  label: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex gap-0.5 rounded-pill bg-paper-deep p-1"
    >
      {options.map(opt => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            'seg-option h-9 min-w-[44px] rounded-pill px-3.5 text-[13px] font-medium transition-colors duration-150 motion-reduce:transition-none',
            value === opt.value ? 'is-on' : 'text-ink-soft hover:text-ink'
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

/** 子组标题：纸片里的小标题，把后面几行归成一组 */
export function SubHead({ title }: { title: string }) {
  return <p className="px-4 pb-1 pt-5 text-[13px] font-semibold text-ink-soft">{title}</p>
}

/**
 * 纸片里的输入框：在白纸片上落一层下沉底，聚焦换成纸片底加强调色描边。
 * 叠在 ui/Input 的类后面（twMerge 去重），不另起一套形状。
 */
export const fieldInputClass =
  'h-10 border-transparent bg-paper-deep placeholder:text-ink-faint focus-visible:bg-sheet'

/** 原生下拉：与 fieldInputClass 同一副外形，右侧留出系统箭头的位置 */
export const selectClass =
  'h-10 cursor-pointer rounded-pill border border-transparent bg-paper-deep px-4 text-sm text-ink ' +
  'focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20'
