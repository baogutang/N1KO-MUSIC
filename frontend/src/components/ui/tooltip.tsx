import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cn } from '@/lib/utils'

/**
 * 提示气泡：墨色小片，从触发点的方向弹出。
 * 悬停延迟由外壳的 TooltipProvider 给（850ms）；键盘聚焦时 Radix 立即打开，不等延迟。
 */
const TooltipProvider = TooltipPrimitive.Provider
const Tooltip = TooltipPrimitive.Root
const TooltipTrigger = TooltipPrimitive.Trigger

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <TooltipPrimitive.Content
    ref={ref}
    sideOffset={sideOffset}
    className={cn(
      'z-tooltip origin-[var(--radix-tooltip-content-transform-origin)] overflow-hidden rounded-[10px] bg-ink px-2.5 py-1.5 text-[12.5px] font-medium text-ground shadow-md animate-menu-in',
      className
    )}
    {...props}
  />
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
