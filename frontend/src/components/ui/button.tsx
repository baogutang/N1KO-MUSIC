import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * 按钮（v6 舞台光）。全部是胶囊，形状由角色决定：
 *   default      青柠实心：一屏的主操作
 *   destructive  玫瑰实心：不可撤销的动作
 *   outline / secondary  中性胶囊，扁平，不画影
 *   ghost / icon 平时不占面，hover 铺一层底
 *   link         叶绿文字，hover 下划线
 * 手感由 .press-pop 给：按下 90ms 收到 96%，松手按弹簧回弹（index.css 的 --ease-press）。
 * 焦点环走全局 :focus-visible（立即出现）。禁用态三条通道一起变：底色、文字色、指针。
 */
const buttonVariants = cva(
  'press-pop inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-pill font-semibold disabled:cursor-not-allowed disabled:opacity-60 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'bg-lime text-lime-ink hover:bg-lime-deep disabled:bg-fill disabled:text-ink-3',
        destructive:
          'bg-danger text-on-solid hover:bg-danger/90 disabled:bg-fill disabled:text-ink-3',
        outline:
          'bg-fill text-ink hover:bg-fill-2 disabled:text-ink-3',
        secondary:
          'bg-fill text-ink hover:bg-fill-2 disabled:text-ink-3',
        ghost:
          'text-ink-2 hover:bg-fill hover:text-ink disabled:text-ink-3',
        link: 'rounded-xs text-leaf underline-offset-4 hover:underline disabled:text-ink-3',
        icon:
          'text-ink-2 hover:bg-fill hover:text-ink disabled:text-ink-3',
      },
      size: {
        default: 'h-11 px-5 text-[15px]',
        sm: 'h-9 px-3.5 text-[14px]',
        lg: 'h-12 px-7 text-[16px]',
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
