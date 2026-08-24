import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * 小屏上字号必须 ≥16px。
 *
 * iOS Safari 在聚焦一个字号小于 16px 的输入框时会自动放大整个页面，
 * 而且失焦后不缩回去——版面从此偏着，用户得手动双指缩放才能回来。
 * 另一种「修法」是给 viewport 加 maximum-scale=1 禁掉缩放，但那会连带
 * 剥夺所有人放大页面的能力，代价太大。
 *
 * 所以：触屏尺寸用 text-base（16px），sm 断点以上才回到 text-sm。
 */

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-10 w-full rounded-md border border-border bg-transparent px-3 py-2 text-base sm:text-sm transition-colors duration-200 file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-primary focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = 'Input'

export { Input }
