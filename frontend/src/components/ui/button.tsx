import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * 按钮（v5 暖纸）。全部是胶囊，形状由角色决定：
 *   default      青柠实心：一屏的主操作
 *   destructive  玫瑰实心：不可撤销的动作
 *   outline / secondary  下沉一档的纸色胶囊，扁平，不画影
 *   ghost / icon 平时不占面，hover 铺一层下沉底
 *   link         叶绿文字，hover 下划线
 * 禁用态三条通道同时变：填充、文字色、指针（不只靠透明度）。
 */
const buttonVariants = cva(
  'press-pop inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-pill text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-60',
  {
    variants: {
      variant: {
        default:
          'bg-vivid text-vivid-foreground hover:bg-vivid-deep disabled:bg-paper-3 disabled:text-ink-faint',
        destructive:
          'bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:bg-paper-3 disabled:text-ink-faint',
        outline:
          'bg-paper-3 text-foreground hover:bg-hair disabled:text-ink-faint',
        secondary:
          'bg-paper-deep text-secondary-foreground hover:bg-paper-3 disabled:text-ink-faint',
        ghost:
          'text-ink-soft hover:bg-paper-deep hover:text-ink disabled:text-ink-faint',
        link: 'rounded-sm text-primary underline-offset-4 hover:underline disabled:text-ink-faint',
        icon:
          'text-ink-soft hover:bg-paper-deep hover:text-ink active:scale-[0.94] disabled:text-ink-faint',
      },
      size: {
        default: 'h-11 px-5',
        sm: 'h-9 px-3.5',
        lg: 'h-12 px-7 text-base',
        icon: 'h-10 w-10',
        'icon-sm': 'h-9 w-9',
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
