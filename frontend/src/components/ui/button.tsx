import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * 按钮的两张皮（DESIGN v2 §4.1 / DESIGN v3 §4.1）。
 *
 * 编辑风：按钮没有背景块——主操作是「纯文字 + 发丝下划线」，
 *         次操作是细线小钮，图标键是纯图标。
 * 波普：  全部是胶囊——2px 墨描边 + 硬投影，按下去位移 2px、投影缩到 1px。
 *
 * 差异全部由 `pop:` 变体表达，组件不读 store、不分支渲染：
 * 换皮是 <html data-skin> 一个属性的事，React 树不重挂。
 * 基类里的 `press-pop` 在编辑风下不产生任何视觉效果（--press 为 0、
 * --shadow-* 为 none），所以可以无条件挂上。
 */
const buttonVariants = cva(
  'press-pop inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 active:scale-[0.97] pop:rounded-pill',
  {
    variants: {
      variant: {
        // 主操作：纯文字 + 发丝下划线，hover 变朱红（DESIGN v2 §4.1）
        //         波普下变成葡萄紫实心胶囊（DESIGN v3 §4.1）
        default:
          'font-semibold text-foreground underline decoration-1 underline-offset-[6px] decoration-hair hover:text-primary hover:decoration-primary ' +
          'pop:no-underline pop:border pop:border-hair pop:bg-primary pop:text-primary-foreground pop:shadow-press pop:hover:text-primary-foreground',
        destructive:
          'font-semibold text-destructive underline decoration-1 underline-offset-[6px] decoration-destructive/40 hover:decoration-destructive ' +
          'pop:no-underline pop:border pop:border-hair pop:bg-destructive pop:text-destructive-foreground pop:shadow-press',
        // 次操作：细线小钮，hover 边框变墨色；波普下边框恒为墨色，靠底色与投影表达 hover
        outline:
          'border border-border bg-transparent text-foreground hover:border-foreground ' +
          'pop:bg-surface pop:shadow-press pop:hover:border-border pop:hover:bg-secondary',
        secondary:
          'border border-transparent bg-secondary text-secondary-foreground hover:border-border ' +
          'pop:border-hair pop:shadow-press',
        // 图标/幽灵键：纯文字，hover accent；波普下幽灵键仍然无描边，只换底
        ghost:
          'text-muted-foreground hover:text-primary ' +
          'pop:hover:bg-secondary pop:hover:text-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
        icon:
          'rounded-full text-muted-foreground hover:text-primary hover:ring-1 hover:ring-border active:scale-[0.94] ' +
          'pop:border pop:border-hair pop:bg-surface pop:text-foreground pop:shadow-press pop:hover:ring-0 pop:hover:bg-secondary pop:hover:text-foreground',
      },
      size: {
        default: 'h-10 px-5 py-2',
        sm: 'h-8 px-3',
        lg: 'h-12 px-8 text-base',
        icon: 'h-10 w-10',
        'icon-sm': 'h-8 w-8',
        'icon-lg': 'h-12 w-12',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
