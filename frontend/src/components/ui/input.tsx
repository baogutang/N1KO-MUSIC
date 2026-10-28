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
 * 所以：触屏尺寸用 text-base（16px），regular 断点以上才回到 15px。
 *
 * v6：圆角矩形，描边是 --edge（对地面 3:1），各状态描边宽度不变；
 * 聚焦只靠全局 :focus-visible 的外框（立即出现），不拿描边颜色冒充焦点环。
 */

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-11 w-full rounded-md border border-edge/80 bg-surface px-3.5 py-2 text-base text-ink transition-colors duration-2 regular:text-[15px] file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-ink-3 hover:border-edge disabled:cursor-not-allowed disabled:bg-fill disabled:text-ink-3 disabled:opacity-60',
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
