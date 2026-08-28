import * as React from 'react'
import * as SliderPrimitive from '@radix-ui/react-slider'
import { cn } from '@/lib/utils'

/**
 * 方向从 props 读，而不是靠 `data-[orientation=vertical]:` 变体写样式。
 *
 * 变体类编译出来带属性选择器（特异性 0,2,0），会盖过调用方传进来的普通类
 * （`h-32` 只有 0,1,0），而且 twMerge 认为两者变体不同、不去重，于是两条都留着。
 * 竖向音量条就是这么塌的：`h-full` 赢了 `h-32`，去问一个高度 auto 的浮层父级，
 * 百分比解析不出来 → 高度 0，滑轨整条消失。
 *
 * 组件本来就知道自己是横是竖，直接发普通类名即可：冲突交给 twMerge，
 * 调用方的值永远能覆盖默认值。
 */
const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, orientation = 'horizontal', 'aria-label': ariaLabel, 'aria-valuetext': ariaValueText, ...props }, ref) => {
  const vertical = orientation === 'vertical'
  return (
    <SliderPrimitive.Root
      ref={ref}
      orientation={orientation}
      className={cn(
        'relative flex touch-none select-none items-center group',
        vertical ? 'h-full w-auto flex-col' : 'w-full',
        className
      )}
      {...props}
    >
      <SliderPrimitive.Track
        className={cn(
          'relative grow overflow-hidden rounded-full bg-hair-soft',
          vertical ? 'h-full w-[2px]' : 'h-[2px] w-full'
        )}
      >
        <SliderPrimitive.Range
          className={cn('absolute bg-primary', vertical ? 'w-full' : 'h-full')}
        />
      </SliderPrimitive.Track>
      {/*
        role="slider" 在 Thumb 上，不在 Root 上——无障碍属性写在调用方的
        <Slider> 上会落到 Root，读屏根本读不到。音量条因此一直念的是
        「0.8」这样的裸小数。这里显式转发到 Thumb。
      */}
      {/*
        手柄在触屏上不能靠 hover 显形：一直 scale-0 的话，拖动时手指底下
        什么都看不见，不知道自己拖到了哪儿。有悬停能力的设备保持「浮现」
        的克制，触屏一律常显。
      */}
      <SliderPrimitive.Thumb
        aria-label={ariaLabel}
        aria-valuetext={ariaValueText}
        className="block h-3 w-3 rounded-full bg-foreground transition-transform duration-150 [@media(hover:hover)]:scale-0 [@media(hover:hover)]:group-hover:scale-100 focus-visible:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background disabled:pointer-events-none disabled:opacity-50 pop:h-4 pop:w-4 pop:border pop:border-hair pop:bg-surface" />
    </SliderPrimitive.Root>
  )
})
Slider.displayName = SliderPrimitive.Root.displayName

export { Slider }
