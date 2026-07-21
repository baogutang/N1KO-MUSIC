import * as React from 'react'
import * as SliderPrimitive from '@radix-ui/react-slider'
import { cn } from '@/lib/utils'

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn('relative flex w-full touch-none select-none items-center group', className)}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-[3px] w-full grow overflow-hidden rounded-full bg-border">
      <SliderPrimitive.Range className="absolute h-full rounded-full bg-primary transition-[filter] duration-150 group-hover:brightness-110" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb className="block h-2.5 w-2.5 rounded-full bg-foreground shadow-md transition-transform duration-150 scale-0 group-hover:scale-100 focus-visible:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ring-offset-background disabled:pointer-events-none disabled:opacity-50" />
  </SliderPrimitive.Root>
))
Slider.displayName = SliderPrimitive.Root.displayName

export { Slider }
