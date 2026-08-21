/**
 * 设置页共用排版原语（杂志编辑风 DESIGN v2 §4.4）。
 * 从 Settings 页抽出，供拆分出去的设置分区复用，保证视觉语言一致。
 */

import { cn } from '@/lib/utils'

/** 分区：衬线标题 + 拉丁小标签 + 下缘发丝线 */
export function Section({
  title,
  tag,
  children,
}: {
  title: string
  tag?: string
  children: React.ReactNode
}) {
  return (
    <section className="pt-12 first:pt-8">
      <div className="flex items-baseline justify-between border-b border-hair pb-3">
        <h2 className="font-serif text-[22px] font-semibold">{title}</h2>
        {tag && <span className="latin-tag text-[10px] tracking-[0.24em] text-ink-faint">{tag}</span>}
      </div>
      <div>{children}</div>
    </section>
  )
}

/** 选项行：左名称 + ink-faint 说明，右控件；行间 hair-soft */
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
    <div className="flex items-center justify-between gap-6 py-4 border-b border-hair-soft">
      <div className="min-w-0">
        <p className="text-sm font-medium">{name}</p>
        {desc && <p className="text-xs text-ink-faint mt-0.5">{desc}</p>}
      </div>
      {children && <div className="flex-shrink-0 flex items-center">{children}</div>}
    </div>
  )
}

/** 细线滑块开关：1px 轨道 + 小圆钮，开启为 accent */
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
      className="group relative w-9 h-5 flex-shrink-0"
    >
      <span
        className={cn(
          'absolute left-0 right-0 top-1/2 -translate-y-1/2 h-px transition-colors duration-200',
          checked ? 'bg-primary' : 'bg-hair'
        )}
      />
      <span
        className={cn(
          'absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border transition-all duration-200',
          checked
            ? 'left-full -translate-x-full bg-primary border-primary'
            : 'left-0 bg-paper border-ink-faint group-hover:border-ink-soft'
        )}
      />
    </button>
  )
}

/** 子组标题：小号 wide-tracking */
export function SubHead({ title }: { title: string }) {
  return <p className="pt-6 pb-1 text-[11px] tracking-[0.24em] text-ink-faint">{title}</p>
}

/** 发丝线输入框：下缘 1px hair，focus 变 accent */
export const hairInputClass =
  'h-9 rounded-none border-0 border-b border-hair bg-transparent px-0 text-sm ' +
  'placeholder:text-ink-faint/60 focus-visible:border-primary'
