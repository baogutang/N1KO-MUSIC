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
      <div className="flex items-baseline justify-between border-b border-hair pb-3 pop:border-b-0 pop:items-center">
        <h2 className="font-serif text-[22px] font-semibold pop:font-extrabold pop:tracking-[-0.02em]">{title}</h2>
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

/**
 * 开关。
 * 编辑风：1px 轨道 + 小圆钮，开启为 accent（DESIGN v2 §4.4）。
 * 波普：  描边胶囊 + 实心钮，开启为薄荷绿（「已开启」绑定 ok 语义，DESIGN v3 §1.3）。
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
      className="group relative w-9 h-5 flex-shrink-0 pop:w-12 pop:h-7 pop:rounded-pill pop:border pop:border-hair pop:bg-paper-deep pop:shadow-press pop:transition-colors pop:duration-200"
    >
      <span
        className={cn(
          'absolute left-0 right-0 top-1/2 -translate-y-1/2 h-px transition-colors duration-200 pop:hidden',
          checked ? 'bg-primary' : 'bg-hair'
        )}
      />
      <span
        className={cn(
          'absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border transition-all duration-200',
          'pop:w-5 pop:h-5 pop:border-hair',
          checked
            ? 'left-full -translate-x-full bg-primary border-primary pop:bg-candy-ok-fill pop:-translate-x-[calc(100%+3px)]'
            : 'left-0 bg-paper border-ink-faint group-hover:border-ink-soft pop:bg-surface pop:translate-x-[3px]'
        )}
      />
    </button>
  )
}

/** 子组标题：小号 wide-tracking */
export function SubHead({ title }: { title: string }) {
  return <p className="pt-6 pb-1 text-[11px] tracking-[0.24em] text-ink-faint">{title}</p>
}

/**
 * 输入框。
 * 编辑风：无框，下缘 1px 发丝线，focus 变 accent（DESIGN v2 §4.4）。
 * 波普：  描边胶囊，focus 时描边变主色（DESIGN v3 §4.4）。
 */
export const hairInputClass =
  'h-9 rounded-none border-0 border-b border-hair bg-transparent px-0 text-sm ' +
  'placeholder:text-ink-faint/60 focus-visible:border-primary ' +
  'pop:h-10 pop:rounded-pill pop:border pop:border-hair pop:bg-surface pop:px-4 pop:shadow-press'
