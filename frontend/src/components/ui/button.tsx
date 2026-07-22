import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 active:scale-[0.97]',
  {
    variants: {
      variant: {
        // 主操作：纯文字 + 发丝下划线，hover 变朱红（DESIGN v2 §4.1）
        default:
          'font-semibold text-foreground underline decoration-1 underline-offset-[6px] decoration-hair hover:text-primary hover:decoration-primary',
        destructive:
          'font-semibold text-destructive underline decoration-1 underline-offset-[6px] decoration-destructive/40 hover:decoration-destructive',
        // 次操作：细线小钮，hover 边框变墨色
        outline: 'border border-border bg-transparent text-foreground hover:border-foreground',
        secondary: 'border border-transparent bg-secondary text-secondary-foreground hover:border-border',
        // 图标/幽灵键：纯文字，hover accent
        ghost: 'text-muted-foreground hover:text-primary',
        link: 'text-primary underline-offset-4 hover:underline',
        icon: 'rounded-full text-muted-foreground hover:text-primary hover:ring-1 hover:ring-border active:scale-[0.94]',
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
