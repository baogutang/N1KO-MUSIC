import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { t } from '@/i18n'

/**
 * 对话框（v6）。窄窗口（<600）是从底部升起的面板，贴着 home 指示条；
 * 宽一些的窗口是居中的抬起面，从 96% 弹到 100%。
 *
 * 内容嵌在遮罩里居中（Radix 支持这种写法），而不是 top-1/2 + translate：
 * 那样入场关键帧一动 transform 就把居中的 translate 冲掉，面板会从角上飞进来。
 */
const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogPortal = DialogPrimitive.Portal
const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-modal grid items-end justify-items-center overflow-y-auto bg-ink/25 regular:items-center regular:p-6',
      'data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out',
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay>
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'relative z-modal grid w-full max-w-lg gap-4 bg-surface p-6 text-ink shadow-lg',
          'rounded-t-xl pb-[calc(24px+env(safe-area-inset-bottom))] regular:rounded-xl regular:pb-6',
          'data-[state=open]:animate-sheet-in data-[state=closed]:animate-sheet-out',
          'regular:data-[state=open]:animate-dialog-in regular:data-[state=closed]:animate-dialog-out',
          className
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="press-pop absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-pill text-ink-3 hover:bg-fill hover:text-ink disabled:cursor-not-allowed">
          <X className="h-4 w-4" />
          <span className="sr-only">{t('dialog.close')}</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogOverlay>
  </DialogPortal>
))
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col space-y-1.5 pr-8 text-left', className)} {...props} />
)
DialogHeader.displayName = 'DialogHeader'

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('font-display text-[20px] font-semibold leading-tight tracking-[-0.015em]', className)}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-[14px] text-ink-3', className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
}
